using JacRed.Models.AppConf;
using Shared.Models.AppConf;
using Shared.Models.Events;
using Shared.Models.Module;
using Shared.Models.Module.Interfaces;
using Shared.Models.Quality;
using System.Threading;

namespace JacRed
{
    public class ModInit : IModuleLoaded
    {
        public static bool IsDispose;
        public static JacRedConf conf;

        public void Loaded(InitspaceModel baseconf)
        {
            IsDispose = false;
            Directory.CreateDirectory("cache/jacred");

            updateConf();
            EventListener.UpdateInitFile += updateConf;
            EventListener.QualityReleaseSearch += SearchQualityReleases;

            foreach (var m in conf.limit_map)
                CoreInit.conf.WAF.limit_map.Insert(0, m);

            CoreInit.BaseModValidQueryValueWhiteList.Add("query");

            ThreadPool.QueueUserWorkItem(async _ => await SyncCron.Run());
            ThreadPool.QueueUserWorkItem(async _ => await FileDB.Cron());
            ThreadPool.QueueUserWorkItem(async _ => await FileDB.CronFast());


            ThreadPool.QueueUserWorkItem(async _ =>
            {
                while (!IsDispose)
                {
                    await Task.Delay(TimeSpan.FromMinutes(5));

                    try
                    {
                        if (conf.typesearch == "jackett" || conf.merge == "jackett")
                        {
                            async ValueTask<bool> showdown(string name, TrackerSettings settings)
                            {
                                if (!settings.monitor_showdown)
                                    return false;

                                var proxyManager = new ProxyManager(name, settings);
                                string html = await Http.Get($"{settings.host}", timeoutSeconds: conf.Jackett.timeoutSeconds, proxy: proxyManager.Get(), weblog: false);
                                return html == null;
                            }

                            conf.Jackett.Rutor.showdown = await showdown("rutor", conf.Jackett.Rutor);
                            conf.Jackett.Megapeer.showdown = await showdown("megapeer", conf.Jackett.Megapeer);
                            conf.Jackett.TorrentBy.showdown = await showdown("torrentby", conf.Jackett.TorrentBy);
                            conf.Jackett.Kinozal.showdown = await showdown("kinozal", conf.Jackett.Kinozal);
                            conf.Jackett.NNMClub.showdown = await showdown("nnmclub", conf.Jackett.NNMClub);
                            conf.Jackett.Bitru.showdown = await showdown("bitru", conf.Jackett.Bitru);
                            conf.Jackett.Toloka.showdown = await showdown("toloka", conf.Jackett.Toloka);
                            conf.Jackett.Rutracker.showdown = await showdown("rutracker", conf.Jackett.Rutracker);
                            conf.Jackett.BigFanGroup.showdown = await showdown("bigfangroup", conf.Jackett.BigFanGroup);
                            conf.Jackett.Selezen.showdown = await showdown("selezen", conf.Jackett.Selezen);
                            conf.Jackett.Lostfilm.showdown = await showdown("lostfilm", conf.Jackett.Lostfilm);
                            conf.Jackett.Anilibria.showdown = await showdown("anilibria", conf.Jackett.Anilibria);
                            conf.Jackett.Animelayer.showdown = await showdown("animelayer", conf.Jackett.Animelayer);
                            conf.Jackett.Anifilm.showdown = await showdown("anifilm", conf.Jackett.Anifilm);
                        }
                    }
                    catch (System.Exception ex)
                    {
                        Serilog.Log.Error(ex, "{Class} {CatchId}", "ModInit", "id_p73el7f6");
                    }
                }
            });
        }

        public void Dispose()
        {
            IsDispose = true;
            EventListener.UpdateInitFile -= updateConf;
            EventListener.QualityReleaseSearch -= SearchQualityReleases;
        }

        // Use the same configured JacRed engines as its public indexer API.
        // This deliberately returns only metadata; no torrent links or keys cross the boundary.
        static async Task<IReadOnlyList<QualityRelease>> SearchQualityReleases(QualitySearchQuery request)
        {
            if (IsDispose || conf == null || request == null)
                return null;

            string query = !string.IsNullOrWhiteSpace(request.Title) ? request.Title : request.OriginalTitle;
            if (string.IsNullOrWhiteSpace(query))
                return Array.Empty<QualityRelease>();

            int serial = request.IsSerial ? 2 : 1;
            List<TorrentDetails> torrents;

            try
            {
                switch (conf.typesearch)
                {
                    case "red":
                        torrents = RedApi.Indexers(false, null, query, request.Title, request.OriginalTitle,
                            request.Year, serial, null).torrents.ToList();
                        break;
                    case "webapi":
                        torrents = await WebApi.Indexers(query, request.Title, request.OriginalTitle,
                            request.Year, serial, null);
                        break;
                    case "jackett":
                        torrents = await JackettApi.Indexers(request.Host, query, request.Title,
                            request.OriginalTitle, request.Year, serial, null);
                        break;
                    default:
                        return null;
                }

                if (conf.merge == "jackett" && conf.typesearch != "jackett")
                {
                    var supplemental = await JackettApi.Indexers(request.Host, query,
                        request.Title, request.OriginalTitle, request.Year, serial, null);
                    if (torrents == null && (supplemental == null || supplemental.Count == 0))
                        return null;
                    torrents ??= new List<TorrentDetails>();
                    if (supplemental != null)
                        torrents.AddRange(supplemental);
                }

                if (torrents == null)
                    return null;

                return torrents.Take(2_000).Select(t => new QualityRelease
                {
                    Title = t.title,
                    Types = t.types,
                    Year = t.relased,
                    Quality = t.quality,
                    VideoType = t.videotype,
                    Seeders = t.sid,
                    Peers = t.pir
                }).ToList();
            }
            catch (Exception ex)
            {
                Serilog.Log.Warning("JacRed Quality metadata lookup failed: {ErrorType}", ex.GetType().Name);
                return null;
            }
        }

        void updateConf()
        {
            conf = ModuleInvoke.Init("JacRed", new JacRedConf()
            {
                typesearch = "webapi",
                webApiHost = "http://ns3bg91xvuqfvq9h.cfhttp.top",
                merge = null,
                disableJackett = true,
                limit_map = new List<WafLimitRootMap>()
                {
                    new("^/api/(v1.0|v2.0)/", new WafLimitMap { limit = 10, second = 1 })
                }
            });
        }
    }
}
