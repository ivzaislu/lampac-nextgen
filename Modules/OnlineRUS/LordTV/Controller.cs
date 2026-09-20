using Microsoft.AspNetCore.Mvc;
using Shared;
using Shared.Attributes;
using Shared.Models.Base;
using Shared.Models.Templates;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;

namespace LordTV;

public class LordTVController : BaseOnlineController<ModuleConf>
{
    public LordTVController() : base(ModInit.conf) { }

    static readonly string[] QualityOrder = { "1080p", "720p", "480p", "360p" };

    [HttpGet, Staticache(manually: true)]
    [Route("lite/lordtv")]
    async public Task<ActionResult> Index(string imdb_id, long kinopoisk_id, string title, string original_title,
        short year = 0, short s = -1, string t = null, string cid = null, bool rjson = false, bool checksearch = false)
    {
        if (await IsRequestBlocked(rch: true))
            return badInitMsg;

        if (checksearch)
            return await CheckSearch(title, original_title, kinopoisk_id, year);

        var series = await ResolveSeries(cid, kinopoisk_id, imdb_id, title, original_title, year);
        if (series == null || string.IsNullOrEmpty(series.id))
            return OnError();

        var seasons = (series.seasons ?? new List<SeasonItem>())
            .Where(i => i != null && i.season_number > 0)
            .OrderBy(i => i.season_number)
            .ToList();

        if (seasons.Count == 0)
            return OnError();

        string args = $"&rjson={rjson}&cid={HttpUtility.UrlEncode(series.id)}&kinopoisk_id={kinopoisk_id}&title={HttpUtility.UrlEncode(title)}&original_title={HttpUtility.UrlEncode(original_title)}";

        if (s == -1)
        {
            var tpl = new SeasonTpl("1080p", seasons.Count);

            foreach (var season in seasons)
            {
                string name = string.IsNullOrWhiteSpace(season.title)
                    ? $"{season.season_number} сезон"
                    : season.title;

                tpl.Append(name, $"{host}/lite/lordtv?s={season.season_number}{args}", (short)season.season_number);
            }

            return ContentTpl(tpl);
        }

        var selected = seasons.FirstOrDefault(i => i.season_number == s) ?? seasons[0];
        var episodes = (selected.episodes ?? new List<EpisodeItem>())
            .Where(i => i != null && i.episode_number > 0 && !string.IsNullOrEmpty(i.id))
            .GroupBy(i => i.episode_number)
            .Select(g => g.First())
            .OrderBy(i => i.episode_number)
            .ToList();

        if (episodes.Count == 0)
            return OnError();

        var voices = await Voiceovers(series.id, selected.season_number, episodes[0]);
        if (string.IsNullOrEmpty(t) && voices.Count > 0)
            t = voices[0].slug;

        var vtpl = new VoiceTpl();
        foreach (var voice in voices)
        {
            vtpl.Append(
                voice.name ?? voice.slug,
                t == voice.slug,
                $"{host}/lite/lordtv?s={selected.season_number}&t={HttpUtility.UrlEncode(voice.slug)}{args}"
            );
        }

        string baseTitle = title ?? series.title ?? original_title ?? series.original_title;
        var etpl = new EpisodeTpl(vtpl);

        foreach (var episode in episodes)
        {
            string link = $"{host}/lite/lordtv/video?cid={HttpUtility.UrlEncode(series.id)}&eid={HttpUtility.UrlEncode(episode.id)}&s={selected.season_number}&e={episode.episode_number}&t={HttpUtility.UrlEncode(t)}&title={HttpUtility.UrlEncode(baseTitle)}";

            etpl.Append(
                $"{episode.episode_number} серия",
                baseTitle,
                (short)selected.season_number,
                (short)episode.episode_number,
                link,
                "call",
                streamlink: accsArgs($"{link}&play=true"),
                vast: init.vast
            );
        }

        return ContentTpl(etpl);
    }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/lordtv/video")]
    async public Task<ActionResult> Video(string cid, string eid, short s = 0, short e = 0, string t = null, string title = null, bool play = false)
    {
        if (await IsRequestBlocked(rch: true, rch_check: false))
            return badInitMsg;

        if (rch != null)
        {
            if (rch.IsNotConnected())
            {
                if (init.rhub_fallback && play)
                    rch.Disabled();
                else
                    return Content(rch.connectionMsg, "application/json; charset=utf-8");
            }

            if (!play && rch.IsRequiredConnected())
                return Content(rch.connectionMsg, "application/json; charset=utf-8");

            if (rch.IsNotSupport(out string rch_error))
                return ShowError(rch_error);
        }

        if (string.IsNullOrEmpty(eid) && string.IsNullOrEmpty(cid))
            return OnError();

        if (string.IsNullOrEmpty(EmbedToken()) && string.IsNullOrEmpty(ApiToken()))
            return ShowError("Укажите LordTV.embed_token или LordTV.apitoken в init.conf");

    rhubFallback:
        var cache = await InvokeCacheResult<string>(ipkey($"lordtv:video:{cid}:{eid}:{s}:{e}:{t}"), 15, async err =>
        {
            string hls = await ResolveStream(cid, eid, s, e, t);
            if (string.IsNullOrEmpty(hls))
                return err.Fail("stream", refresh_proxy: true);

            return err.Success(hls);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        if (!cache.IsSuccess)
            return ShowError("LORD.TV не отдал поток. Проверь embed_token / origin");

        string link = HostStreamProxy(cache.Value, StreamHeaders(), force_streamproxy: true);

        if (play)
            return RedirectToPlay(link);

        return ContentTo(VideoTpl.ToJson(
            "play",
            link,
            title,
            vast: init.vast,
            httpContext: HttpContext,
            headers: init.streamproxy ? null : httpHeaders(init.host, init.headers_stream)
        ));
    }

    async Task<ActionResult> CheckSearch(string title, string originalTitle, long kinopoiskId, short year)
    {
        var series = await ResolveSeries(null, kinopoiskId, null, title, originalTitle, year);
        if (series == null)
            return Json(new { rch = false });

        return Json(new { rch = true, type = "serial", quality = "HD" });
    }

    async Task<SeriesItem> ResolveSeries(string cid, long kinopoiskId, string imdbId, string title, string originalTitle, short year)
    {
        if (!string.IsNullOrWhiteSpace(cid))
        {
            var byId = await GetJson<SeriesItem>($"/api/v1/series/{cid}");
            if (byId != null && !string.IsNullOrEmpty(byId.id))
                return byId;
        }

        if (!string.IsNullOrWhiteSpace(title))
        {
            var byTitle = await FindSeries(title, kinopoiskId, imdbId, year);
            if (byTitle != null)
                return await EnsureSeasons(byTitle);
        }

        if (!string.IsNullOrWhiteSpace(originalTitle) &&
            !string.Equals(title, originalTitle, StringComparison.OrdinalIgnoreCase))
        {
            var byOrig = await FindSeries(originalTitle, kinopoiskId, imdbId, year);
            if (byOrig != null)
                return await EnsureSeasons(byOrig);
        }

        return null;
    }

    async Task<SeriesItem> FindSeries(string query, long kinopoiskId, string imdbId, short year)
    {
        string search = string.IsNullOrWhiteSpace(query) ? null : query.Trim();
        string cacheKey = $"lordtv:search:{init.host}:{search}:{kinopoiskId}:{imdbId}:{year}";

        var cache = await InvokeCacheResult<List<SeriesItem>>(cacheKey, 40, async err =>
        {
            string path = "/api/v1/series/?page=1&page_size=40";
            if (!string.IsNullOrEmpty(search))
                path += $"&search={HttpUtility.UrlEncode(search)}";

            var root = await GetJson<CatalogList<SeriesItem>>(path);
            if (root?.items == null || root.items.Count == 0)
                return err.Fail("items");

            return err.Success(root.items);
        });

        if (!cache.IsSuccess)
            return null;

        return PickSeries(cache.Value, query, kinopoiskId, imdbId, year);
    }

    static SeriesItem PickSeries(List<SeriesItem> items, string query, long kinopoiskId, string imdbId, short year)
    {
        if (items == null || items.Count == 0)
            return null;

        if (kinopoiskId > 0)
        {
            var kp = items.FirstOrDefault(i => i.kinopoisk_id == kinopoiskId.ToString());
            if (kp != null)
                return kp;
        }

        if (!string.IsNullOrWhiteSpace(imdbId))
        {
            var imdb = items.FirstOrDefault(i => string.Equals(i.imdb_id, imdbId, StringComparison.OrdinalIgnoreCase));
            if (imdb != null)
                return imdb;
        }

        string want = Norm(query);
        SeriesItem best = null;
        int bestScore = -1;

        foreach (var item in items)
        {
            int score = 0;
            string name = Norm(item.title);
            string orig = Norm(item.original_title);

            if (want.Length > 0 && (name == want || orig == want))
                score += 6;
            else if (want.Length > 0 && (name.Contains(want) || orig.Contains(want) || want.Contains(name)))
                score += 3;

            if (year > 0 && item.year == year)
                score += 3;
            else if (year > 0 && item.year.HasValue && Math.Abs(item.year.Value - year) <= 1)
                score += 1;

            if (score > bestScore)
            {
                bestScore = score;
                best = item;
            }
        }

        return bestScore > 0 ? best : items.Count == 1 ? items[0] : null;
    }

    async Task<SeriesItem> EnsureSeasons(SeriesItem series)
    {
        if (series == null || string.IsNullOrEmpty(series.id))
            return series;

        if (series.seasons != null && series.seasons.Count > 0 &&
            series.seasons.Any(s => s.episodes != null && s.episodes.Count > 0))
            return series;

        var full = await GetJson<SeriesItem>($"/api/v1/series/{series.id}");
        return full ?? series;
    }

    async Task<List<PlayerVoiceoverOption>> Voiceovers(string seriesId, int season, EpisodeItem episode)
    {
        var result = new List<PlayerVoiceoverOption>();
        string token = EmbedToken();
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(seriesId))
            return result;

        string path = PlayerPath("series", seriesId, token, (short)season, episode != null ? (short)episode.episode_number : (short)0, null, null);
        if (episode != null && !string.IsNullOrEmpty(episode.id))
            path += $"&playback={HttpUtility.UrlEncode(episode.id)}";

        var data = await GetJson<PlayerData>(path, useBearer: false);
        if (data?.all_voiceovers != null)
        {
            foreach (var voice in data.all_voiceovers)
            {
                if (!string.IsNullOrEmpty(voice?.slug))
                    result.Add(voice);
            }
        }
        else if (data?.voiceovers != null)
        {
            foreach (var voice in data.voiceovers)
            {
                if (string.IsNullOrEmpty(voice?.slug))
                    continue;

                result.Add(new PlayerVoiceoverOption { slug = voice.slug, name = voice.name });
            }
        }

        return result
            .GroupBy(i => i.slug, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();
    }

    async Task<string> ResolveStream(string cid, string eid, short season, short episode, string voice)
    {
        string fromPlayer = await StreamFromPlayer(cid, eid, season, episode, voice);
        if (!string.IsNullOrEmpty(fromPlayer))
            return fromPlayer;

        return await StreamFromPartner(eid, cid);
    }

    async Task<string> StreamFromPlayer(string cid, string eid, short season, short episode, string voice)
    {
        string token = EmbedToken();
        if (string.IsNullOrEmpty(token))
            return null;

        foreach (string quality in QualityOrder.Concat(new[] { (string)null }))
        {
            var paths = new List<string>();
            if (!string.IsNullOrEmpty(eid))
                paths.Add(PlayerPath("episode", eid, token, season, episode, voice, quality));
            if (!string.IsNullOrEmpty(cid))
                paths.Add(PlayerPath("series", cid, token, season, episode, voice, quality));

            foreach (string path in paths)
            {
                var data = await GetJson<PlayerData>(path, useBearer: false);
                string url = FirstUrl(
                    data?.current_video_url,
                    data?.voiceovers?.FirstOrDefault(v => string.IsNullOrEmpty(voice) || v.slug == voice)?.video_url,
                    data?.episodes?.FirstOrDefault(ep => ep.episode_number == episode)?.video_url
                );

                if (!string.IsNullOrEmpty(url))
                    return url;
            }
        }

        return null;
    }

    async Task<string> StreamFromPartner(string eid, string cid)
    {
        if (string.IsNullOrEmpty(ApiToken()))
            return null;

        if (!string.IsNullOrEmpty(eid))
        {
            var play = await GetJson<PartnerPlay>($"/api/v1/stream/episode/{eid}/play", useBearer: true);
            string url = FirstUrl(play?.content?.video_url);
            if (!string.IsNullOrEmpty(url))
                return url;
        }

        if (!string.IsNullOrEmpty(cid))
        {
            var play = await GetJson<PartnerPlay>($"/api/v1/stream/series/{cid}/play", useBearer: true);
            string url = FirstUrl(play?.content?.video_url);
            if (!string.IsNullOrEmpty(url))
                return url;
        }

        return null;
    }

    string PlayerPath(string type, string id, string token, short season, short episode, string voice, string quality)
    {
        var q = new List<string> { $"token={HttpUtility.UrlEncode(token)}" };
        if (season > 0) q.Add($"season={season}");
        if (episode > 0) q.Add($"episode={episode}");
        if (!string.IsNullOrEmpty(voice)) q.Add($"voiceover={HttpUtility.UrlEncode(voice)}");
        if (!string.IsNullOrEmpty(quality)) q.Add($"quality={HttpUtility.UrlEncode(quality)}");
        return $"/api/v1/player/data/{type}/{id}?{string.Join("&", q)}";
    }

    async Task<T> GetJson<T>(string path, bool useBearer = false) where T : class
    {
        string url = AbsUrl(path);
        var headers = RequestHeaders(useBearer);

        try
        {
            return await httpHydra.Get<T>(url, addheaders: headers, safety: true);
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning(ex, "LordTV request failed: {Url}", url);
            return null;
        }
    }

    IReadOnlyList<HeadersModel> RequestHeaders(bool bearer)
    {
        string origin = string.IsNullOrWhiteSpace(init.player_origin) ? init.host.TrimEnd('/') : init.player_origin.TrimEnd('/');
        string referer = string.IsNullOrWhiteSpace(init.referer) ? origin + "/" : init.referer;
        if (bearer && !string.IsNullOrEmpty(ApiToken()))
        {
            return HeadersModel.Init(
                ("accept", "application/json"),
                ("origin", origin),
                ("referer", referer),
                ("authorization", $"Bearer {ApiToken()}")
            );
        }

        return HeadersModel.Init(
            ("accept", "application/json"),
            ("origin", origin),
            ("referer", referer)
        );
    }

    IReadOnlyList<HeadersModel> StreamHeaders()
    {
        if (init.headers_stream != null && init.headers_stream.Count > 0)
            return httpHeaders(init.host, init.headers_stream);

        string origin = string.IsNullOrWhiteSpace(init.player_origin) ? init.host.TrimEnd('/') : init.player_origin.TrimEnd('/');
        string referer = string.IsNullOrWhiteSpace(init.referer) ? origin + "/" : init.referer;
        return HeadersModel.Init(
            ("accept", "*/*"),
            ("origin", origin),
            ("referer", referer)
        );
    }

    string EmbedToken()
    {
        if (!string.IsNullOrWhiteSpace(init.embed_token))
            return init.embed_token.Trim();

        return string.IsNullOrWhiteSpace(init.token) ? null : init.token.Trim();
    }

    string ApiToken()
    {
        if (!string.IsNullOrWhiteSpace(init.apitoken))
            return init.apitoken.Trim();

        return string.IsNullOrWhiteSpace(init.token) ? null : init.token.Trim();
    }

    string FirstUrl(params string[] urls)
    {
        foreach (string url in urls)
        {
            string abs = AbsUrl(url);
            if (!string.IsNullOrEmpty(abs))
                return abs;
        }

        return null;
    }

    string AbsUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return null;

        url = url.Trim();
        if (url.StartsWith("//"))
            return "https:" + url;
        if (url.StartsWith("/"))
            return init.host.TrimEnd('/') + url;
        if (Regex.IsMatch(url, "^https?://", RegexOptions.IgnoreCase))
            return url;

        return null;
    }

    static string Norm(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        string x = value.ToLowerInvariant().Replace('ё', 'е');
        x = Regex.Replace(x, "[^a-zа-я0-9 ]+", " ", RegexOptions.IgnoreCase);
        return Regex.Replace(x, @"\s+", " ").Trim();
    }
}
