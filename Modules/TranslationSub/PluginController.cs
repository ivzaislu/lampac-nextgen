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

        string script = System.IO.File.ReadAllText(path);

        AppendScript(ref script, "translationsub-page.js");
        AppendScript(ref script, "translationsub-watch.js");
        AppendScript(ref script, "translationsub-ui.js");
        AppendScript(ref script, "translationsub-card.js");
        AppendScript(ref script, "translationsub-source.js");

        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        return Content(script, "application/javascript; charset=utf-8");
    }

    static void AppendScript(ref string script, string filename)
    {
        string file = Path.Combine(ModInit.modpath, filename);
        if (System.IO.File.Exists(file))
            script += "\n;\n" + System.IO.File.ReadAllText(file);
    }
}
