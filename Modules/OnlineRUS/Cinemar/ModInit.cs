using Microsoft.AspNetCore.Http;
using Shared.Models.Base;
using Shared.Models.Events;
using Shared.Models.Module;
using Shared.Models.Module.Interfaces;
using Shared.Models.Online.Settings;
using Shared.PlaywrightCore;
using Shared.Services;
using System.Collections.Generic;

namespace Cinemar;

public class ModInit : IModuleLoaded, IModuleOnline, IModuleOnlineSpider
{
    public static CinemarSettings conf;

    public List<ModuleOnlineItem> Invoke(HttpContext httpContext, RequestModel requestInfo, string host, OnlineEventsModel args)
    {
        if (conf.useplaywright && PlaywrightBrowser.Status == PlaywrightStatus.disabled)
            return null;

        return new List<ModuleOnlineItem>()
        {
            new(conf)
        };
    }

    public List<ModuleOnlineSpiderItem> Spider(HttpContext httpContext, RequestModel requestInfo, string host, OnlineSpiderModel args)
    {
        if (conf.useplaywright && PlaywrightBrowser.Status == PlaywrightStatus.disabled)
            return null;

        return new List<ModuleOnlineSpiderItem>()
        {
            new(conf)
        };
    }

    public void Loaded(InitspaceModel baseconf)
    {
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
        conf = ModuleInvoke.Init("Cinemar", new CinemarSettings()
        {
            displayindex = 531,
            rch_access = "apk",
            stream_access = "apk,cors",
            rchstreamproxy = "web"
        });
    }

    string onlineApiQuality(EventOnlineApiQuality e)
    {
        return e.balanser switch
        {
            "cinemar" => " ~ 1080p",
            _ => null
        };
    }
}
