using Shared.Models.Base;

namespace Kbteam;

public class ModuleConf : BaseSettings
{
    public ModuleConf(string plugin, string host)
    {
        enable = true;
        this.plugin = plugin;
        this.host = host;
    }

    public int cache_ttl { get; set; } = 1800;
}
