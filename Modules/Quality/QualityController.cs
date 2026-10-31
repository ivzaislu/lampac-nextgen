using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Security.Cryptography;
using System.Text;
using Shared;
using Shared.Services;

namespace Quality;

public class QualityController : BaseController
{
    [HttpGet, AllowAnonymous]
    [Route("quality.js")]
    public ActionResult Plugin()
    {
        if (ModInit.conf?.enable != true)
            return NotFound();

        string script = FileCache.ReadAllText($"{ModInit.modpath}/plugin.js", "quality.js", saveCache: false);
        return ContentTo(script, "application/javascript; charset=utf-8");
    }
    [HttpGet, AllowAnonymous]
    [Route("quality/status")]
    public ActionResult Status()
    {
        return Ok(new
        {
            module = "Quality",
            loaded = true,
            enabled = ModInit.conf?.enable == true,
            autoinject = ModInit.conf?.autoinject == true,
            source = "Lampa.Parser.get",
            sqlcache = ModInit.conf?.sqlcache == true
        });
    }
    public sealed class CacheRequest
    {
        public string op { get; set; } = "";
        public string scope { get; set; } = "";
        public string source { get; set; } = "";
        public string movie { get; set; } = "";
        public string? label { get; set; }
    }

    private string TrustedCacheScope(string browserScope)
    {
        // Authenticated Lampac accounts can share cached results across devices
        // without placing email, user IDs, or credentials in the database.
        var user = requestInfo?.user;
        if (user == null || user.ban || user.expires < DateTime.UtcNow
            || string.IsNullOrWhiteSpace(user.id) || string.IsNullOrEmpty(CoreInit.rootPasswd))
            return browserScope;

        var value = "quality:v1:" + CoreInit.rootPasswd + ":" + user.id;
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(digest, 0, 16).ToLowerInvariant();
    }

    [HttpPost, AllowAnonymous]
    [Route("quality/cache")]
    public ActionResult Cache([FromBody] CacheRequest? request)
    {
        Response.Headers.CacheControl = "no-store";
        if (ModInit.conf?.enable != true || ModInit.conf.sqlcache != true)
            return NotFound();

        // Only same-origin browser requests. Public curl clients have no Origin,
        // but a random scope prevents reads/writes of another client's records.
        var origin = Request.Headers.Origin.ToString();
        if (!string.IsNullOrEmpty(origin))
        {
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var parsed)
                || !string.Equals(parsed.Authority, Request.Host.Value, StringComparison.OrdinalIgnoreCase))
                return StatusCode(403);
        }
        if (Request.ContentLength is > 2048 || request == null
            || !QualityCache.ValidIds(request.scope, request.source, request.movie))
            return BadRequest();

        try
        {
            string scope = TrustedCacheScope(request.scope);
            if (request.op == "get")
            {
                var cached = QualityCache.Get(scope, request.source, request.movie);
                return Ok(new {hit = cached.hit, label = cached.label, until = cached.until});
            }
            if (request.op == "put")
            {
                if (!QualityCache.ValidLabel(request.label)) return BadRequest();
                QualityCache.Put(scope, request.source, request.movie, request.label);
                return Ok(new {saved = true});
            }
            return BadRequest();
        }
        catch (Exception)
        {
            // An unwritable database must never break the client-side parser.
            return StatusCode(503);
        }
    }

}
