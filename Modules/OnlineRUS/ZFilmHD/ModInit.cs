using Shared.Models.Module;
using Shared.Models.Module.Interfaces;
using Shared.Models.Online.Settings;
using Shared.Services;

namespace ZFilmHD;

// Metadata-only prototype. No online button until the playback contract is verified.
public class ModInit : IModuleLoaded
{
    public static OnlinesSettings conf;

    public void Loaded(InitspaceModel baseconf)
    {
        UpdateConf();
        EventListener.UpdateInitFile += UpdateConf;
    }

    public void Dispose()
    {
        EventListener.UpdateInitFile -= UpdateConf;
    }

    void UpdateConf()
    {
        conf = ModuleInvoke.Init("ZFilmHD",
            new OnlinesSettings("ZFilmHD", "https://tv.zfilm-hd.com", enable: false));
    }
}
