using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
            source = "Lampa.Parser.get"
        });
    }
}
