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
            var search = await InvokeCacheResult<string>($"fancdn:v7:serial:search:{kinopoisk_id}:{title}:{original_title}", TimeSpan.FromHours(1), onget: async e =>
            {
                string result = await SearchSeriesPageReliable(oninvk, title, original_title);
                if (string.IsNullOrEmpty(result))
                    return e.Fail("search");

                return e.Success(result);
            });

            if (!search.IsSuccess)
                return OnError(search.ErrorMsg);

            if (s <= 0)
            {
                var seasons = await InvokeCacheResult<List<int>>($"fancdn:v7:seasons:{search.Value}", 30, textJson: true, onget: async e =>
                {
                    List<int> result = await GetSeasonsReliable(oninvk, search.Value);
                    if (result == null || result.Count == 0)
                        return e.Fail("seasons");

                    return e.Success(result);
                });

                return ContentTpl(seasons,
                    () => oninvk.TplSeasons(seasons.Value, host, imdb_id, kinopoisk_id, title, original_title, year, rjson)
                );
            }

            var season = await InvokeCacheResult<FanCdnSerialSeason>($"fancdn:v7:serial:{search.Value}:{s}", 20, textJson: true, onget: async e =>
            {
                FanCdnSerialSeason result = await GetSerialReliable(oninvk, search.Value, s);
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

        var movieSearch = await InvokeCacheResult<(string kp, string key)>($"fancdn:v7:movie:search:{kinopoisk_id}:{title}:{original_title}:{year}", TimeSpan.FromHours(1), onget: async e =>
        {
            var result = await SearchMovieReliable(oninvk, kinopoisk_id, title, original_title, year);
            if (!ValidMovieResult(result, kinopoisk_id))
                return e.Fail("search");

            return e.Success(result);
        });

        if (!movieSearch.IsSuccess)
            return OnError(movieSearch.ErrorMsg);

        var cache = await InvokeCacheResult<EmbedModel>($"fancdn:v7:movie:embed:{movieSearch.Value.kp}:{movieSearch.Value.key}", 20, textJson: true, onget: async e =>
        {
            EmbedModel result = null;
            for (int attempt = 0; attempt < 2 && result == null; attempt++)
            {
                result = await oninvk.Embed(movieSearch.Value.kp, movieSearch.Value.key);
                if (result == null && attempt == 0)
                    await Task.Delay(250);
            }

            if (result == null)
                return e.Fail("embed");

            return e.Success(result);
        });

        return ContentTpl(cache,
            () => oninvk.Tpl(cache.Value, imdb_id, kinopoisk_id, title, original_title, vast: init.vast, headers: httpHeaders(init))
        );
    }

    async Task<(string kp, string key)> SearchMovieReliable(FanCDNInvoke oninvk, long kinopoisk_id, string title, string original_title, short year)
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            var result = await oninvk.Search(title, original_title, year);
            if (ValidMovieResult(result, kinopoisk_id))
                return result;

            if (!string.IsNullOrWhiteSpace(original_title) && !original_title.Equals(title, StringComparison.OrdinalIgnoreCase))
            {
                result = await oninvk.Search(original_title, title, year);
                if (ValidMovieResult(result, kinopoisk_id))
                    return result;
            }

            if (attempt < 2)
                await Task.Delay(250 * (attempt + 1));
        }

        return default;
    }

    static bool ValidMovieResult((string kp, string key) result, long kinopoisk_id)
    {
        if (string.IsNullOrEmpty(result.kp) || string.IsNullOrEmpty(result.key))
            return false;

        return kinopoisk_id <= 0 || result.kp == kinopoisk_id.ToString();
    }

    async Task<string> SearchSeriesPageReliable(FanCDNInvoke oninvk, string title, string original_title)
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            string result = await oninvk.SearchPage(title, original_title, 0);
            if (await IsUsableSeriesPage(oninvk, result))
                return result;

            if (!string.IsNullOrWhiteSpace(original_title) && !original_title.Equals(title, StringComparison.OrdinalIgnoreCase))
            {
                result = await oninvk.SearchPage(original_title, title, 0);
                if (await IsUsableSeriesPage(oninvk, result))
                    return result;
            }

            if (attempt < 2)
                await Task.Delay(250 * (attempt + 1));
        }

        return null;
    }

    async Task<bool> IsUsableSeriesPage(FanCDNInvoke oninvk, string pageUrl)
    {
        if (string.IsNullOrWhiteSpace(pageUrl))
            return false;

        List<int> seasons = await oninvk.Seasons(pageUrl);
        return seasons != null && seasons.Count > 0;
    }

    async Task<List<int>> GetSeasonsReliable(FanCDNInvoke oninvk, string pageUrl)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            List<int> result = await oninvk.Seasons(pageUrl);
            if (result != null && result.Count > 0)
                return result;

            if (attempt == 0)
                await Task.Delay(250);
        }

        return null;
    }

    async Task<FanCdnSerialSeason> GetSerialReliable(FanCDNInvoke oninvk, string pageUrl, short season)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            FanCdnSerialSeason result = await oninvk.Serial(pageUrl, season);
            if (result != null)
                return result;

            if (attempt == 0)
                await Task.Delay(250);
        }

        return null;
    }
}
