using Microsoft.AspNetCore.Mvc;
using Microsoft.Playwright;
using Shared;
using Shared.Attributes;
using Shared.Models.Base;
using Shared.PlaywrightCore;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Kinobase;

public class KinobaseController : BaseOnlineController<ModuleConf>
{
    public KinobaseController() : base(ModInit.conf) { }

    void PerfLog(string stage, long elapsedMs, string detail = null)
        => Console.WriteLine($"[Kinobase PERF] request={HttpContext?.TraceIdentifier} {stage}: {elapsedMs} ms{(detail == null ? "" : " " + detail)}");

    sealed class PerfTimer : IDisposable
    {
        readonly Stopwatch timer = Stopwatch.StartNew();
        readonly Action<long> log;
        public PerfTimer(Action<long> log) => this.log = log;
        public void Dispose() => log(timer.ElapsedMilliseconds);
    }

    IDisposable Perf(string stage) => new PerfTimer(ms => PerfLog(stage, ms));

    [HttpGet, Staticache(manually: true)]
    [Route("lite/kinobase")]
    async public Task<ActionResult> Index(string title, short year, short s = -1, string href = null, string t = null, bool rjson = false, bool similar = false, string source = null, string id = null)
    {
        using var totalPerf = Perf("Index.Total");
        if (PlaywrightBrowser.Status == PlaywrightStatus.disabled)
            return OnError();

        if (await IsRequestBlocked(rch: false))
            return badInitMsg;

        if (string.IsNullOrEmpty(href) && !string.IsNullOrEmpty(source) && !string.IsNullOrEmpty(id))
        {
            if (source.Equals("kinobase", StringComparison.OrdinalIgnoreCase))
                href = id;
        }

        var oninvk = new KinobaseInvoke
        (
           host,
           init,
           async ongettourl =>
           {
               if (ongettourl.Contains("/search?query="))
               {
                   using var httpPerf = Perf("Search.HTTP");
                   return await httpHydra.Get(ongettourl, addheaders: HeadersModel.Init("referer", init.host));
               }

               return await black_magic(ongettourl);
           },
           streamfile => HostStreamProxy(streamfile)
        );

        #region search
        if (string.IsNullOrEmpty(href))
        {
            var searchTimer = Stopwatch.StartNew();
            bool searchFactoryRan = false;
            var search = await InvokeCacheResult<SearchModel>($"kinobase:search:{title}:{year}", TimeSpan.FromHours(4), async e =>
            {
                searchFactoryRan = true;
                using var factoryPerf = Perf("Search.Factory");
                var content = await oninvk.Search(title, year);
                if (content == null)
                    return e.Fail("search");

                return e.Success(content);
            });

            PerfLog("Search.Total", searchTimer.ElapsedMilliseconds, $"factory={(searchFactoryRan ? "executed" : "not-executed")} success={search.IsSuccess}");
            if (similar || string.IsNullOrEmpty(search.Value?.link))
                return ContentTpl(search, () => search.Value.similar);

            if (string.IsNullOrEmpty(search.Value?.link))
                return OnError();

            href = search.Value?.link;
        }
        #endregion

        var embedTimer = Stopwatch.StartNew();
        bool embedFactoryRan = false;
        var cache = await InvokeCacheResult<EmbedModel>($"kinobase:view:{href}:{proxyManager?.CurrentProxyIp}", 20, textJson: true, onget: async e =>
        {
            embedFactoryRan = true;
            using var factoryPerf = Perf("Embed.Factory");
            var content = await oninvk.Embed(href, init.playerjs);
            if (content == null)
                return e.Fail("embed");

            return e.Success(content);
        });

        PerfLog("Embed.Total", embedTimer.ElapsedMilliseconds, $"factory={(embedFactoryRan ? "executed" : "not-executed")} success={cache.IsSuccess}");
        if (cache.IsSuccess && cache.Value.IsEmpty)
            return ShowError(cache.Value.errormsg);

        return ContentTpl(cache,
            () =>
            {
                using var tplPerf = Perf("Tpl");
                return oninvk.Tpl(cache.Value, title, href, s, t, rjson);
            }
        );
    }

