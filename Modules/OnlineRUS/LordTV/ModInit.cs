using Microsoft.AspNetCore.Http;
using Shared;
using Shared.Models.Base;
using Shared.Models.Events;
using Shared.Models.Module;
using Shared.Models.Module.Interfaces;
using Shared.Services;
using System.Collections.Generic;

namespace LordTV;

public class ModInit : IModuleLoaded, IModuleOnline
{
    public static ModuleConf conf;

    const string PartnerOrigin = "https://sled-chikatilo-episode.doramaru-hd.biz";
    const string EmbedToken = "ByaynHMmP3lFrW6d9NMF4KsdNMrrgTMlZ_xSR_3y7S-meVI7kCWeK9eCoUp4uiDn";

    public List<ModuleOnlineItem> Invoke(HttpContext httpContext, RequestModel requestInfo, string host, OnlineEventsModel args)
    {
        if (args.isanime)
            return null;

        return new List<ModuleOnlineItem>()
        {
            new(conf, plugin: "lordtv", name: "LORD.TV")
        };
    }

    public void Loaded(InitspaceModel baseconf)
    {
        if (!CoreInit.conf.online.with_search.Contains("lordtv"))
            CoreInit.conf.online.with_search.Add("lordtv");

        updateConf();
        EventListener.UpdateInitFile += updateConf;
        EventListener.OnlineApiQuality += onlineApiQuality;
    }

    public void Dispose()
    {
        EventListener.UpdateInitFile -= updateConf;
        EventListener.OnlineApiQuality -= onlineApiQuality;
    }

    void updateConf()
    {
        conf = ModuleInvoke.Init("LordTV", new ModuleConf("LordTV", "https://lordsilver.biz", streamproxy: true)
        {
            displayindex = 545,
            embed_token = EmbedToken,
            player_origin = PartnerOrigin,
            referer = PartnerOrigin + "/",
            rch_access = "apk,cors",
            stream_access = "apk,cors,web",
            httptimeout = 10,
            headers = HeadersModel.Init(Http.defaultFullHeaders,
                ("accept", "application/json"),
                ("origin", PartnerOrigin),
                ("referer", PartnerOrigin + "/")
            ).ToDictionary(),
            headers_stream = HeadersModel.Init(Http.defaultFullHeaders,
                ("accept", "*/*"),
                ("origin", PartnerOrigin),
                ("referer", PartnerOrigin + "/")
            ).ToDictionary()
        });
    }

    string onlineApiQuality(EventOnlineApiQuality e)
        => e.balanser == "lordtv" ? " ~ 1080p" : null;
}
