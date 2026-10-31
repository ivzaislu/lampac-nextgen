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
    }

    public void Dispose()
    {
        EventListener.UpdateInitFile -= UpdateConf;
    }

    private static void UpdateConf()
    {
        conf = ModuleInvoke.Init("Quality", new ModuleConf());
    }
}
