using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Shared;
using System.IO;

namespace TranslationSub;

public class TranslationSubPluginController : BaseController
{
    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub.js")]
    [Route("translationsub/plugin.js")]
    public ActionResult Plugin()
    {
        if (ModInit.conf?.enable != true)
            return NotFound();

        string path = Path.Combine(ModInit.modpath, "translationsub.js");
        if (!System.IO.File.Exists(path))
            return NotFound();

        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        return Content(System.IO.File.ReadAllText(path), "application/javascript; charset=utf-8");
    }
}
