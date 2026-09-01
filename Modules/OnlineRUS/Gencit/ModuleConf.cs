using Shared.Models.Base;
using System;

namespace Gencit;

public class ModuleConf : BaseSettings, ICloneable
{
    public ModuleConf(string plugin, string host, bool enable = true, bool streamproxy = false)
    {
        this.enable = enable;
        this.plugin = plugin;
        this.streamproxy = streamproxy;

        if (host != null)
            this.host = host.StartsWith("http") ? host : Decrypt(host);
    }

    public bool index_enable { get; set; } = true;

    public int index_max { get; set; } = 25000;

    public int index_workers { get; set; } = 20;

    public int index_wait_ms { get; set; } = 3500;

    public ModuleConf Clone()
        => (ModuleConf)MemberwiseClone();

    object ICloneable.Clone()
        => MemberwiseClone();
}
