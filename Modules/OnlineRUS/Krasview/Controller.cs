using Microsoft.AspNetCore.Mvc;
using Shared;
using Shared.Attributes;
using Shared.Models.Base;
using Shared.Models.Templates;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;

namespace Krasview;

public class KrasviewController : BaseOnlineController<ModuleConf>
{
    const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

    static readonly Regex SlugBlacklist = new("(treiyler|tizer|obzor|review|reklam|trailer|teaser|preview|fragment|sopustvuyusch|making|behind)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public KrasviewController() : base(ModInit.conf) { }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/krasview")]
    async public Task<ActionResult> Index(string title, string original_title, int year = 0, int serial = 0, short s = -1, bool rjson = false, bool checksearch = false)
    {
        if (await IsRequestBlocked(rch: false))
            return badInitMsg;

        if (checksearch)
        {
            if (string.IsNullOrWhiteSpace(original_title))
                return Json(new { rch = false });

            string checkKind = serial == 1 ? "series" : "movie";
            var checkMatch = await FindMatch(original_title, year, checkKind);
            if (checkMatch == null)
                checkMatch = await FindMatch(original_title, year, checkKind == "movie" ? "series" : "movie");

            if (checkMatch == null)
                return Json(new { rch = false });

            return Json(new
            {
                rch = true,
                type = checkMatch.kind == "series" ? "serial" : "movie",
                quality = "FHD"
            });
        }

        string query = !string.IsNullOrWhiteSpace(original_title) ? original_title.Trim() : title?.Trim();
        if (string.IsNullOrWhiteSpace(query))
            return OnError();

        string kind = serial == 1 ? "series" : "movie";
        var match = await FindMatch(query, year, kind);
        if (match == null)
        {
            match = await FindMatch(query, year, kind == "movie" ? "series" : "movie");
            if (match != null)
                kind = match.kind;
        }

        if (match == null)
            return OnError();

        string sourceHost = kind == "series" ? init.serialhost : init.moviehost;
        if (IsMirrorHost(match.host))
            sourceHost = "https://" + match.host;

        string pageUrl = $"/{match.kind}/{match.slug}";
        string pageHtml = await GetCached(sourceHost + pageUrl, sourceHost + "/");
        if (string.IsNullOrEmpty(pageHtml))
            return OnError();

        if (kind == "movie")
        {
            var movieTpl = await BuildMovie(sourceHost, title, original_title, ParseMovieVideos(pageHtml));
            return ContentTpl(movieTpl);
        }

        var seasons = ParseSeasonCategories(pageHtml);
        if (seasons.Count == 0)
        {
            var eps = ParseSeriesEpisodes(pageHtml);
            if (eps.Count == 0)
            {
                var movieTpl = await BuildMovie(sourceHost, title, original_title, ParseMovieVideos(pageHtml));
                return ContentTpl(movieTpl);
            }

            var episodeTpl = await BuildEpisodes(sourceHost, title, original_title, eps, eps[0].s);
            return ContentTpl(episodeTpl);
        }

        if (s == -1)
        {
            if (seasons.Count == 1)
            {
                var eps = await FetchSeasonEpisodes(sourceHost, match.slug, seasons[0].id);
                if (eps.Count == 0)
                    return OnError();

                var episodeTpl = await BuildEpisodes(sourceHost, title, original_title, eps, eps[0].s);
                return ContentTpl(episodeTpl);
            }

            return ContentTpl(BuildSeasons(title, original_title, year, seasons, rjson));
        }

        int index = Math.Clamp(s - 1, 0, seasons.Count - 1);
        var episodes = await FetchSeasonEpisodes(sourceHost, match.slug, seasons[index].id);
        if (episodes.Count == 0)
            return OnError();

        int realSeason = episodes[0].s > 0 ? episodes[0].s : s;
        var resultTpl = await BuildEpisodes(sourceHost, title, original_title, episodes, realSeason);
        return ContentTpl(resultTpl);
    }

    async Task<string> GetCached(string url, string referer)
    {
        var cache = await InvokeCacheResult<string>($"krasview:{url}", TimeSpan.FromSeconds(init.cache_ttl), async e =>
        {
            var headers = HeadersModel.Init(("Referer", referer ?? string.Empty));
            string html = await httpHydra.Get(url, addheaders: headers, safety: true);
            if (string.IsNullOrEmpty(html))
                return e.Fail("html", refresh_proxy: true);

            return e.Success(html);
        });

        return cache.IsSuccess ? cache.Value : null;
    }

    async Task<List<SearchItem>> SearchOnce(string kind, string query)
    {
        string url = $"{init.searchhost.TrimEnd('/')}/{kind}?mode=search&ajax&query={HttpUtility.UrlEncode(query)}";
        string html = await GetCached(url, init.searchhost.TrimEnd('/') + "/");
        if (string.IsNullOrEmpty(html))
            return new List<SearchItem>();

        var result = new List<SearchItem>();
        var matches = Regex.Matches(html, @"<a[^>]+href='(https?://[^']+/(?:movie|series)/[^']+)'\s+title='([^']*)'", RegexOptions.IgnoreCase);

        foreach (Match m in matches)
        {
            string href = m.Groups[1].Value;
            string rawTitle = m.Groups[2].Value;

            var path = Regex.Match(href, @"/(movie|series)/([^/?#]+)", RegexOptions.IgnoreCase);
            if (!path.Success)
                continue;

            string foundHost = string.Empty;
            if (Uri.TryCreate(href, UriKind.Absolute, out Uri uri))
                foundHost = uri.Host;

            int foundYear = 0;
            var yearMatch = Regex.Match(rawTitle, @"(?:^|\s|\()((?:18|19|20|21)\d{2})(?:\)|\s|$)");
            if (yearMatch.Success)
                int.TryParse(yearMatch.Groups[1].Value, out foundYear);

            string en = string.Join("/", rawTitle.Split('/').Skip(1));
            en = Regex.Replace(en, @"\s+\d{4}\s*$", string.Empty).Trim();

            result.Add(new SearchItem
            {
                url = href,
                host = foundHost,
                kind = path.Groups[1].Value.ToLowerInvariant(),
                slug = path.Groups[2].Value,
                en = en,
                year = foundYear
            });
        }

        return result;
    }

    async Task<SearchItem> FindMatch(string originalTitle, int year, string kind)
    {
        if (string.IsNullOrWhiteSpace(originalTitle))
            return null;

        var results = await SearchOnce(kind, originalTitle);
        return PickBest(results, originalTitle, year, init.match_year_tolerance <= 0 ? 1 : init.match_year_tolerance);
    }

    static SearchItem PickBest(List<SearchItem> results, string originalTitle, int year, int tolerance)
    {
        if (results == null || results.Count == 0)
            return null;

        string want = AsciiNorm(originalTitle);
        SearchItem best = null;
        int bestScore = -1;

        foreach (var item in results)
        {
            int score = 0;
            string en = AsciiNorm(item.en);

            if (!string.IsNullOrEmpty(want) && en == want)
                score += 100;
            else if (!string.IsNullOrEmpty(want) && en.Contains(want, StringComparison.Ordinal))
                score += 50;
            else if (!string.IsNullOrEmpty(want) && en.Length > 3 && want.Contains(en, StringComparison.Ordinal))
                score += 30;

            if (year > 0 && item.year > 0)
            {
                int diff = Math.Abs(item.year - year);
                if (diff == 0)
                    score += 30;
                else if (diff <= tolerance)
                    score += 10;
                else
                    score -= 20;
            }

            if (score > bestScore)
            {
                bestScore = score;
                best = item;
            }
        }

        return bestScore >= 30 ? best : null;
    }

    static string AsciiNorm(string value)
    {
        value = (value ?? string.Empty).ToLowerInvariant();
        value = Regex.Replace(value, "[^a-z0-9]+", " ");
        return Regex.Replace(value, @"\s+", " ").Trim();
    }

    async Task<VideoConfig> FetchVideoConfig(string sourceHost, string href)
    {
        string html = await GetCached(sourceHost.TrimEnd('/') + href, sourceHost.TrimEnd('/') + "/");
        if (string.IsNullOrEmpty(html))
            return null;

        var match = Regex.Match(html, @"video_Init\('([A-Za-z0-9+/=]+)'", RegexOptions.IgnoreCase);
        if (!match.Success)
            return null;

        try
        {
            string json = Encoding.UTF8.GetString(Convert.FromBase64String(match.Groups[1].Value));
            return JsonSerializer.Deserialize<VideoConfig>(json);
        }
        catch
        {
            return null;
        }
    }

    string StreamUrl(VideoConfig data)
    {
        if (string.IsNullOrWhiteSpace(data?.url))
            return null;

        string url = data.url;
        if (init.prefer_hls && Regex.IsMatch(url, @"\.mpd($|\?)", RegexOptions.IgnoreCase))
            url = Regex.Replace(url, @"\.mpd(\?|$)", ".m3u8$1", RegexOptions.IgnoreCase);

        return url;
    }

    static int AudioCount(VideoConfig data)
        => data?.audio_info?.Count ?? 0;

    static List<VideoItem> ParseMovieVideos(string html)
    {
        var primary = new List<VideoItem>();
        var fallback = new List<VideoItem>();
        var seen = new HashSet<string>();

        foreach (Match m in Regex.Matches(html ?? string.Empty, @"href='(/video/(\d+)-([^']+))'", RegexOptions.IgnoreCase))
        {
            string id = m.Groups[2].Value;
            string slug = m.Groups[3].Value;

            if (!seen.Add(id) || SlugBlacklist.IsMatch(slug))
                continue;

            var item = new VideoItem
            {
                id = id,
                href = m.Groups[1].Value,
                slug = slug
            };

            if (Regex.IsMatch(slug, @"(^|[._-])film\b|[._-]film($|[._-])", RegexOptions.IgnoreCase))
                primary.Add(item);
            else
                fallback.Add(item);
        }

        return primary.Count > 0 ? primary : fallback;
    }

    static List<SeasonItem> ParseSeasonCategories(string html)
    {
        var result = new List<SeasonItem>();
        var seen = new HashSet<int>();

        foreach (Match m in Regex.Matches(html ?? string.Empty, @"<li[^>]+id='c-(\d+)'[^>]*>\s*<a[^>]+href='/(?:series|movie)/[^']+\?category=\d+", RegexOptions.IgnoreCase))
        {
            if (!int.TryParse(m.Groups[1].Value, out int id) || id == 0 || !seen.Add(id))
                continue;

            result.Add(new SeasonItem { id = id });
        }

        return result;
    }

    static List<VideoItem> ParseSeriesEpisodes(string html)
    {
        var result = new List<VideoItem>();
        var seen = new HashSet<string>();

        foreach (Match m in Regex.Matches(html ?? string.Empty, @"href='(/video/(\d+)-([^']+))'", RegexOptions.IgnoreCase))
        {
            string id = m.Groups[2].Value;
            string slug = m.Groups[3].Value;
            if (!seen.Add(id) || SlugBlacklist.IsMatch(slug))
                continue;

            var sm = Regex.Match(slug, @"(\d+)\.sezon", RegexOptions.IgnoreCase);
            var em = Regex.Match(slug, @"(\d+)\.seriya", RegexOptions.IgnoreCase);
            if (!sm.Success || !em.Success)
                continue;

            if (!int.TryParse(sm.Groups[1].Value, out int season) || !int.TryParse(em.Groups[1].Value, out int episode))
                continue;

            result.Add(new VideoItem
            {
                id = id,
                href = m.Groups[1].Value,
                slug = slug,
                s = season,
                e = episode
            });
        }

        return result.OrderBy(i => i.s).ThenBy(i => i.e).ToList();
    }

    async Task<List<VideoItem>> FetchSeasonEpisodes(string sourceHost, string slug, int categoryId)
    {
        var all = new List<VideoItem>();
        var seen = new HashSet<string>();

        for (int page = 1; page <= 10; page++)
        {
            string url = $"{sourceHost.TrimEnd('/')}/series/{slug}/?category={categoryId}" + (page > 1 ? $"&page={page}" : string.Empty);
            string html = await GetCached(url, $"{sourceHost.TrimEnd('/')}/series/{slug}");
            if (string.IsNullOrEmpty(html))
                break;

            var part = ParseSeriesEpisodes(html);
            if (part.Count == 0)
                break;

            int added = 0;
            foreach (var item in part)
            {
                if (seen.Add(item.id))
                {
                    all.Add(item);
                    added++;
                }
            }

            if (added == 0)
                break;

            string nextPattern = $"href='[^']*\\?(?:category=\\d+&)?page={page + 1}'";
            if (!Regex.IsMatch(html, nextPattern, RegexOptions.IgnoreCase))
                break;
        }

        return all.OrderBy(i => i.s).ThenBy(i => i.e).ToList();
    }

    async Task<ITplResult> BuildMovie(string sourceHost, string title, string originalTitle, List<VideoItem> videos)
    {
        if (videos == null || videos.Count == 0)
            return null;

        foreach (var video in videos)
        {
            var config = await FetchVideoConfig(sourceHost, video.href);
            string stream = ProxyStream(StreamUrl(config));
            if (string.IsNullOrEmpty(stream))
                continue;

            string name = JoinName(title, originalTitle);
            if (string.IsNullOrWhiteSpace(name))
                name = "Krasview";

            int audio = AudioCount(config);
            var tpl = new MovieTpl(title, originalTitle, 1);
            tpl.Append(
                audio > 1 ? $"{name} [{audio} озвучек]" : name,
                stream,
                voice_name: audio > 1 ? $"{audio} озвучек" : null
            );
            return tpl;
        }

        return null;
    }

    ITplResult BuildSeasons(string title, string originalTitle, int year, List<SeasonItem> seasons, bool rjson)
    {
        if (seasons == null || seasons.Count == 0)
            return null;

        var tpl = new SeasonTpl(seasons.Count);
        string encTitle = HttpUtility.UrlEncode(title);
        string encOriginal = HttpUtility.UrlEncode(originalTitle);

        for (int i = 0; i < seasons.Count; i++)
        {
            int season = i + 1;
            tpl.Append(
                $"Сезон {season}",
                $"{host}/lite/krasview?title={encTitle}&original_title={encOriginal}&year={year}&serial=1&rjson={rjson}&s={season}",
                season
            );
        }

        return tpl;
    }

    async Task<ITplResult> BuildEpisodes(string sourceHost, string title, string originalTitle, List<VideoItem> episodes, int season)
    {
        var filtered = episodes?.Where(i => i.s == season).ToList() ?? new List<VideoItem>();
        if (filtered.Count == 0)
            return null;

        var tpl = new EpisodeTpl(filtered.Count);
        string baseTitle = JoinName(title, originalTitle);
        if (string.IsNullOrWhiteSpace(baseTitle))
            baseTitle = title ?? originalTitle ?? "Krasview";

        foreach (var episode in filtered)
        {
            var config = await FetchVideoConfig(sourceHost, episode.href);
            string stream = ProxyStream(StreamUrl(config));
            if (string.IsNullOrEmpty(stream))
                continue;

            int audio = AudioCount(config);
            tpl.Append(
                $"Серия {episode.e}",
                baseTitle,
                (short)episode.s,
                episode.e.ToString(),
                stream,
                voice_name: audio > 1 ? $"{audio} озвучек" : null
            );
        }

        return tpl;
    }

    string ProxyStream(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return null;

        if (url.StartsWith("//", StringComparison.Ordinal))
            url = "https:" + url;

        if (!init.streamproxy)
            return url;

        string referer = string.IsNullOrWhiteSpace(init.stream_referer)
            ? init.moviehost.TrimEnd('/') + "/"
            : init.stream_referer;

        string origin = referer.TrimEnd('/');
        var headers = HeadersModel.Init(
            ("Referer", referer),
            ("Origin", origin),
            ("User-Agent", UA)
        );

        return HostStreamProxy(url, headers, force_streamproxy: true);
    }

    static bool IsMirrorHost(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        return Regex.IsMatch(value, @"(smartkino|sersoap|zseek|krasview|hlamer)\.ru$", RegexOptions.IgnoreCase);
    }

    static string JoinName(string title, string originalTitle)
        => string.Join(" / ", new[] { title, originalTitle }.Where(i => !string.IsNullOrWhiteSpace(i)));
}
