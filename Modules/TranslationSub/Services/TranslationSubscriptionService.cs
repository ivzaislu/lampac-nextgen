using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using TranslationSub.Models;
using TranslationSub.Providers;

namespace TranslationSub.Services;

public static class TranslationSubscriptionService
{
    static Timer timer;
    static int running;

    public static void Start()
    {
        Stop();
        timer = new Timer(async _ => await Tick(), null,
            TimeSpan.FromSeconds(15),
            TimeSpan.FromMinutes(Math.Max(1, ModInit.conf?.check_interval_minutes ?? 15)));
    }

    public static void Stop()
    {
        timer?.Dispose();
        timer = null;
    }

    public static async Task Tick()
    {
        if (Interlocked.Exchange(ref running, 1) == 1)
            return;

        try
        {
            var list = SubscriptionStore.Load();
            bool changed = false;

            foreach (var sub in list)
            {
                try
                {
                    long.TryParse(sub.KpId, out long kp);
                    int season = sub.IsSerial ? sub.CurrentSeason.GetValueOrDefault(1) : 0;
                    if (sub.IsSerial && season <= 0)
                        season = 1;

                    var response = await TranslationProviderHub.GetVariants(new VoiceProviderQuery
                    {
                        ImdbId = sub.ImdbId,
                        KpId = kp,
                        Title = sub.Title,
                        OriginalTitle = sub.OriginalTitle,
                        Year = sub.Year.GetValueOrDefault(0),
                        IsSerial = sub.IsSerial,
                        Season = season
                    }).ConfigureAwait(false);

                    var matches = response.Translations.Where(x =>
                        (!sub.IsSerial || x.season == season) &&
                        (
                            (!string.IsNullOrWhiteSpace(sub.TranslationId) && x.translation_id == sub.TranslationId) ||
                            (!string.IsNullOrWhiteSpace(sub.TranslationName) &&
                             VoiceNormalize.Normalize(x.translation) == VoiceNormalize.Normalize(sub.TranslationName))
                        )
                    ).ToList();

                    int latestEpisode = matches.Select(x => x.episode).DefaultIfEmpty(0).Max();
                    if (!sub.IsSerial && matches.Count > 0)
                        latestEpisode = Math.Max(latestEpisode, 1);

                    var best = matches.OrderByDescending(x => x.episode).FirstOrDefault();
                    if (best?.Sources != null && best.Sources.Count > 0)
                    {
                        sub.Sources = best.Sources.Select(x => new TranslationSubscriptionSource
                        {
                            Source = x.Source,
                            Path = x.Path,
                            TranslationId = x.TranslationId,
                            TranslationName = x.TranslationName
                        }).ToList();

                        sub.Source = sub.Sources.Count > 1 ? "multi" : sub.Sources[0].Source;
                    }

                    if (latestEpisode > sub.LastEpisode.GetValueOrDefault(0))
                    {
                        sub.LastEpisode = latestEpisode;
                        sub.LastSeason = sub.IsSerial ? season : 0;
                        sub.Notified = false;
                    }

                    sub.LastCheckedAt = DateTime.Now;
                    changed = true;
                }
                catch { }
            }

            if (changed)
                SubscriptionStore.Save(list);
        }
        finally
        {
            Volatile.Write(ref running, 0);
        }
    }
}
