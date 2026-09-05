using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared.Models.Base;
using Shared.Models.Online.Settings;
using Shared.Models.Templates;
using Shared.Services.HTTP;
using Shared.Services.Utilities;
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web;

namespace FanCDN;

public struct FanCDNInvoke
{
    static readonly SemaphoreSlim playwrightGate = new(2, 2);

    OnlinesSettings init;
    List<Microsoft.Playwright.Cookie> cookies;
    Func<string, IReadOnlyList<HeadersModel>, string> onstreamfile;

    public FanCDNInvoke(OnlinesSettings init, List<Microsoft.Playwright.Cookie> cookies, Func<string, IReadOnlyList<HeadersModel>, string> onstreamfile)
    {
        this.init = init;
        this.cookies = cookies;
        this.onstreamfile = onstreamfile;
    }

    #region Search
    async public Task<string> SearchPage(string title, string original_title, short year)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;

        string host = init.host.TrimEnd('/');
        string search = await PlaywrightHttp.Get(
            init,
            $"{host}/engine/ajax/msearch.php?q={HttpUtility.UrlEncode(title)}",
            cookies: cookies,
            headers: HeadersModel.Init(
                ("referer", $"{host}/"),
                ("sec-fetch-dest", "empty"),
                ("sec-fetch-mode", "cors"),
                ("sec-fetch-site", "same-origin")
            )
        );

        if (string.IsNullOrWhiteSpace(search))
            return null;

        JArray root = null;
        try
        {
            root = JsonConvert.DeserializeObject<JArray>(search);
        }
        catch { }

        if (root == null || root.Count == 0)
            return null;

        string stitle = SearchNameTo.Convert(title);
        string soriginal = SearchNameTo.Convert(original_title);
        string fallbackUrl = null;

        foreach (JToken item in root)
        {
            string itemTitle = item.Value<string>("title");
            string itemOriginal = item.Value<string>("original_title");

            bool titleMatch = !string.IsNullOrEmpty(stitle) && SearchNameTo.Equals(itemTitle, stitle);
            bool originalMatch = !string.IsNullOrEmpty(soriginal) && SearchNameTo.Equals(itemOriginal, soriginal);
            if (!titleMatch && !originalMatch)
                continue;

            string normalized = NormalizeSiteUrl(item.Value<string>("url"));
            if (string.IsNullOrEmpty(normalized))
                continue;

            if (year <= 0)
                return normalized;

            string itemYearText = item.Value<string>("year");
            if (!short.TryParse(itemYearText, out short itemYear))
            {
                fallbackUrl ??= normalized;
                continue;
            }

            if (Math.Abs(itemYear - year) <= 1)
                return normalized;
        }

