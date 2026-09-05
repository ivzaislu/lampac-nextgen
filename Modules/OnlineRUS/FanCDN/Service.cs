using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared.Models.Base;
using Shared.Models.Online.Settings;
using Shared.Models.Templates;
using Shared.Services.HTTP;
using Shared.Services.Utilities;
using System;
using System.Collections.Generic;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;

namespace FanCDN;

public struct FanCDNInvoke
{
    static readonly string[] playerHosts =
    {
        "cdnlbox.club",
        "ylitron.pro",
        "lomont.site",
        "gencit.info",
        "ortified.ws",
        "vak345.com",
        "interkh.com",
        "zombie-film.com"
    };

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
    async public Task<string> Search(string title, string original_title, short year)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;

        string catalog = await PlaywrightHttp.Get(
            init,
            init.host.TrimEnd('/') + "/",
            cookies: cookies,
            headers: HeadersModel.Init(
                ("referer", init.host.TrimEnd('/') + "/"),
                ("sec-fetch-dest", "document"),
                ("sec-fetch-mode", "navigate"),
                ("sec-fetch-site", "same-origin")
            )
        );

        if (string.IsNullOrWhiteSpace(catalog) || !catalog.Contains("literal__item", StringComparison.OrdinalIgnoreCase))
            return null;

        string stitle = SearchNameTo.Convert(title);
        string soriginal = SearchNameTo.Convert(original_title);
        string fallback = null;

        var itemRegex = new Regex("<li[^>]*class=[\"'][^\"']*\\bliteral__item\\b[^\"']*[\"'][^>]*>(.*?)</li>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var linkRegex = new Regex("<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var originalRegex = new Regex("<[^>]*class=[\"'][^\"']*\\bliteral__original\\b[^\"']*[\"'][^>]*>(.*?)</[^>]+>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var yearRegex = new Regex("(?<![0-9])(?:19|20)[0-9]{2}(?![0-9])");

        foreach (Match itemMatch in itemRegex.Matches(catalog))
        {
            string block = itemMatch.Groups[1].Value;
            Match linkMatch = linkRegex.Match(block);
            if (!linkMatch.Success)
                continue;

            string href = NormalizePageUrl(linkMatch.Groups[1].Value);
            if (string.IsNullOrEmpty(href))
                continue;

            if (Uri.TryCreate(href, UriKind.Absolute, out Uri pageUri) && pageUri.AbsolutePath.StartsWith("/series/", StringComparison.OrdinalIgnoreCase))
                continue;

            string itemTitle = CleanText(linkMatch.Groups[2].Value);
            string itemOriginal = CleanText(originalRegex.Match(block).Groups[1].Value);

            bool titleMatch = !string.IsNullOrEmpty(stitle) && SearchNameTo.Equals(itemTitle, stitle);
            bool originalMatch = !string.IsNullOrEmpty(soriginal)
                && (SearchNameTo.Equals(itemTitle, soriginal) || SearchNameTo.Equals(itemOriginal, soriginal));

            if (!titleMatch && !originalMatch)
                continue;

            bool hasYear = false;
            bool yearMatch = false;
            if (year > 0)
            {
                string text = CleanText(block);
                foreach (Match ym in yearRegex.Matches(text))
                {
                    if (!short.TryParse(ym.Value, out short itemYear))
                        continue;

                    hasYear = true;
                    if (Math.Abs(itemYear - year) <= 1)
                    {
                        yearMatch = true;
                        break;
                    }
                }
            }

            if (year > 0 && hasYear && !yearMatch)
                continue;

            if (yearMatch)
                return href;

            fallback ??= href;
        }

        return fallback;
    }
    #endregion

    #region Embed
    async public Task<EmbedModel> Embed(string pageUrl)
    {
        pageUrl = NormalizePageUrl(pageUrl);
        if (string.IsNullOrEmpty(pageUrl))
            return null;

        string page = await PlaywrightHttp.Get(
            init,
            pageUrl,
            cookies: cookies,
            headers: HeadersModel.Init(
                ("referer", init.host.TrimEnd('/') + "/"),
                ("sec-fetch-dest", "document"),
                ("sec-fetch-mode", "navigate"),
                ("sec-fetch-site", "same-origin")
            )
        );

        if (string.IsNullOrWhiteSpace(page) || RequiresAuth(page))
            return null;

        List<PlayerCandidate> players = ExtractPlayers(page, pageUrl);
        if (players.Count == 0)
            return null;

        var movies = new List<Episode>();
        var streams = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var player in players)
        {
            Episode episode = await ResolvePlayer(pageUrl, player);
            if (episode == null || string.IsNullOrEmpty(episode.file) || !streams.Add(episode.file))
                continue;

            movies.Add(episode);
        }

        if (movies.Count == 0)
            return null;

        return new EmbedModel { movies = movies.ToArray() };
    }

