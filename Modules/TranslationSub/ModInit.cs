using Shared.Models.Events;
using Shared.Models.Module;
using Shared.Models.Module.Interfaces;
using Shared.Services;
using System.IO;
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

        TranslationSubscriptionService.Start();
    }

    public void Dispose()
    {
        EventListener.UpdateInitFile -= updateConf;
        TranslationSubscriptionService.Stop();
    }

    static void updateConf()
    {
        conf = ModuleInvoke.Init("TranslationSub", new ModuleConf());
    }
}
