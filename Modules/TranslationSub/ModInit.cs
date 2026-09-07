using Newtonsoft.Json;
using Shared.Models.Events;
using Shared.Models.Module;
using Shared.Models.Module.Interfaces;
using Shared.Services;
using System.IO;
using System.Text;
using TranslationSub.Services;

namespace TranslationSub;

public class ModInit : IModuleLoaded
{
    public static ModuleConf conf;
    public static string modpath;

    public void Loaded(InitspaceModel initspace)
    {
        modpath = initspace.path;
        Directory.CreateDirectory("database/translationsub");

        updateConf();
        EventListener.UpdateInitFile += updateConf;
        EventListener.AppReplace += appReplace;

        TranslationSubscriptionService.Start();
    }

    public void Dispose()
    {
        EventListener.UpdateInitFile -= updateConf;
        EventListener.AppReplace -= appReplace;
        TranslationSubscriptionService.Stop();
    }

    static void updateConf()
    {
        conf = ModuleInvoke.Init("TranslationSub", new ModuleConf());
    }

    static StringBuilder appReplace(string type, EventAppReplace e)
    {
        if (type != "appjs" || conf?.enable != true)
            return e.bulder;

        string pluginUrl = JsonConvert.SerializeObject($"{e.host.TrimEnd('/')}/translationsub.js");

        e.bulder.Append($@"
;(function(){{
    if (window.__TranslationSubAutoLoad) return;
    window.__TranslationSubAutoLoad = true;

    try {{
        if (document.querySelector('script[data-plugin=""translationsub""]')) return;

        var script = document.createElement('script');
        script.src = {pluginUrl};
        script.async = true;
        script.setAttribute('data-plugin', 'translationsub');
        (document.head || document.documentElement).appendChild(script);
    }} catch (e) {{
        try {{ console.log('[TranslationSub] autoload failed', e); }} catch (_) {{}}
    }}
}})();");

        return e.bulder;
    }
}
