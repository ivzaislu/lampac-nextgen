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
}
