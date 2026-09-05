using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared;
using Shared.Attributes;
using Shared.Models.Base;
using Shared.Services.HTTP;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Web;
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
            var search = await InvokeCacheResult<string>($"fancdn:v6:serial:search:{kinopoisk_id}:{title}:{original_title}", TimeSpan.FromHours(1), onget: async e =>
            {
                string result = await SearchSeriesPage(oninvk, title, original_title, kinopoisk_id);
                if (string.IsNullOrEmpty(result))
                    return e.Fail("search");

                return e.Success(result);
            });

            if (!search.IsSuccess)
                return OnError(search.ErrorMsg);

            if (s <= 0)
            {
                var seasons = await InvokeCacheResult<List<int>>($"fancdn:v6:seasons:{search.Value}", 30, textJson: true, onget: async e =>
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

            var season = await InvokeCacheResult<FanCdnSerialSeason>($"fancdn:v6:serial:{search.Value}:{s}", 20, textJson: true, onget: async e =>
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

    async Task<string> SearchSeriesPage(FanCDNInvoke oninvk, string title, string original_title, long kinopoisk_id)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;

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

        JArray root = null;
        if (!string.IsNullOrWhiteSpace(search))
        {
            try
            {
                root = JsonConvert.DeserializeObject<JArray>(search);
            }
            catch { }
        }

        if (root != null && root.Count > 0 && Uri.TryCreate(host + "/", UriKind.Absolute, out Uri baseUri))
        {
            int checkedPages = 0;
            foreach (JToken item in root)
            {
                if (checkedPages++ >= 8)
                    break;

                string rawUrl = item.Value<string>("url");
                if (string.IsNullOrWhiteSpace(rawUrl))
                    continue;

                string value = HttpUtility.HtmlDecode(rawUrl.Trim()).Replace("\\/", "/");
                if (value.StartsWith("//"))
                    value = baseUri.Scheme + ":" + value;

                if (!Uri.TryCreate(baseUri, value, out Uri uri) || !uri.Host.Equals(baseUri.Host, StringComparison.OrdinalIgnoreCase))
                    continue;

                string pageUrl = uri.ToString();
                string page = await PlaywrightHttp.Get(
                    init,
                    pageUrl,
                    cookies: cookies,
                    headers: HeadersModel.Init(
                        ("referer", $"{host}/"),
                        ("sec-fetch-dest", "document"),
                        ("sec-fetch-mode", "navigate"),
                        ("sec-fetch-site", "same-origin")
                    )
                );

                if (!string.IsNullOrEmpty(page) && page.Contains($"kp{kinopoisk_id}", StringComparison.OrdinalIgnoreCase))
                    return pageUrl;
            }
        }

        // Compatibility fallback for titles where the search JSON already uses the
        // exact movie/series name and does not require Kinopoisk verification.
        return await oninvk.SearchPage(title, original_title, 0);
    }
}
