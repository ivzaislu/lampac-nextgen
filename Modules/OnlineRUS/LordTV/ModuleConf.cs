using Shared.Models.Base;
using System;

namespace LordTV;

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

    /// <summary>
    /// Query-token для /api/v1/player и /api/v1/player/data (как у партнёрского iframe).
    /// </summary>
    public string embed_token { get; set; }

    /// <summary>
    /// Bearer-токен партнёра/админки для /api/v1/stream/{type}/{id}/play.
    /// </summary>
    public string apitoken { get; set; }

    public string player_origin { get; set; }

    public string referer { get; set; }

    public ModuleConf Clone()
    {
        return (ModuleConf)MemberwiseClone();
    }

    object ICloneable.Clone()
    {
        return MemberwiseClone();
    }
}
