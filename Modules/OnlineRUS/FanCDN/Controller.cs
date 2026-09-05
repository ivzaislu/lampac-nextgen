using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Shared;
using Shared.Attributes;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using BrowserCookie = Microsoft.Playwright.Cookie;

namespace FanCDN;

public class FanCDNController : BaseOnlineController
{
    static List<BrowserCookie> cookies;
    static string cookiesKey;

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
            // For long-running series the search endpoint can expose the year of a
            // current season/episode instead of the original premiere year supplied
            // by TMDB/Kinopoisk. Title/original-title are the stable identifiers here.
            var search = await InvokeCacheResult<string>($"fancdn:v5:serial:search:{title}:{original_title}", TimeSpan.FromHours(1), onget: async e =>
            {
                string result = await oninvk.SearchPage(title, original_title, 0);
                if (string.IsNullOrEmpty(result))
                    return e.Fail("search");

                return e.Success(result);
            });

            if (!search.IsSuccess)
                return OnError(search.ErrorMsg);

            if (s <= 0)
            {
                var seasons = await InvokeCacheResult<List<int>>($"fancdn:v5:seasons:{search.Value}", 30, textJson: true, onget: async e =>
                {
                    List<int> result = await oninvk.Seasons(search.Value);
                    if (result == null || result.Count == 0)
                        return e.Fail("seasons");

                    return e.Success(result);
                });

                return ContentTpl(seasons,
                    () => oninvk.TplSeasons(seasons.Value, host, imdb_id, kinopoisk_id, title, original_title, year, rjson)
                );
            }

            var season = await InvokeCacheResult<FanCdnSerialSeason>($"fancdn:v5:serial:{search.Value}:{s}", 20, textJson: true, onget: async e =>
            {
                FanCdnSerialSeason result = await oninvk.Serial(search.Value, s);
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

        var movieSearch = await InvokeCacheResult<(string kp, string key)>($"fancdn:v3:{title}:{original_title}:{year}", TimeSpan.FromHours(1), onget: async e =>
        {
            var result = await oninvk.Search(title, original_title, year);
            if (string.IsNullOrEmpty(result.kp) || string.IsNullOrEmpty(result.key))
                return e.Fail("search");

            return e.Success(result);
        });

        if (!movieSearch.IsSuccess)
            return OnError(movieSearch.ErrorMsg);

        var cache = await InvokeCacheResult<EmbedModel>($"fancdn:v3:{movieSearch.Value.kp}:{movieSearch.Value.key}", 20, textJson: true, onget: async e =>
        {
            var result = await oninvk.Embed(movieSearch.Value.kp, movieSearch.Value.key);
            if (result == null)
                return e.Fail("embed");

            return e.Success(result);
        });

        return ContentTpl(cache,
            () => oninvk.Tpl(cache.Value, imdb_id, kinopoisk_id, title, original_title, vast: init.vast, headers: httpHeaders(init))
        );
    }
}
