using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using TranslationSub.Providers;

namespace TranslationSub.Services;

public static class TranslationSubscriptionService
{
    static Timer timer;
    static int running;
    static readonly MirageVoiceProvider provider = new();

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
                    int season = sub.CurrentSeason.GetValueOrDefault(1);
                    if (season <= 0) season = 1;

                    var variants = await provider.GetVariants(sub.ImdbId, kp, sub.Title, sub.IsSerial, season);
                    int.TryParse(sub.TranslationId, out int tid);

                    var matches = variants.Where(x =>
                        (tid > 0 && x.translation_id == tid) ||
                        (!string.IsNullOrWhiteSpace(sub.TranslationName) &&
                         VoiceNormalize.Normalize(x.translation) == VoiceNormalize.Normalize(sub.TranslationName))
                    ).ToList();

                    int latestEpisode = matches.Select(x => x.episode).DefaultIfEmpty(0).Max();
                    if (!sub.IsSerial && matches.Count > 0)
                        latestEpisode = Math.Max(latestEpisode, 1);

                    if (latestEpisode > sub.LastEpisode.GetValueOrDefault(0))
                    {
                        sub.LastEpisode = latestEpisode;
                        sub.LastSeason = season;
                        sub.Notified = false;
                        changed = true;
                    }

                    sub.LastCheckedAt = DateTime.Now;
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