    async Task<Episode> ResolvePlayer(string pageUrl, PlayerCandidate player)
    {
        string playerHtml;
        try
        {
            playerHtml = await PlaywrightHttp.Get(
                init,
                player.url,
                headers: PlayerHeaders(pageUrl)
            );
        }
        catch
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(playerHtml))
            return null;

        Episode result = ParsePlayer(playerHtml, player.url, player.title);
        if (result != null)
            return result;

        foreach (var nested in ExtractPlayers(playerHtml, player.url))
        {
            if (nested.url.Equals(player.url, StringComparison.OrdinalIgnoreCase))
                continue;

            try
            {
                string nestedHtml = await PlaywrightHttp.Get(init, nested.url, headers: PlayerHeaders(player.url));
                if (string.IsNullOrWhiteSpace(nestedHtml))
                    continue;

                result = ParsePlayer(nestedHtml, nested.url, string.IsNullOrWhiteSpace(nested.title) ? player.title : nested.title);
                if (result != null)
                    return result;
            }
            catch { }
        }

        return null;
    }

    Episode ParsePlayer(string html, string playerUrl, string title)
    {
        string stream = null;
        var subtitles = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        string playerDataJson = ExtractAssignedObject(html, "window.playerData");
        if (!string.IsNullOrEmpty(playerDataJson))
        {
            try
            {
                JObject playerData = JsonConvert.DeserializeObject<JObject>(playerDataJson);
                JToken config = playerData?["config"];

                stream = NormalizeMediaUrl(config?.Value<string>("video"), playerUrl)
                    ?? NormalizeMediaUrl(config?.Value<string>("video_new"), playerUrl);

                if (config?["cc"] is JObject cc)
                {
                    foreach (var property in cc.Properties())
                    {
                        string url = NormalizeMediaUrl(property.Value.Type == JTokenType.String ? property.Value.Value<string>() : null, playerUrl);
                        if (!string.IsNullOrEmpty(url) && !subtitles.ContainsKey(property.Name))
                            subtitles[property.Name] = url;
                    }
                }
            }
            catch { }
        }

        if (string.IsNullOrEmpty(stream) && playerUrl.Contains("lomont.site", StringComparison.OrdinalIgnoreCase))
        {
            Match configMatch = Regex.Match(html, "data-config=([\"'])(.*?)\\1", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (configMatch.Success)
            {
                try
                {
                    string raw = HttpUtility.HtmlDecode(configMatch.Groups[2].Value);
                    JObject config = JsonConvert.DeserializeObject<JObject>(raw);
                    stream = NormalizeMediaUrl(config?.Value<string>("hls"), playerUrl);
                }
                catch { }
            }

            foreach (Match subtitleMatch in Regex.Matches(html, "data-([a-z]{2})_subtitle=([\"'])(.*?)\\2", RegexOptions.IgnoreCase | RegexOptions.Singleline))
            {
                string url = NormalizeMediaUrl(subtitleMatch.Groups[3].Value, playerUrl);
                if (!string.IsNullOrEmpty(url))
                    subtitles[subtitleMatch.Groups[1].Value] = url;
            }
        }

        stream ??= FindStream(html, playerUrl);
        if (string.IsNullOrEmpty(stream))
            return null;

        Uri playerUri = new Uri(playerUrl);
        string label = string.IsNullOrWhiteSpace(title) ? playerUri.Host : CleanText(title);

        return new Episode
        {
            title = string.IsNullOrWhiteSpace(label) ? "FanCDN" : label,
            file = stream,
            subtitle_tracks = subtitles.Count > 0 ? subtitles : null,
            referer = playerUrl,
            origin = $"{playerUri.Scheme}://{playerUri.Authority}"
        };
    }
    #endregion

    #region Players
    List<PlayerCandidate> ExtractPlayers(string html, string baseUrl)
    {
        var result = new List<PlayerCandidate>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        int searchFrom = 0;
        const string cdnMarker = "window.cdnData[";
        while (searchFrom < html.Length)
        {
            int marker = html.IndexOf(cdnMarker, searchFrom, StringComparison.OrdinalIgnoreCase);
            if (marker < 0)
                break;

            int equals = html.IndexOf('=', marker + cdnMarker.Length);
            if (equals < 0 || equals - marker > 128)
            {
                searchFrom = marker + cdnMarker.Length;
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
                AddPlayer(result, seen, item?.Value<string>("player"), item?.Value<string>("name"), baseUrl);
            }
            catch { }
        }

        foreach (Match iframe in Regex.Matches(html, "<iframe\\b[^>]*(?:src|data-src)\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
            AddPlayer(result, seen, iframe.Groups[1].Value, null, baseUrl);

        return result;
    }

    void AddPlayer(List<PlayerCandidate> result, HashSet<string> seen, string rawUrl, string title, string baseUrl)
    {
        string url = NormalizePlayerUrl(rawUrl, baseUrl);
        if (string.IsNullOrEmpty(url) || !seen.Add(url))
            return;

        result.Add(new PlayerCandidate { url = url, title = CleanText(title) });
    }

    string NormalizePlayerUrl(string rawUrl, string baseUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl) || !Uri.TryCreate(baseUrl, UriKind.Absolute, out Uri baseUri))
            return null;

        string value = HttpUtility.HtmlDecode(rawUrl.Trim()).Replace("\\/", "/");
        if (value.StartsWith("//"))
            value = "https:" + value;

        if (!Uri.TryCreate(baseUri, value, out Uri uri) || !IsAllowedPlayer(uri))
            return null;

        return uri.ToString();
    }

    static bool IsAllowedPlayer(Uri uri)
    {
        if (uri == null || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return false;

        foreach (string host in playerHosts)
        {
            if (uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith("." + host, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }
    #endregion

    #region Media
    static string FindStream(string html, string baseUrl)
    {
        if (string.IsNullOrWhiteSpace(html))
            return null;

        string decoded = HttpUtility.HtmlDecode(html)
            .Replace("\\/", "/")
            .Replace("\\u0026", "&", StringComparison.OrdinalIgnoreCase);

        string fallback = null;
        foreach (Match match in Regex.Matches(decoded, "https?://[^\\s\\\"'<>]+?\\.(?:m3u8|mp4)(?:[^\\s\\\"'<>\\\\]*)?", RegexOptions.IgnoreCase))
        {
            string stream = NormalizeMediaUrl(match.Value, baseUrl);
            if (string.IsNullOrEmpty(stream))
                continue;

            if (stream.Contains("master.m3u8", StringComparison.OrdinalIgnoreCase))
                return stream;

            fallback ??= stream;
        }

        return fallback;
    }

    static string NormalizeMediaUrl(string rawUrl, string baseUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl) || !Uri.TryCreate(baseUrl, UriKind.Absolute, out Uri baseUri))
            return null;

        string value = HttpUtility.HtmlDecode(rawUrl.Trim())
            .Replace("\\/", "/")
            .Replace("\\u0026", "&", StringComparison.OrdinalIgnoreCase);

        if (value.StartsWith("//"))
            value = "https:" + value;

        if (!Uri.TryCreate(baseUri, value, out Uri uri) || !IsSafeMediaUri(uri))
            return null;

        return uri.ToString();
    }

    static bool IsSafeMediaUri(Uri uri)
    {
        if (uri == null || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) || string.IsNullOrWhiteSpace(uri.Host))
            return false;

        string host = uri.Host.TrimEnd('.');
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || host.EndsWith(".internal", StringComparison.OrdinalIgnoreCase))
            return false;

        if (!IPAddress.TryParse(host, out IPAddress ip))
            return true;

        if (IPAddress.IsLoopback(ip))
            return false;

        byte[] bytes = ip.GetAddressBytes();
        if (bytes.Length == 4)
        {
            if (bytes[0] == 10 || bytes[0] == 127 || bytes[0] == 0)
                return false;
            if (bytes[0] == 169 && bytes[1] == 254)
                return false;
            if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
                return false;
            if (bytes[0] == 192 && bytes[1] == 168)
                return false;
        }

        return true;
    }
    #endregion

    #region Helpers
    string NormalizePageUrl(string rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl) || !Uri.TryCreate(init.host.TrimEnd('/') + "/", UriKind.Absolute, out Uri baseUri))
            return null;

        string value = HttpUtility.HtmlDecode(rawUrl.Trim());
        if (value.StartsWith("//"))
            value = baseUri.Scheme + ":" + value;

        if (!Uri.TryCreate(baseUri, value, out Uri uri))
            return null;

        if (!uri.Host.Equals(baseUri.Host, StringComparison.OrdinalIgnoreCase))
            return null;

        return uri.ToString();
    }

    static IReadOnlyList<HeadersModel> PlayerHeaders(string referer)
    {
        string origin = null;
        if (Uri.TryCreate(referer, UriKind.Absolute, out Uri uri))
            origin = $"{uri.Scheme}://{uri.Authority}";

        return HeadersModel.Init(
            ("referer", referer),
            ("origin", origin),
            ("sec-fetch-dest", "iframe"),
            ("sec-fetch-mode", "navigate"),
            ("sec-fetch-site", "cross-site")
        );
    }

    static string CleanText(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        string text = Regex.Replace(value, "<[^>]+>", " ");
        text = HttpUtility.HtmlDecode(text);
        text = Regex.Replace(text, "\\s+", " ").Trim();
        return text;
    }

    static bool RequiresAuth(string html)
    {
        if (string.IsNullOrEmpty(html))
            return false;

        return html.Contains("требуется вход в систему", StringComparison.OrdinalIgnoreCase)
            || html.Contains("для доступа к видеоконтенту необходимо иметь учётную запись", StringComparison.OrdinalIgnoreCase)
            || html.Contains("для доступа к видеоконтенту необходимо иметь учетную запись", StringComparison.OrdinalIgnoreCase);
    }

    static string ExtractAssignedObject(string html, string marker)
    {
        if (string.IsNullOrEmpty(html) || string.IsNullOrEmpty(marker))
            return null;

        int markerIndex = html.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0)
            return null;

        int equals = html.IndexOf('=', markerIndex + marker.Length);
        if (equals < 0 || equals - markerIndex > 128)
            return null;

        int start = html.IndexOf('{', equals + 1);
        if (start < 0 || start - equals > 128)
            return null;

        return ExtractJsonObject(html, start, out _);
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

    sealed class PlayerCandidate
    {
        public string url { get; set; }
        public string title { get; set; }
    }
    #endregion

    #region Html
    public ITplResult Tpl(EmbedModel root, string imdb_id, long kinopoisk_id, string title, string original_title, VastConf vast = null, IReadOnlyList<HeadersModel> headers = null)
    {
        if (root?.movies == null || root.movies.Length == 0)
            return default;

        var mtpl = new MovieTpl(title, original_title, root.movies.Length);

        foreach (var m in root.movies)
        {
            if (string.IsNullOrEmpty(m.file))
                continue;

            var streamHeaders = HeadersModel.Init(
                ("referer", m.referer),
                ("origin", m.origin),
                ("sec-fetch-dest", "empty"),
                ("sec-fetch-mode", "cors"),
                ("sec-fetch-site", "cross-site")
            );

            var subtitles = new SubtitleTpl();

            if (m.subtitle_tracks != null)
            {
                foreach (var track in m.subtitle_tracks)
                {
                    if (!string.IsNullOrWhiteSpace(track.Value))
                        subtitles.Append(track.Key, onstreamfile.Invoke(track.Value, streamHeaders));
                }
            }

            if (!string.IsNullOrEmpty(m.subtitles))
            {
                var match = new Regex("\\[([^\\]]+)\\]([^\\,]+)").Match(m.subtitles);
                while (match.Success)
                {
                    string srt = m.file.Replace("/hls.m3u8", "/") + match.Groups[2].Value;
                    subtitles.Append(match.Groups[1].Value, onstreamfile.Invoke(srt, streamHeaders));
                    match = match.NextMatch();
                }
            }

            mtpl.Append(
                m.title,
                onstreamfile.Invoke(m.file, streamHeaders),
                subtitles: subtitles,
                vast: vast,
                headers: headers
            );
        }

        return mtpl;
    }
    #endregion
}
