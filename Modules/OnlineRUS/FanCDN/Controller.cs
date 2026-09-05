using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared;
using Shared.Attributes;
using Shared.Models.Base;
using Shared.Services.HTTP;
using Shared.Services.Utilities;
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web;
using BrowserCookie = Microsoft.Playwright.Cookie;

namespace FanCDN;

public class FanCDNController : BaseOnlineController
{
    #region FanCDNController
    static List<BrowserCookie> cookies;
    static string cookiesKey;
    static readonly SemaphoreSlim browserGate = new(2, 2);

    public FanCDNController() : base(ModInit.conf)
    {
        requestInitialization += () =>
        {
            string currentKey = $"{init.host}|{init.cookie}";
            if (cookiesKey == currentKey)
                return;

            cookiesKey = currentKey;
            cookies = null;

            if (string.IsNullOrWhiteSpace(init.cookie) || !Uri.TryCreate(init.host, UriKind.Absolute, out Uri fanUri))
                return;

            var result = new List<BrowserCookie>();
            long expires = DateTimeOffset.UtcNow.AddYears(1).ToUnixTimeSeconds();

            foreach (string line in init.cookie.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;

                int separator = line.IndexOf('=');
                if (separator <= 0)
                    continue;

                string name = line.Substring(0, separator).Trim();
                string value = line.Substring(separator + 1).Trim();
                if (string.IsNullOrEmpty(name))
                    continue;

                result.Add(new BrowserCookie
                {
                    Domain = "." + fanUri.Host,
                    Expires = expires,
                    Path = "/",
                    HttpOnly = true,
                    Secure = fanUri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase),
                    Name = name,
                    Value = value
                });
            }

            if (result.Count > 0)
                cookies = result;
        };
    }
    #endregion

    #region Index
    [HttpGet, Staticache(manually: true)]
    [Route("lite/fancdn")]
    async public Task<ActionResult> Index(
        string imdb_id,
        long kinopoisk_id,
        string title,
        string original_title,
        short year = 0,
        short serial = 0,
        short s = -1,
        string voice = null,
        bool rjson = false)
    {
        try
        {
            return await IndexCore(imdb_id, kinopoisk_id, title, original_title, year, serial, s, voice, rjson);
        }
        catch (OperationCanceledException)
        {
            return OnError("timeout", gbcache: false);
        }
        catch (System.Net.Http.HttpRequestException)
        {
            return OnError("network", gbcache: false);
        }
        catch (System.IO.IOException)
        {
            return OnError("network", gbcache: false);
        }
    }

    async Task<ActionResult> IndexCore(
        string imdb_id,
        long kinopoisk_id,
        string title,
        string original_title,
        short year,
        short serial,
        short s,
        string voice,
        bool rjson)
    {
        if (await IsRequestBlocked(rch: false))
            return badInitMsg;

        if (kinopoisk_id == 0 || cookies == null)
            return OnError();

        var oninvk = new FanCDNInvoke
        (
            init,
            cookies,
            (streamfile, streamHeaders) => HostStreamProxy(streamfile, streamHeaders)
        );

        bool serialRequest = serial == 1 || s > 0;

        if (serialRequest)
        {
            List<int> preloadedSeasons = null;

            var search = await InvokeCacheResult<string>($"fancdn:v15:serial:search:{kinopoisk_id}:{title}:{original_title}:{year}", TimeSpan.FromHours(1), onget: async e =>
            {
                var resolved = await SearchSeriesPageFast(kinopoisk_id, title, original_title, year);
                preloadedSeasons = resolved.seasons;

                if (string.IsNullOrEmpty(resolved.url))
                    return e.Fail("search");

                return e.Success(resolved.url);
            });

            if (!search.IsSuccess)
                return OnError(search.ErrorMsg);

            if (s <= 0)
            {
                var seasons = await InvokeCacheResult<List<int>>($"fancdn:v12:seasons:{search.Value}", 30, textJson: true, onget: async e =>
                {
                    List<int> result = preloadedSeasons != null && preloadedSeasons.Count > 0
                        ? preloadedSeasons
                        : await FetchSeasonsFast(search.Value);

                    if (result == null || result.Count == 0)
                        return e.Fail("seasons");

                    return e.Success(result);
                });

                return ContentTpl(seasons,
                    () => oninvk.TplSeasons(seasons.Value, host, imdb_id, kinopoisk_id, title, original_title, year, rjson)
                );
            }

            var season = await InvokeCacheResult<FanCdnSerialSeason>($"fancdn:v12:serial:{search.Value}:{s}", 20, textJson: true, onget: async e =>
            {
                FanCdnSerialSeason result = await TryTransient(() => oninvk.Serial(search.Value, s));
                if (result == null)
                    return e.Fail("serial");

                return e.Success(result);
            });

            return ContentTpl(season,
                () => oninvk.TplSerial(
                    season.Value,
                    host,
                    imdb_id,
                    kinopoisk_id,
                    title,
                    original_title,
                    year,
                    voice,
                    rjson,
                    vast: init.vast,
                    headers: httpHeaders(init)
                )
            );
        }

        var movieSearch = await InvokeCacheResult<(string kp, string key)>($"fancdn:v14:movie:search:{kinopoisk_id}:{title}:{original_title}:{year}", TimeSpan.FromHours(1), onget: async e =>
        {
            var result = await SearchMovieFast(kinopoisk_id, title, original_title, year);
            if (!ValidMovieResult(result, kinopoisk_id))
                return e.Fail("search");

            return e.Success(result);
        });

        if (!movieSearch.IsSuccess)
            return OnError(movieSearch.ErrorMsg);

        var cache = await InvokeCacheResult<EmbedModel>($"fancdn:v12:movie:embed:{movieSearch.Value.kp}:{movieSearch.Value.key}", 20, textJson: true, onget: async e =>
        {
            EmbedModel result = await EmbedMovieFast(movieSearch.Value.kp, movieSearch.Value.key);
            if (result == null)
                return e.Fail("embed");

            return e.Success(result);
        });

        return ContentTpl(cache,
            () => oninvk.Tpl(cache.Value, title, original_title, vast: init.vast, headers: httpHeaders(init))
        );
    }
    #endregion

    #region Search
    async Task<string> SearchPageHttp(string title, string original_title, short year)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;

        string host = init.host.TrimEnd('/');
        var headers = HeadersModel.Init(
            ("referer", $"{host}/"),
            ("sec-fetch-dest", "empty"),
            ("sec-fetch-mode", "cors"),
            ("sec-fetch-site", "same-origin")
        );

        string search = await SiteGetFast(
            $"{host}/engine/ajax/msearch.php?q={HttpUtility.UrlEncode(title)}",
            headers,
            $"{host}/",
            expectJson: true
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
            string itemAltTitles = System.Net.WebUtility.HtmlDecode(item.Value<string>("alt_titles") ?? string.Empty);

            bool titleMatch = !string.IsNullOrEmpty(stitle) &&
                (SearchNameTo.Equals(itemTitle, stitle) ||
                 SearchNameTo.Equals(itemOriginal, stitle) ||
                 SearchNameTo.Contains(itemAltTitles, stitle));
            bool originalMatch = !string.IsNullOrEmpty(soriginal) &&
                (SearchNameTo.Equals(itemTitle, soriginal) ||
                 SearchNameTo.Equals(itemOriginal, soriginal) ||
                 SearchNameTo.Contains(itemAltTitles, soriginal));
            if (!titleMatch && !originalMatch)
                continue;

            string normalized = FanCDNHelper.NormalizeSiteUrl(init.host, item.Value<string>("url"));
            if (string.IsNullOrEmpty(normalized))
                continue;

            if (year <= 0)
                return normalized;

            if (!short.TryParse(item.Value<string>("year"), out short itemYear))
            {
                fallbackUrl ??= normalized;
                continue;
            }

            if (Math.Abs(itemYear - year) <= 1)
                return normalized;
        }

        return fallbackUrl;
    }
    #endregion

    #region Movie
    async Task<(string kp, string key)> SearchMovieFast(long kinopoisk_id, string title, string original_title, short year)
    {
        var result = await SearchMovieHttp(title, original_title, year);
        if (ValidMovieResult(result, kinopoisk_id))
            return result;

        if (!string.IsNullOrWhiteSpace(original_title) && !original_title.Equals(title, StringComparison.OrdinalIgnoreCase))
        {
            result = await SearchMovieHttp(original_title, title, year);
            if (ValidMovieResult(result, kinopoisk_id))
                return result;
        }

        return default;
    }

    async Task<(string kp, string key)> SearchMovieHttp(string title, string original_title, short year)
    {
        string pageUrl = await SearchPageHttp(title, original_title, year);
        if (string.IsNullOrEmpty(pageUrl))
            return default;

        string host = init.host.TrimEnd('/');
        var headers = HeadersModel.Init(
            ("referer", $"{host}/"),
            ("sec-fetch-dest", "document"),
            ("sec-fetch-mode", "navigate"),
            ("sec-fetch-site", "same-origin")
        );

        (string kp, string key) ParsePlayer(string page)
        {
            if (string.IsNullOrWhiteSpace(page) || FanCDNHelper.RequiresAuth(page))
                return default;

            foreach (Match iframe in Regex.Matches(page, "<iframe\\b[^>]*\\bsrc\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
            {
                string playerUrl = FanCDNHelper.NormalizeSiteUrl(init.host, iframe.Groups[1].Value);
                if (string.IsNullOrEmpty(playerUrl) || !Uri.TryCreate(playerUrl, UriKind.Absolute, out Uri playerUri))
                    continue;

                Match path = Regex.Match(playerUri.AbsolutePath, "^/movies/([0-9]+)/?$", RegexOptions.IgnoreCase);
                if (!path.Success)
                    continue;

                string key = HttpUtility.ParseQueryString(playerUri.Query).Get("key");
                if (!string.IsNullOrWhiteSpace(key))
                    return (path.Groups[1].Value, key);
            }

            return default;
        }

        string page = await Shared.Services.Http.Get(
            pageUrl,
            cookie: init.cookie,
            referer: $"{host}/",
            timeoutSeconds: 8,
            headers: headers
        );

        var result = ParsePlayer(page);
        if (!string.IsNullOrEmpty(result.kp))
            return result;

        await browserGate.WaitAsync();
        try
        {
            page = await PlaywrightHttp.Get(init, pageUrl, cookies: cookies, headers: headers);
        }
        finally
        {
            browserGate.Release();
        }

        return ParsePlayer(page);
    }

    async Task<EmbedModel> EmbedMovieFast(string kp, string key)
    {
        if (string.IsNullOrWhiteSpace(kp) || !Regex.IsMatch(kp, "^[0-9]+$") || string.IsNullOrWhiteSpace(key))
            return null;

        string host = init.host.TrimEnd('/');
        string encodedKey = HttpUtility.UrlEncode(key);
        string movieUrl = $"{host}/movies/{kp}?key={encodedKey}";
        var headers = HeadersModel.Init(
            ("referer", movieUrl),
            ("sec-fetch-dest", "empty"),
            ("sec-fetch-mode", "cors"),
            ("sec-fetch-site", "same-origin")
        );

        string json = await SiteGetFast(
            $"{host}/film.php?kp={kp}&key={encodedKey}",
            headers,
            movieUrl,
            expectJson: true
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

            string file = FanCDNHelper.NormalizeFanCdnUrl(movie.file);
            if (string.IsNullOrEmpty(file))
                continue;

            movie.file = file;
            movies.Add(movie);
        }

        return movies.Count == 0 ? null : new EmbedModel { movies = movies.ToArray() };
    }

    static bool ValidMovieResult((string kp, string key) result, long kinopoisk_id)
    {
        if (string.IsNullOrEmpty(result.kp) || string.IsNullOrEmpty(result.key))
            return false;

        return kinopoisk_id <= 0 || result.kp == kinopoisk_id.ToString();
    }
    #endregion

    #region Serial
    async Task<(string url, List<int> seasons)> SearchSeriesPageFast(long kinopoisk_id, string title, string original_title, short year)
    {
        string candidate = await SearchPageHttp(title, original_title, year);
        var resolved = await ResolveSeriesPage(candidate, kinopoisk_id);
        if (!string.IsNullOrEmpty(resolved.url))
            return resolved;

        if (!string.IsNullOrWhiteSpace(original_title) && !original_title.Equals(title, StringComparison.OrdinalIgnoreCase))
        {
            candidate = await SearchPageHttp(original_title, title, year);
            return await ResolveSeriesPage(candidate, kinopoisk_id);
        }

        return default;
    }

    async Task<(string url, List<int> seasons)> ResolveSeriesPage(string candidate, long kinopoisk_id)
    {
        if (string.IsNullOrWhiteSpace(candidate) || !Uri.TryCreate(candidate, UriKind.Absolute, out Uri candidateUri))
            return default;

        if (!Uri.TryCreate(init.host, UriKind.Absolute, out Uri baseUri) ||
            !candidateUri.Host.Equals(baseUri.Host, StringComparison.OrdinalIgnoreCase))
            return default;

        if (IsSeriesContentPath(candidateUri.AbsolutePath))
            return (candidateUri.ToString(), null);

        if (!candidateUri.AbsolutePath.Equals("/index.php", StringComparison.OrdinalIgnoreCase) ||
            !Regex.IsMatch(candidateUri.Query, @"(?:^\?|&)newsid=\d+(?:&|$)", RegexOptions.IgnoreCase))
            return default;

        string host = init.host.TrimEnd('/');
        var headers = HeadersModel.Init(
            ("referer", $"{host}/"),
            ("sec-fetch-dest", "document"),
            ("sec-fetch-mode", "navigate"),
            ("sec-fetch-site", "same-origin")
        );

        string page = await SiteGetFast(candidateUri.ToString(), headers, $"{host}/", expectJson: false);
        if (string.IsNullOrWhiteSpace(page))
            return default;

        Match kpMarker = Regex.Match(
            page,
            @"getElementById\s*\(\s*[""']kp(?<id>\d+)[""']\s*\)",
            RegexOptions.IgnoreCase
        );
        if (kpMarker.Success && kinopoisk_id > 0 && kpMarker.Groups["id"].Value != kinopoisk_id.ToString())
            return default;

        foreach (Match tag in Regex.Matches(page, @"<link\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            if (!Regex.IsMatch(tag.Value, @"\brel\s*=\s*[""'][^""']*\bcanonical\b[^""']*[""']", RegexOptions.IgnoreCase))
                continue;

            Match href = Regex.Match(tag.Value, @"\bhref\s*=\s*[""']([^""']+)[""']", RegexOptions.IgnoreCase);
            if (!href.Success)
                continue;

            string raw = System.Net.WebUtility.HtmlDecode(href.Groups[1].Value);
            if (!Uri.TryCreate(candidateUri, raw, out Uri canonicalUri))
                continue;

            if (!canonicalUri.Host.Equals(baseUri.Host, StringComparison.OrdinalIgnoreCase) ||
                !IsSeriesContentPath(canonicalUri.AbsolutePath))
                continue;

            return (canonicalUri.ToString(), ParseSeasonsFromPage(page, canonicalUri));
        }

        return default;
    }

    async Task<List<int>> FetchSeasonsFast(string seriesUrl)
    {
        if (!Uri.TryCreate(seriesUrl, UriKind.Absolute, out Uri uri))
            return null;

        string host = init.host.TrimEnd('/');
        var headers = HeadersModel.Init(
            ("referer", $"{host}/"),
            ("sec-fetch-dest", "document"),
            ("sec-fetch-mode", "navigate"),
            ("sec-fetch-site", "same-origin")
        );

        string page = await SiteGetFast(seriesUrl, headers, $"{host}/", expectJson: false);
        return ParseSeasonsFromPage(page, uri);
    }

    static List<int> ParseSeasonsFromPage(string page, Uri canonicalUri)
    {
        if (string.IsNullOrWhiteSpace(page) || canonicalUri == null)
            return null;

        string rootPath = FanCDNHelper.SeriesRootPath(canonicalUri.AbsolutePath);
        var seasons = new HashSet<int>();

        foreach (Match link in Regex.Matches(page, @"href\s*=\s*[""']([^""']+)[""']", RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            string raw = System.Net.WebUtility.HtmlDecode(link.Groups[1].Value);
            if (!Uri.TryCreate(canonicalUri, raw, out Uri uri))
                continue;

            if (!uri.Host.Equals(canonicalUri.Host, StringComparison.OrdinalIgnoreCase) ||
                !uri.AbsolutePath.StartsWith(rootPath + "/", StringComparison.OrdinalIgnoreCase))
                continue;

            Match season = Regex.Match(uri.AbsolutePath.Substring(rootPath.Length), @"^/([0-9]+)-season(?:\.html|/)", RegexOptions.IgnoreCase);
            if (season.Success && int.TryParse(season.Groups[1].Value, out int number) && number > 0)
                seasons.Add(number);
        }

        if (seasons.Count == 0)
            return null;

        var result = new List<int>(seasons);
        result.Sort();
        return result;
    }

    static bool IsSeriesContentPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return false;

        return Regex.IsMatch(
            path,
            @"^/[0-9]+-[^/]+(?:\.html|/[0-9]+-season(?:\.html|/[0-9]+-episode\.html)?)?$",
            RegexOptions.IgnoreCase
        );
    }
    #endregion

    #region HTTP
    async Task<string> SiteGetFast(string url, IReadOnlyList<HeadersModel> headers, string referer, bool expectJson)
    {
        string direct = await Shared.Services.Http.Get(
            url,
            cookie: init.cookie,
            referer: referer,
            timeoutSeconds: 8,
            headers: headers
        );

        if (UsableResponse(direct, expectJson))
            return direct;

        await browserGate.WaitAsync();
        try
        {
            return await PlaywrightHttp.Get(init, url, cookies: cookies, headers: headers);
        }
        finally
        {
            browserGate.Release();
        }
    }

    static bool UsableResponse(string value, bool expectJson)
    {
        if (FanCDNHelper.IsChallengeResponse(value))
            return false;

        if (!expectJson)
            return true;

        string trimmed = value.TrimStart();
        return trimmed.StartsWith("[") || trimmed.StartsWith("{");
    }
    #endregion

    #region Helpers
    async Task<T> TryTransient<T>(Func<Task<T>> action)
    {
        try
        {
            return await action();
        }
        catch (OperationCanceledException)
        {
            return default;
        }
        catch (System.Net.Http.HttpRequestException)
        {
            return default;
        }
        catch (System.IO.IOException)
        {
            return default;
        }
    }
    #endregion
}
