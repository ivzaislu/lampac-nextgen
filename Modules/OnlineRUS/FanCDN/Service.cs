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
using System.Threading.Tasks;
using System.Web;

namespace FanCDN;

public struct FanCDNInvoke
{
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
    async public Task<(string kp, string key)> Search(string title, string original_title, short year)
    {
        if (string.IsNullOrWhiteSpace(title))
            return default;

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
            return default;

        JArray root = null;
        try
        {
            root = JsonConvert.DeserializeObject<JArray>(search);
        }
        catch { }

        if (root == null || root.Count == 0)
            return default;

        string stitle = SearchNameTo.Convert(title);
        string soriginal = SearchNameTo.Convert(original_title);
        string newsUrl = null;
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
            {
                newsUrl = normalized;
                break;
            }

            string itemYearText = item.Value<string>("year");
            if (!short.TryParse(itemYearText, out short itemYear))
            {
                fallbackUrl ??= normalized;
                continue;
            }

            if (Math.Abs(itemYear - year) <= 1)
            {
                newsUrl = normalized;
                break;
            }
        }

        newsUrl ??= fallbackUrl;
        if (string.IsNullOrEmpty(newsUrl))
            return default;

        string news = await PlaywrightHttp.Get(
            init,
            newsUrl,
            cookies: cookies,
            headers: HeadersModel.Init(
                ("referer", $"{host}/"),
                ("sec-fetch-dest", "document"),
                ("sec-fetch-mode", "navigate"),
                ("sec-fetch-site", "same-origin")
            )
        );

        if (string.IsNullOrWhiteSpace(news) || RequiresAuth(news))
            return default;

        foreach (Match iframe in Regex.Matches(news, "<iframe\\b[^>]*\\bsrc\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
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

    #region Embed
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

    #region Helpers
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

    static bool RequiresAuth(string html)
    {
        if (string.IsNullOrEmpty(html))
            return false;

        return html.Contains("требуется вход в систему", StringComparison.OrdinalIgnoreCase)
            || html.Contains("для доступа к видеоконтенту необходимо иметь учётную запись", StringComparison.OrdinalIgnoreCase)
            || html.Contains("для доступа к видеоконтенту необходимо иметь учетную запись", StringComparison.OrdinalIgnoreCase);
    }
    #endregion

    #region Html
    public ITplResult Tpl(EmbedModel root, string imdb_id, long kinopoisk_id, string title, string original_title, VastConf vast = null, IReadOnlyList<HeadersModel> headers = null)
    {
        if (root?.movies == null || root.movies.Length == 0)
            return default;

        string host = init.host.TrimEnd('/');
        var streamHeaders = HeadersModel.Init(
            ("referer", $"{host}/"),
            ("origin", host),
            ("sec-fetch-dest", "empty"),
            ("sec-fetch-mode", "cors"),
            ("sec-fetch-site", "cross-site")
        );

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
    #endregion
}
