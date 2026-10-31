using System;
using System.Text;
using System.Text.Json;
using Shared.Models.Events;
using Shared.Models.Module;
using Shared.Models.Module.Interfaces;
using Shared.Services;

namespace Quality;

public class ModInit : IModuleLoaded
{
    public static string modpath = string.Empty;
    public static ModuleConf conf = new();

    public void Loaded(InitspaceModel initspace)
    {
        modpath = initspace.path;
        UpdateConf();
        EventListener.UpdateInitFile += UpdateConf;
        EventListener.AppReplace += AppReplace;
    }

    public void Dispose()
    {
        EventListener.UpdateInitFile -= UpdateConf;
        EventListener.AppReplace -= AppReplace;
    }

    private static void UpdateConf()
    {
        conf = ModuleInvoke.Init("Quality", new ModuleConf());
    }
    // LampaWeb calls this when serving the bundled Lampa application.
    // For external Lampa installations /quality.js can still be installed manually.
    public static StringBuilder AppReplace(string type, EventAppReplace e)
    {
        if (e?.bulder == null)
            return new StringBuilder();

        if (!string.Equals(type, "appjs", StringComparison.Ordinal)
            || conf?.enable != true || !conf.autoinject || string.IsNullOrWhiteSpace(e.host))
            return e.bulder;

        string url = JsonSerializer.Serialize($"{e.host.TrimEnd('/')}/quality.js");

        e.bulder.Append($@"
;(function(){{
    if (window.__qualityAutoLoad || window.__qualityPluginLoaded) return;
    window.__qualityAutoLoad = true;

    try {{
        if (document.querySelector('script[data-quality-auto]')) return;
        var script = document.createElement('script');
        script.src = {url};
        script.async = true;
        script.setAttribute('data-quality-auto', '1');
        (document.head || document.documentElement).appendChild(script);
    }} catch (error) {{
        window.__qualityAutoLoad = false;
    }}
}})();");

        return e.bulder;
    }

}
