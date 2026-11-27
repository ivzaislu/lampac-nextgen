using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared.Models.Base;
using Shared.Models.Online.Settings;
using Shared.Models.Templates;
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web;

namespace FanCDN2_0;

public struct FanCDN2_0Invoke
{
    #region FanCDN2_0Invoke
    OnlinesSettings init;
    Func<string, Task<string>> ongetpage;
    Func<string, string> onstreamfile;

    public FanCDN2_0Invoke(OnlinesSettings init, Func<string, Task<string>> ongetpage, Func<string, string> onstreamfile)
    {
        this.init = init;
        this.ongetpage = ongetpage;
        this.onstreamfile = onstreamfile;
    }
    #endregion

    #region Serial
    async public Task<FanCDN2_0SerialSeason> Serial(string seriesUrl, short season)
    {
        if (season <= 0 || string.IsNullOrWhiteSpace(seriesUrl))
            return null;

        string seasonUrl = BuildSeasonUrl(seriesUrl, season);
        if (string.IsNullOrEmpty(seasonUrl))
            return null;

        string seasonPage = await ongetpage(seasonUrl);
        if (string.IsNullOrWhiteSpace(seasonPage))
            return null;

        var links = ExtractEpisodeLinks(seasonPage, seriesUrl, season);
        if (links.Count == 0)
            return null;

        const int maxParallelEpisodes = 6;
        using var gate = new SemaphoreSlim(maxParallelEpisodes, maxParallelEpisodes);
        var tasks = new List<Task<FanCDN2_0SerialEpisode>>(links.Count);

        foreach (var row in links)
            tasks.Add(LoadEpisode(gate, row.Key, row.Value));

        FanCDN2_0SerialEpisode[] loaded = await Task.WhenAll(tasks);
        // ExtractEpisodeLinks returns unique, sorted episode numbers.
        // Task.WhenAll preserves the order of its input tasks.
        var episodes = new List<FanCDN2_0SerialEpisode>(loaded.Length);
        foreach (FanCDN2_0SerialEpisode episode in loaded)
        {
            if (episode != null && episode.episode > 0)
                episodes.Add(episode);
        }

        if (episodes.Count == 0)
            return null;

        return new FanCDN2_0SerialSeason
        {
            season = season,
            episodes = episodes.ToArray()
        };
    }

    async Task<FanCDN2_0SerialEpisode> LoadEpisode(SemaphoreSlim gate, int episodeNumber, string episodeUrl)
    {
        await gate.WaitAsync();
        try
        {
            string episodePage = await ongetpage(episodeUrl);
            if (string.IsNullOrWhiteSpace(episodePage))
                return null;

            Dictionary<string, string> streams = ExtractCdnStreams(episodePage);
            if (streams.Count == 0)
                return null;

            return new FanCDN2_0SerialEpisode
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
            string url = NormalizeSiteUrl(init.host, link.Groups[1].Value);
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

    Dictionary<string, string> ExtractCdnStreams(string html)
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

        string playerUrl = NormalizeSiteUrl(init.host, rawPlayer);
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
    internal static string NormalizeSiteUrl(string host, string rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl) ||
            string.IsNullOrWhiteSpace(host) ||
            !Uri.TryCreate(host.TrimEnd('/') + "/", UriKind.Absolute, out Uri baseUri))
            return null;

        string value = HttpUtility.HtmlDecode(rawUrl.Trim()).Replace("\\/", "/");
        if (value.StartsWith("//"))
            value = baseUri.Scheme + ":" + value;

        if (!Uri.TryCreate(baseUri, value, out Uri uri) ||
            !uri.Host.Equals(baseUri.Host, StringComparison.OrdinalIgnoreCase))
            return null;

        return uri.ToString();
    }

    internal static string NormalizeFanCdnUrl(string rawUrl)
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

        if (!uri.Host.Equals("cdn.fancdn.net", StringComparison.OrdinalIgnoreCase) &&
            !uri.Host.EndsWith(".cdn.fancdn.net", StringComparison.OrdinalIgnoreCase))
            return null;

        return uri.ToString();
    }

    internal static string SeriesRootPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return "/";

        string value = path.TrimEnd('/');
        if (value.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
            value = value.Substring(0, value.Length - 5);

        Match serialPath = Regex.Match(value, @"^(.*?)/[0-9]+-season(?:/[0-9]+-episode)?$", RegexOptions.IgnoreCase);
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

    static string RouteBase(string localHost)
    {
        return string.IsNullOrWhiteSpace(localHost)
            ? "/lite/fancdn.2.0"
            : localHost.TrimEnd('/') + "/lite/fancdn.2.0";
    }
    #endregion

    #region Tpl
    public ITplResult Tpl(FanCDN2_0EmbedModel root, string title, string original_title, VastConf vast = null, IReadOnlyList<HeadersModel> headers = null)
    {
        if (root?.movies == null || root.movies.Length == 0)
            return default;

        var mtpl = new MovieTpl(title, original_title, root.movies.Length);

        foreach (FanCDN2_0MovieEpisode movie in root.movies)
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
                    subtitles.Append(match.Groups[1].Value, onstreamfile.Invoke(srt));
                    match = match.NextMatch();
                }
            }

            mtpl.Append(
                movie.title,
                onstreamfile.Invoke(movie.file),
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

    public ITplResult TplSerial(FanCDN2_0SerialSeason serial, string localHost, string imdb_id, long kinopoisk_id, string title, string original_title, short year, string voice, bool rjson, IReadOnlyList<HeadersModel> headers = null, VastConf vast = null)
    {
        if (serial?.episodes == null || serial.episodes.Length == 0)
            return default;

        var normalizedEpisodes = new SortedDictionary<int, FanCDN2_0SerialEpisode>();
        foreach (FanCDN2_0SerialEpisode episode in serial.episodes)
        {
            if (episode != null && episode.episode > 0)
                normalizedEpisodes[episode.episode] = episode;
        }

        if (normalizedEpisodes.Count == 0)
            return default;

        var voiceOrder = new List<string>();
        var voiceCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (FanCDN2_0SerialEpisode episode in normalizedEpisodes.Values)
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

        var etpl = new EpisodeTpl(vtpl, normalizedEpisodes.Count);

        foreach (FanCDN2_0SerialEpisode episode in normalizedEpisodes.Values)
        {
            if (episode.streams == null || !episode.streams.TryGetValue(selectedVoice, out string stream) || string.IsNullOrEmpty(stream))
                continue;

            etpl.Append(
                $"{episode.episode} серия",
                title ?? original_title,
                serial.season,
                episode.episode.ToString(),
                onstreamfile.Invoke(stream),
                voice_name: selectedVoice,
                headers: headers,
                vast: vast
            );
        }

        return etpl;
    }
    #endregion
}
