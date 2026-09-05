using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Shared;
using Shared.Attributes;
using Shared.Models.Base;
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
    async public Task<ActionResult> Index(string imdb_id, long kinopoisk_id, string title, string original_title, short year, byte serial)
    {
        if (await IsRequestBlocked(rch: false))
            return badInitMsg;

        if (kinopoisk_id == 0 || serial == 1 || cookies == null)
            return OnError();

        var oninvk = new FanCDNInvoke
        (
           init,
           cookies,
           (streamfile, streamHeaders) => HostStreamProxy(streamfile, streamHeaders)
        );

        var search = await InvokeCacheResult<string>($"fancdn:v2:{title}:{original_title}:{year}", TimeSpan.FromHours(4), onget: async e =>
        {
            string result = await oninvk.Search(title, original_title, year);
            if (string.IsNullOrEmpty(result))
                return e.Fail("search");

            return e.Success(result);
        });

        if (!search.IsSuccess)
            return OnError(search.ErrorMsg);

        var cache = await InvokeCacheResult<EmbedModel>($"fancdn:v2:{search.Value}", 20, textJson: true, onget: async e =>
        {
            var result = await oninvk.Embed(search.Value);
            if (result == null)
                return e.Fail("embed");

            return e.Success(result);
        });

        return ContentTpl(cache,
            () => oninvk.Tpl(cache.Value, imdb_id, kinopoisk_id, title, original_title, vast: init.vast, headers: httpHeaders(init))
        );
    }
}