    #region black_magic
    async Task<string> black_magic(string uri)
    {
        using var totalPerf = Perf("BlackMagic.Total");
        string stage = "NewPageAsync";
        int requests = 0, playerScripts = 0, aborted = 0, cachedOrAborted = 0, continued = 0;
        try
        {
            using (var browser = new PlaywrightBrowser())
            {
                var pageTimer = Stopwatch.StartNew();
                var page = await browser.NewPageAsync(init.plugin, proxy: proxy_data, headers: init.headers).ConfigureAwait(false);
                PerfLog("BlackMagic.NewPageAsync", pageTimer.ElapsedMilliseconds, $"created={page != null} player={(init.playerjs ? "playerjs" : "uppod")}");
                if (page == null)
                    return null;

                stage = "AddCookiesAsync";
                var cookieTimer = Stopwatch.StartNew();

                await page.Context.AddCookiesAsync(new List<Cookie>()
                {
                    new Cookie()
                    {
                        Name = "player_settings",
                        Value = $"{(init.playerjs ? "new" : "old")}|{(init.hls ? "hls" : "mp4")}|{(init.hdr ? 1 : 0)}",
                        Domain = Regex.Match(init.host, "^https?://([^/]+)").Groups[1].Value,
                        Path = "/",
                        Expires = 2220002226
                    }
                }).ConfigureAwait(false);

                PerfLog("BlackMagic.AddCookiesAsync", cookieTimer.ElapsedMilliseconds);
                stage = "RouteAsync";
                var routeTimer = Stopwatch.StartNew();
                await page.RouteAsync("**/*", async route =>
                {
                    Interlocked.Increment(ref requests);
                    try
                    {
                        if (route.Request.Url.Contains("/playerjs."))
                        {
                            Interlocked.Increment(ref playerScripts);
                            await route.FulfillAsync(new RouteFulfillOptions
                            {
                                Body = ModInit.playerjs
                            });

                            return;
                        }
                        else if (route.Request.Url.Contains("/uppod.js"))
                        {
                            Interlocked.Increment(ref playerScripts);
                            await route.FulfillAsync(new RouteFulfillOptions
                            {
                                Body = ModInit.uppod
                            });

                            return;
                        }

                        if (!route.Request.Url.Contains(init.host) || route.Request.Url.Contains("/comments"))
                        {
                            Interlocked.Increment(ref aborted);
                            await route.AbortAsync();
                            return;
                        }

                        if (await PlaywrightBase.AbortOrCache(page, route, abortMedia: true, patterCache: "/js/(jquery|boot)\\.js"))
                        {
                            Interlocked.Increment(ref cachedOrAborted);
                            return;
                        }

                        Interlocked.Increment(ref continued);
                        await route.ContinueAsync();
                    }
                    catch (Exception ex)
                    {
                        Serilog.Log.Error(ex, "{Class} {CatchId}", "Kinobase", "id_gcc4caoa");
                    }
                });

                PerfLog("BlackMagic.RouteAsync", routeTimer.ElapsedMilliseconds);
                stage = "WaitForAnySelectorAsync";
                var waitTimer = Stopwatch.StartNew();
                PlaywrightBase.GotoAsync(page, uri);
                await browser.WaitForAnySelectorAsync(page, "#playerjsfile", ".uppod-media", ".alert").ConfigureAwait(false);
                PerfLog("BlackMagic.NavigateAndWait", waitTimer.ElapsedMilliseconds);

                stage = "ContentAsync";
                var contentTimer = Stopwatch.StartNew();
                var html = await page.ContentAsync().ConfigureAwait(false);
                PerfLog("BlackMagic.ContentAsync", contentTimer.ElapsedMilliseconds, $"html_chars={html?.Length ?? 0}");
                return html;
            }
        }
        catch (Exception ex)
        {
            PerfLog("BlackMagic.Error", 0, $"stage={stage} type={ex.GetType().Name}");
            return null;
        }
        finally
        {
            PerfLog("BlackMagic.Requests", 0, $"total={Volatile.Read(ref requests)} player_scripts={Volatile.Read(ref playerScripts)} aborted={Volatile.Read(ref aborted)} cached_or_aborted={Volatile.Read(ref cachedOrAborted)} continued={Volatile.Read(ref continued)}");
        }
    }
    #endregion
}