        return fallbackUrl;
    }

    async public Task<(string kp, string key)> Search(string title, string original_title, short year)
    {
        string pageUrl = await SearchPage(title, original_title, year);
        if (string.IsNullOrEmpty(pageUrl))
            return default;

        string page = await GetPage(pageUrl);
        if (string.IsNullOrWhiteSpace(page) || RequiresAuth(page))
            return default;

        foreach (Match iframe in Regex.Matches(page, "<iframe\\b[^>]*\\bsrc\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            string playerUrl = NormalizeSiteUrl(iframe.Groups[1].Value);
            if (string.IsNullOrEmpty(playerUrl) || !Uri.TryCreate(playerUrl, UriKind.Absolute, out Uri playerUri))
                continue;

            Match path = Regex.Match(playerUri.AbsolutePath, "^/movies/([0-9]+)/?$", RegexOptions.IgnoreCase);
            if (!path.Success)
                continue;

            string key = HttpUtility.ParseQueryString(playerUri.Query).Get("key");
            if (string.IsNullOrWhiteSpace(key))
                continue;

            return (path.Groups[1].Value, key);
        }

        return default;
    }
    #endregion

    #region Movie
    async public Task<EmbedModel> Embed(string kp, string key)
    {
        if (string.IsNullOrWhiteSpace(kp) || !Regex.IsMatch(kp, "^[0-9]+$") || string.IsNullOrWhiteSpace(key))
            return null;

        string host = init.host.TrimEnd('/');
        string encodedKey = HttpUtility.UrlEncode(key);
        string movieUrl = $"{host}/movies/{kp}?key={encodedKey}";

        string json = await PlaywrightHttp.Get(
            init,
            $"{host}/film.php?kp={kp}&key={encodedKey}",
            cookies: cookies,
            headers: HeadersModel.Init(
                ("referer", movieUrl),
                ("sec-fetch-dest", "empty"),
                ("sec-fetch-mode", "cors"),
                ("sec-fetch-site", "same-origin")
            )
        );

        if (string.IsNullOrWhiteSpace(json))
            return null;

        Episode[] source = null;
        try
        {
            source = JsonConvert.DeserializeObject<Episode[]>(json);
        }
        catch { }

        if (source == null || source.Length == 0)
            return null;

        var movies = new List<Episode>(source.Length);
        foreach (Episode movie in source)
        {
            if (movie == null || string.IsNullOrWhiteSpace(movie.file))
                continue;

            string file = NormalizeFanCdnUrl(movie.file);
            if (string.IsNullOrEmpty(file))
                continue;

            movie.file = file;
            movies.Add(movie);
        }

        if (movies.Count == 0)
            return null;

        return new EmbedModel { movies = movies.ToArray() };
    }
    #endregion

    #region Serial
    async public Task<List<int>> Seasons(string seriesUrl)
    {
        string page = await GetPage(seriesUrl);
        if (string.IsNullOrWhiteSpace(page))
            return null;

        Uri seriesUri = new Uri(seriesUrl);
        string rootPath = SeriesRootPath(seriesUri.AbsolutePath);
        var seasons = new HashSet<int>();

        foreach (Match link in Regex.Matches(page, "href\\s*=\\s*[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            string url = NormalizeSiteUrl(link.Groups[1].Value);
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out Uri uri))
                continue;

            if (!uri.AbsolutePath.StartsWith(rootPath + "/", StringComparison.OrdinalIgnoreCase))
                continue;

            Match season = Regex.Match(uri.AbsolutePath.Substring(rootPath.Length), "^/([0-9]+)-season(?:\\.html|/)", RegexOptions.IgnoreCase);
            if (season.Success && int.TryParse(season.Groups[1].Value, out int number) && number > 0)
                seasons.Add(number);
        }

        if (seasons.Count == 0)
            return null;

        var result = new List<int>(seasons);
        result.Sort();
        return result;
    }

    async public Task<FanCdnSerialSeason> Serial(string seriesUrl, short season)
    {
        if (season <= 0 || string.IsNullOrWhiteSpace(seriesUrl))
            return null;

        string seasonUrl = BuildSeasonUrl(seriesUrl, season);
        if (string.IsNullOrEmpty(seasonUrl))
            return null;

        string seasonPage = await GetPage(seasonUrl);
        if (string.IsNullOrWhiteSpace(seasonPage))
            return null;

        var links = ExtractEpisodeLinks(seasonPage, seriesUrl, season);
        if (links.Count == 0)
            return null;

        const int maxParallelEpisodes = 6;
        using var gate = new SemaphoreSlim(maxParallelEpisodes, maxParallelEpisodes);
        var tasks = new List<Task<FanCdnSerialEpisode>>(links.Count);

        foreach (var row in links)
            tasks.Add(LoadEpisode(gate, row.Key, row.Value));

        FanCdnSerialEpisode[] loaded = await Task.WhenAll(tasks);
        var uniqueEpisodes = new SortedDictionary<int, FanCdnSerialEpisode>();

        foreach (FanCdnSerialEpisode episode in loaded)
        {
            if (episode != null && episode.episode > 0)
                uniqueEpisodes[episode.episode] = episode;
        }

        if (uniqueEpisodes.Count == 0)
            return null;

        var episodes = new List<FanCdnSerialEpisode>(uniqueEpisodes.Count);
        foreach (FanCdnSerialEpisode episode in uniqueEpisodes.Values)
            episodes.Add(episode);

        return new FanCdnSerialSeason
        {
            season = season,
            episodes = episodes.ToArray()
        };
    }

    async Task<FanCdnSerialEpisode> LoadEpisode(SemaphoreSlim gate, int episodeNumber, string episodeUrl)
    {
        await gate.WaitAsync();
        try
        {
            string episodePage = await GetPage(episodeUrl);
            if (string.IsNullOrWhiteSpace(episodePage) || RequiresAuth(episodePage))
                return null;

            Dictionary<string, string> streams = ExtractCdnStreams(episodePage, episodeUrl);
            if (streams.Count == 0)
                return null;

            return new FanCdnSerialEpisode
            {
                episode = episodeNumber,
                title = ExtractEpisodeTitle(episodePage) ?? $"{episodeNumber} серия",
                streams = streams
            };
        }
        finally
        {
            gate.Release();
        }
    }

    SortedDictionary<int, string> ExtractEpisodeLinks(string html, string seriesUrl, short season)
    {
        var result = new SortedDictionary<int, string>();
        if (string.IsNullOrWhiteSpace(html) || !Uri.TryCreate(seriesUrl, UriKind.Absolute, out Uri seriesUri))
            return result;

        string rootPath = SeriesRootPath(seriesUri.AbsolutePath);
        string prefix = $"{rootPath}/{season}-season/";

        foreach (Match link in Regex.Matches(html, "href\\s*=\\s*[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            string url = NormalizeSiteUrl(link.Groups[1].Value);
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out Uri uri))
                continue;

            if (!uri.AbsolutePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                continue;

            Match episode = Regex.Match(uri.AbsolutePath.Substring(prefix.Length), "^([0-9]+)-episode\\.html$", RegexOptions.IgnoreCase);
            if (!episode.Success || !int.TryParse(episode.Groups[1].Value, out int number) || number <= 0)
                continue;

            result[number] = uri.ToString();
        }

        return result;
    }

    Dictionary<string, string> ExtractCdnStreams(string html, string baseUrl)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(html))
            return result;

        int searchFrom = 0;
        const string markerText = "window.cdnData[";

        while (searchFrom < html.Length)
        {
            int marker = html.IndexOf(markerText, searchFrom, StringComparison.OrdinalIgnoreCase);
            if (marker < 0)
                break;

            int equals = html.IndexOf('=', marker + markerText.Length);
            if (equals < 0 || equals - marker > 128)
            {
                searchFrom = marker + markerText.Length;
                continue;
            }

            int start = html.IndexOf('{', equals + 1);
            if (start < 0 || start - equals > 64)
            {
                searchFrom = equals + 1;
                continue;
            }

            string json = ExtractJsonObject(html, start, out int end);
            searchFrom = end > start ? end + 1 : start + 1;
            if (string.IsNullOrEmpty(json))
                continue;

            try
            {
                JObject item = JsonConvert.DeserializeObject<JObject>(json);
                string name = CleanText(item?.Value<string>("name"));
                string stream = ExtractDirectStream(item?.Value<string>("player"));

                if (string.IsNullOrWhiteSpace(name))
                    name = "По умолчанию";

                if (!string.IsNullOrEmpty(stream) && !result.ContainsKey(name))
                    result[name] = stream;
            }
            catch { }
        }

        if (result.Count == 0)
        {
            foreach (Match iframe in Regex.Matches(html, "<iframe\\b[^>]*\\bsrc\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
            {
                string stream = ExtractDirectStream(iframe.Groups[1].Value);
                if (!string.IsNullOrEmpty(stream))
                {
                    result["По умолчанию"] = stream;
                    break;
                }
            }
        }

        return result;
    }

    string ExtractDirectStream(string rawPlayer)
    {
        if (string.IsNullOrWhiteSpace(rawPlayer))
            return null;

        string direct = NormalizeFanCdnUrl(rawPlayer);
        if (!string.IsNullOrEmpty(direct))
            return direct;

        string playerUrl = NormalizeSiteUrl(rawPlayer);
        if (string.IsNullOrEmpty(playerUrl) || !Uri.TryCreate(playerUrl, UriKind.Absolute, out Uri playerUri))
            return null;

        if (!playerUri.AbsolutePath.Equals("/player/", StringComparison.OrdinalIgnoreCase) &&
            !playerUri.AbsolutePath.Equals("/player", StringComparison.OrdinalIgnoreCase))
            return null;

        string file = HttpUtility.ParseQueryString(playerUri.Query).Get("file");
        return NormalizeFanCdnUrl(file);
    }
    #endregion

    #region Helpers
    async Task<string> GetPage(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return null;

        string host = init.host.TrimEnd('/');
        var headers = HeadersModel.Init(
            ("referer", $"{host}/"),
            ("sec-fetch-dest", "document"),
            ("sec-fetch-mode", "navigate"),
            ("sec-fetch-site", "same-origin")
        );

        string direct = await Shared.Services.Http.Get(
            url,
            cookie: init.cookie,
            referer: $"{host}/",
            timeoutSeconds: 8,
            headers: headers
        );

        if (UsablePage(direct) && !RequiresAuth(direct))
            return direct;

        await playwrightGate.WaitAsync();
        try
        {
            return await PlaywrightHttp.Get(
                init,
                url,
                cookies: cookies,
                headers: headers
            );
        }
        finally
        {
            playwrightGate.Release();
        }
    }

    static bool UsablePage(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return false;

        return !html.Contains("cf-chl-", StringComparison.OrdinalIgnoreCase)
            && !html.Contains("challenge-platform", StringComparison.OrdinalIgnoreCase)
            && !html.Contains("Just a moment", StringComparison.OrdinalIgnoreCase);
    }

    string NormalizeSiteUrl(string rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl) || !Uri.TryCreate(init.host.TrimEnd('/') + "/", UriKind.Absolute, out Uri baseUri))
            return null;

        string value = HttpUtility.HtmlDecode(rawUrl.Trim()).Replace("\\/", "/");
        if (value.StartsWith("//"))
            value = baseUri.Scheme + ":" + value;

        if (!Uri.TryCreate(baseUri, value, out Uri uri))
            return null;

        if (!uri.Host.Equals(baseUri.Host, StringComparison.OrdinalIgnoreCase))
            return null;

        return uri.ToString();
    }

    static string NormalizeFanCdnUrl(string rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl))
            return null;

        string value = HttpUtility.HtmlDecode(rawUrl.Trim()).Replace("\\/", "/");
        if (value.StartsWith("//"))
            value = "https:" + value;

        if (!Uri.TryCreate(value, UriKind.Absolute, out Uri uri))
            return null;

        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return null;

        if (!uri.Host.Equals("cdn.fancdn.net", StringComparison.OrdinalIgnoreCase) && !uri.Host.EndsWith(".cdn.fancdn.net", StringComparison.OrdinalIgnoreCase))
            return null;

        return uri.ToString();
    }

    static string SeriesRootPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return "/";

        string value = path.TrimEnd('/');
        if (value.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
            value = value.Substring(0, value.Length - 5);

        Match serialPath = Regex.Match(value, "^(.*?)/[0-9]+-season(?:/[0-9]+-episode)?$", RegexOptions.IgnoreCase);
        if (serialPath.Success && !string.IsNullOrEmpty(serialPath.Groups[1].Value))
            value = serialPath.Groups[1].Value;

        return string.IsNullOrEmpty(value) ? "/" : value;
    }

    string BuildSeasonUrl(string seriesUrl, short season)
    {
        if (!Uri.TryCreate(seriesUrl, UriKind.Absolute, out Uri uri))
            return null;

        string rootPath = SeriesRootPath(uri.AbsolutePath);
        return $"{uri.Scheme}://{uri.Authority}{rootPath}/{season}-season.html";
    }

    static string ExtractEpisodeTitle(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return null;

        Match title = Regex.Match(html, "<h1\\b[^>]*class=[\"'][^\"']*\\bpage-title\\b[^\"']*[\"'][^>]*>(.*?)</h1>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return title.Success ? CleanText(title.Groups[1].Value) : null;
    }

    static string CleanText(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        string text = Regex.Replace(value, "<[^>]+>", " ");
        text = HttpUtility.HtmlDecode(text);
        return Regex.Replace(text, "\\s+", " ").Trim();
    }

    static bool RequiresAuth(string html)
    {
        if (string.IsNullOrEmpty(html))
            return false;

        return html.Contains("требуется вход в систему", StringComparison.OrdinalIgnoreCase)
            || html.Contains("для доступа к видеоконтенту необходимо иметь учётную запись", StringComparison.OrdinalIgnoreCase)
            || html.Contains("для доступа к видеоконтенту необходимо иметь учетную запись", StringComparison.OrdinalIgnoreCase);
    }

    static string ExtractJsonObject(string html, int start, out int end)
    {
        end = -1;
        if (string.IsNullOrEmpty(html) || start < 0 || start >= html.Length || html[start] != '{')
            return null;

        int depth = 0;
        char quote = '\0';
        bool escaped = false;

        for (int i = start; i < html.Length; i++)
        {
            char ch = html[i];

            if (quote != '\0')
            {
                if (escaped)
                {
                    escaped = false;
                    continue;
                }

                if (ch == '\\')
                {
                    escaped = true;
                    continue;
                }

                if (ch == quote)
                    quote = '\0';

                continue;
            }

            if (ch == '"' || ch == '\'')
            {
                quote = ch;
                continue;
            }

            if (ch == '{')
            {
                depth++;
                continue;
            }

            if (ch != '}')
                continue;

            depth--;
            if (depth == 0)
            {
                end = i;
                return html.Substring(start, i - start + 1);
            }
        }

        return null;
    }

    IReadOnlyList<HeadersModel> StreamHeaders()
    {
        string host = init.host.TrimEnd('/');
        return HeadersModel.Init(
            ("referer", $"{host}/"),
            ("origin", host),
            ("sec-fetch-dest", "empty"),
            ("sec-fetch-mode", "cors"),
            ("sec-fetch-site", "cross-site")
        );
    }

    static string RouteBase(string localHost)
    {
        return string.IsNullOrWhiteSpace(localHost)
            ? "/lite/fancdn"
            : localHost.TrimEnd('/') + "/lite/fancdn";
    }
    #endregion

    #region Html
    public ITplResult Tpl(EmbedModel root, string imdb_id, long kinopoisk_id, string title, string original_title, VastConf vast = null, IReadOnlyList<HeadersModel> headers = null)
    {
        if (root?.movies == null || root.movies.Length == 0)
            return default;

        var streamHeaders = StreamHeaders();
        var mtpl = new MovieTpl(title, original_title, root.movies.Length);

        foreach (Episode movie in root.movies)
        {
            if (string.IsNullOrEmpty(movie.file))
                continue;

            var subtitles = new SubtitleTpl();
            if (!string.IsNullOrEmpty(movie.subtitles))
            {
                Match match = new Regex("\\[([^\\]]+)\\]([^\\,]+)").Match(movie.subtitles);
                while (match.Success)
                {
                    string srt = movie.file.Replace("/hls.m3u8", "/") + match.Groups[2].Value;
                    subtitles.Append(match.Groups[1].Value, onstreamfile.Invoke(srt, streamHeaders));
                    match = match.NextMatch();
                }
            }

            mtpl.Append(
                movie.title,
                onstreamfile.Invoke(movie.file, streamHeaders),
                subtitles: subtitles,
                vast: vast,
                headers: headers
            );
        }

        return mtpl;
    }

    public ITplResult TplSeasons(List<int> seasons, string localHost, string imdb_id, long kinopoisk_id, string title, string original_title, short year, bool rjson)
    {
        if (seasons == null || seasons.Count == 0)
            return default;

        string route = RouteBase(localHost);
        string encTitle = HttpUtility.UrlEncode(title);
        string encOriginal = HttpUtility.UrlEncode(original_title);
        string encImdb = HttpUtility.UrlEncode(imdb_id);

        var tpl = new SeasonTpl(seasons.Count);
        foreach (int season in seasons)
        {
            tpl.Append(
                $"{season} сезон",
                $"{route}?rjson={rjson}&serial=1&kinopoisk_id={kinopoisk_id}&imdb_id={encImdb}&title={encTitle}&original_title={encOriginal}&year={year}&s={season}",
                season
            );
        }

        return tpl;
    }

    public ITplResult TplSerial(FanCdnSerialSeason serial, string localHost, string imdb_id, long kinopoisk_id, string title, string original_title, short year, string voice, bool rjson, IReadOnlyList<HeadersModel> headers = null, VastConf vast = null)
    {
        if (serial?.episodes == null || serial.episodes.Length == 0)
            return default;

        var normalizedEpisodes = new SortedDictionary<int, FanCdnSerialEpisode>();
        foreach (FanCdnSerialEpisode episode in serial.episodes)
        {
            if (episode != null && episode.episode > 0)
                normalizedEpisodes[episode.episode] = episode;
        }

        if (normalizedEpisodes.Count == 0)
            return default;

        var voiceOrder = new List<string>();
        var voiceCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (FanCdnSerialEpisode episode in normalizedEpisodes.Values)
        {
            if (episode.streams == null)
                continue;

            foreach (string name in episode.streams.Keys)
            {
                if (!voiceCounts.ContainsKey(name))
                {
                    voiceCounts[name] = 0;
                    voiceOrder.Add(name);
                }

                voiceCounts[name]++;
            }
        }

        if (voiceOrder.Count == 0)
            return default;

        string selectedVoice = null;
        if (!string.IsNullOrWhiteSpace(voice))
        {
            foreach (string name in voiceOrder)
            {
                if (name.Equals(voice, StringComparison.OrdinalIgnoreCase))
                {
                    selectedVoice = name;
                    break;
                }
            }
        }

        if (selectedVoice == null)
        {
            int bestCount = -1;
            foreach (string name in voiceOrder)
            {
                int count = voiceCounts[name];
                if (count > bestCount)
                {
                    bestCount = count;
                    selectedVoice = name;
                }
            }
        }

        string route = RouteBase(localHost);
        string encTitle = HttpUtility.UrlEncode(title);
        string encOriginal = HttpUtility.UrlEncode(original_title);
        string encImdb = HttpUtility.UrlEncode(imdb_id);

        var vtpl = new VoiceTpl();
        foreach (string name in voiceOrder)
        {
            string encVoice = HttpUtility.UrlEncode(name);
            vtpl.Append(
                name,
                name.Equals(selectedVoice, StringComparison.OrdinalIgnoreCase),
                $"{route}?rjson={rjson}&serial=1&kinopoisk_id={kinopoisk_id}&imdb_id={encImdb}&title={encTitle}&original_title={encOriginal}&year={year}&s={serial.season}&voice={encVoice}"
            );
        }

        var streamHeaders = StreamHeaders();
        var etpl = new EpisodeTpl(vtpl, normalizedEpisodes.Count);

        foreach (FanCdnSerialEpisode episode in normalizedEpisodes.Values)
        {
            if (episode.streams == null || !episode.streams.TryGetValue(selectedVoice, out string stream) || string.IsNullOrEmpty(stream))
                continue;

            etpl.Append(
                $"{episode.episode} серия",
                title ?? original_title,
                serial.season,
                episode.episode.ToString(),
                onstreamfile.Invoke(stream, streamHeaders),
                voice_name: selectedVoice,
                headers: headers,
                vast: vast
            );
        }

        return etpl;
    }
    #endregion
}
