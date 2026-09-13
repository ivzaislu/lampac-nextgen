using Microsoft.AspNetCore.Mvc;
using Microsoft.Playwright;
using Shared;
using Shared.Attributes;
using Shared.Models.Templates;
using Shared.PlaywrightCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Web;

namespace FlixCDN;

public class FlixCDNController : BaseOnlineController
{
    FlixCDNInvoke oninvk;

    static readonly JsonSerializerOptions jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public FlixCDNController() : base(ModInit.conf)
    {
        requestInitialization = () =>
        {
            oninvk = new FlixCDNInvoke
            (
               host,
               init,
               httpHydra,
               streamfile => HostStreamProxy(streamfile)
            );
        };
    }


    [HttpGet, Staticache(manually: true)]
    [Route("lite/flixcdn")]
    async public Task<ActionResult> Index(string imdb_id, long kinopoisk_id, string title, string original_title, short year, int t = -1, short s = -1, bool similar = false)
    {
        if (await IsRequestBlocked(rch: true))
            return badInitMsg;

    rhubFallback:
        var cache = await InvokeCacheResult<SearchItem>($"flixcdn:search:v5:{imdb_id}:{kinopoisk_id}:{title}:{original_title}:{similar}", TimeSpan.FromHours(4), async e =>
        {
            SearchItem search = null;

            if (similar)
            {
                search = await oninvk.SearchByTitle(imdb_id, kinopoisk_id, title, original_title, true);
            }
            else if (kinopoisk_id > 0)
            {
                search = await oninvk.SearchByPlayer(kinopoisk_id, title, original_title);

                if (search == null)
                    search = await SearchByPlayerBrowser(kinopoisk_id, title, original_title);

                if (search == null)
                    search = await oninvk.SearchById(imdb_id, kinopoisk_id);

                if (search == null)
                    search = await oninvk.SearchByTitle(imdb_id, kinopoisk_id, title, original_title, false);
            }
            else
            {
                search = await oninvk.SearchByTitle(imdb_id, kinopoisk_id, title, original_title, false);
            }

            if (search == null)
                return e.Fail("Search", refresh_proxy: true);

            return e.Success(search);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        return ContentTpl(cache, () =>
        {
            var result = cache.Value;

            if (result.similar != null)
                return result.similar;

            if (result.type is "movie" or "cartoon")
            {
                #region Фильм
                var mtpl = new MovieTpl(title, original_title, result.translations.Count);

                foreach (var voice in result.translations)
                {
                    mtpl.Append(
                        voice.title,
                        $"{host}/lite/flixcdn/stream?iframe={EncryptQuery(result.iframe_url)}&t={voice.id}",
                        "call",
                        vast: init.vast
                    );
                }

                return mtpl;
                #endregion
            }
            else
            {
                #region Сериал
                string enc_title = HttpUtility.UrlEncode(title);
                string enc_original_title = HttpUtility.UrlEncode(original_title);

                if (s == -1)
                {
                    var tpl = new SeasonTpl();
                    var hash = new HashSet<int>();

                    foreach (var voice in result.translations.OrderBy(s => s.season))
                    {
                        if (hash.Add(voice.season))
                        {
                            tpl.Append(
                                $"{voice.season} сезон",
                                $"{host}/lite/flixcdn?similar={similar}&kinopoisk_id={kinopoisk_id}&imdb_id={imdb_id}&title={enc_title}&original_title={enc_original_title}&t={t}&s={voice.season}",
                                voice.season
                            );
                        }
                    }

                    return tpl;
                }
                else
                {
                    #region Перевод
                    var vtpl = new VoiceTpl();
                    var tmpVoice = new HashSet<int>(20);

                    foreach (var voice in result.translations.Where(i => i.season == s))
                    {
                        if (tmpVoice.Add(voice.id))
                        {
                            if (t == -1)
                                t = voice.id;

                            vtpl.Append(
                                voice.title,
                                t == voice.id,
                                $"{host}/lite/flixcdn?similar={similar}&kinopoisk_id={kinopoisk_id}&imdb_id={imdb_id}&title={enc_title}&original_title={enc_original_title}&t={voice.id}&s={s}"
                            );
                        }
                    }
                    #endregion

                    var etpl = new EpisodeTpl(vtpl);

                    var targetVoice = result.translations.FirstOrDefault(i => i.season == s && i.id == t);
                    if (targetVoice == null)
                        return default;

                    for (short e = 1; e <= targetVoice.episode; e++)
                    {
                        string link = $"{host}/lite/flixcdn/stream?iframe={EncryptQuery(result.iframe_url)}&t={t}&s={s}&e={e}";

                        etpl.Append(
                            $"Серия {e}",
                            title ?? original_title,
                            s,
                            e,
                            link,
                            "call",
                            streamlink: $"{link}&play=true",
                            vast: init.vast
                        );
                    }

                    return etpl;
                }
                #endregion
            }
        });
    }


    [HttpGet, Staticache(manually: true)]
    [Route("lite/flixcdn/stream")]
    async public Task<ActionResult> Stream(string iframe, int t, short s = 0, short e = 0, bool play = false)
    {
        iframe = DecryptQuery(iframe);
        if (string.IsNullOrEmpty(iframe))
            return OnError();

        if (await IsRequestBlocked(rch_check: false))
            return badInitMsg;

        var cache = await InvokeCacheResult<string>(ipkey($"flixcdn:stream:{iframe}:{t}:{s}:{e}"), 10, async result =>
        {
            string file = null;
            string iframeUrl = oninvk.BuildIframeUrl(iframe, t, s, e);

            try
            {
                using (var browser = new PlaywrightBrowser("firefox"))
                {
                    var page = await browser.NewPageAsync(init.plugin, proxy: proxy_data, headers: init.headers).ConfigureAwait(false);
                    if (page == null)
                        return result.Fail("page");

                    await page.RouteAsync("**/*", async route =>
                    {
                        try
                        {
                            if (browser.completionSource.Task.IsCompleted ||
                                route.Request.Url.Contains("mc.yandex.ru") ||
                                route.Request.Url.Contains("/videos/"))
                            {
                                await route.AbortAsync();
                                return;
                            }

                            if (route.Request.Url.StartsWith("https://flixcdn.live"))
                            {
                                await route.FulfillAsync(new RouteFulfillOptions
                                {
                                    Body = PlaywrightBase.IframeHtml(iframeUrl)
                                });
                            }
                            else
                            {
                                if (route.Request.Url.Contains("&cuid="))
                                {
                                    await route.ContinueAsync();

                                    var response = await page.WaitForResponseAsync(route.Request.Url);
                                    browser.completionSource.SetResult(response != null
                                        ? await response.TextAsync()
                                        : null);
                                    return;
                                }
                                else
                                {
                                    if (await PlaywrightBase.AbortOrCache(page, route))
                                        return;

                                    await route.ContinueAsync();
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            Serilog.Log.Error(ex, "{Class} {CatchId}", "Flixcdn", "id_erdbn91q");
                        }
                    });

                    PlaywrightBase.GotoAsync(page, "https://flixcdn.live/");
                    file = await browser.WaitPageResult().ConfigureAwait(false);
                }
            }
            catch { }

            if (string.IsNullOrWhiteSpace(file))
                return result.Fail("file", refresh_proxy: true);

            file = file.Replace("\\", "");
            return result.Success(file);
        });

        if (!cache.IsSuccess)
            return OnError(cache.ErrorMsg);

        var streamquality = oninvk.GetStreamQualityTpl(cache.Value);

        var first = streamquality.Firts();
        if (first == null)
            return OnError();

        if (play)
            return RedirectToPlay(first.link);

        return ContentTo(VideoTpl.ToJson(
            "play",
            first.link,
            "auto",
            streamquality: streamquality,
            vast: init.vast,
            httpContext: HttpContext
        ));
    }


    #region player browser fallback
    async Task<SearchItem> SearchByPlayerBrowser(long kinopoisk_id, string title, string original_title)
    {
        if (kinopoisk_id <= 0 || PlaywrightBrowser.Status == PlaywrightStatus.disabled)
            return null;

        try
        {
            using (var browser = new PlaywrightBrowser("firefox"))
            {
                var page = await browser.NewPageAsync(init.plugin, headers: init.headers, proxy: proxy_data).ConfigureAwait(false);
                if (page == null)
                    return null;

                string playerUrl = oninvk.BuildPlayerUrl(kinopoisk_id);

                await page.GotoAsync(playerUrl, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 20000
                }).ConfigureAwait(false);

                try
                {
                    await page.WaitForFunctionAsync(
                        "() => !!window.__PLAYER_PAYLOAD__",
                        null,
                        new PageWaitForFunctionOptions { Timeout = 10000 }
                    ).ConfigureAwait(false);
                }
                catch { }

                string json = await page.EvaluateAsync<string>(
                    "() => window.__PLAYER_PAYLOAD__ ? JSON.stringify(window.__PLAYER_PAYLOAD__) : null"
                ).ConfigureAwait(false);

                if (string.IsNullOrWhiteSpace(json))
                    return null;

                var payload = JsonSerializer.Deserialize<PlayerPayload>(json, jsonOptions);
                return BuildSearchItem(payload, playerUrl, title, original_title);
            }
        }
        catch
        {
            return null;
        }
    }

    static SearchItem BuildSearchItem(PlayerPayload payload, string playerUrl, string title, string original_title)
    {
        if (payload == null || payload.id <= 0)
            return null;

        var voices = payload.translations?
            .Where(v => v != null && v.id > 0)
            .GroupBy(v => v.id)
            .Select(g => g.First())
            .ToList() ?? new List<PlayerTranslation>();

        var seasons = GetPlayerSeasons(payload);
        int totalEpisodes = TotalPlayerEpisodes(seasons);

        if (payload.translate > 0 && !voices.Any(v => v.id == payload.translate))
        {
            voices.Insert(0, new PlayerTranslation
            {
                id = payload.translate,
                title = string.IsNullOrWhiteSpace(payload.translateTitle) ? "Перевод" : payload.translateTitle,
                episodes_qty = totalEpisodes
            });
        }

        if (voices.Count == 0)
            return null;

        var translations = new List<Voice>();

        if (!payload.is_serial)
        {
            foreach (var voice in voices)
            {
                translations.Add(new Voice
                {
                    id = voice.id,
                    title = string.IsNullOrWhiteSpace(voice.title) ? "Перевод" : voice.title
                });
            }
        }
        else
        {
            if (seasons.Count == 0)
                return null;

            foreach (var voice in voices)
            {
                int remaining = voice.episodes_qty > 0 ? voice.episodes_qty : totalEpisodes;

                foreach (var season in seasons)
                {
                    int seasonLength = season.Value?.Length ?? 0;
                    if (seasonLength <= 0)
                        continue;

                    int available = Math.Min(Math.Max(remaining, 0), seasonLength);
                    if (available > 0)
                    {
                        translations.Add(new Voice
                        {
                            id = voice.id,
                            title = string.IsNullOrWhiteSpace(voice.title) ? "Перевод" : voice.title,
                            season = season.Key,
                            episode = (short)Math.Min(available, short.MaxValue)
                        });
                    }

                    remaining -= seasonLength;
                }
            }
        }

        if (translations.Count == 0)
            return null;

        return new SearchItem
        {
            iframe_url = playerUrl,
            type = payload.is_serial ? "serial" : (string.IsNullOrWhiteSpace(payload.type) ? "movie" : payload.type),
            title_rus = title,
            title_orig = original_title,
            translations = translations
        };
    }

    static SortedDictionary<short, int[]> GetPlayerSeasons(PlayerPayload payload)
    {
        var seasons = new SortedDictionary<short, int[]>();

        if (payload?.seasons_episodes != null)
        {
            foreach (var item in payload.seasons_episodes)
            {
                if (!short.TryParse(item.Key, out short season) || season <= 0 || item.Value == null || item.Value.Length == 0)
                    continue;

                var episodes = item.Value.Where(e => e > 0).ToArray();
                if (episodes.Length > 0)
                    seasons[season] = episodes;
            }
        }

        if (seasons.Count == 0 && payload?.season > 0 && payload.episodes?.Length > 0)
        {
            var episodes = payload.episodes.Where(e => e > 0).ToArray();
            if (episodes.Length > 0)
                seasons[payload.season.Value] = episodes;
        }

        return seasons;
    }

    static int TotalPlayerEpisodes(SortedDictionary<short, int[]> seasons)
    {
        int total = 0;

        foreach (var season in seasons)
            total += season.Value?.Length ?? 0;

        return total;
    }
    #endregion
}
