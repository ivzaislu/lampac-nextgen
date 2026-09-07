using System;
using System.Collections.Generic;
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

    public static async Task Tick(string userKey = null, HashSet<string> enabledSources = null)
    {
        if (Interlocked.Exchange(ref running, 1) == 1)
            return;

        try
        {
            try
            {
                // Снимок нужен только для сетевых запросов. Результаты никогда не сохраняем
                // обратно целиком, чтобы не затереть параллельный watched/toggle/remove.
                var snapshot = SubscriptionStore.Load();

                foreach (var sub in snapshot)
                {
                    if (!string.IsNullOrWhiteSpace(userKey) && sub.UserKey != userKey)
                        continue;

                    try
                    {
                        long.TryParse(sub.KpId, out long kp);
                        int season = sub.IsSerial ? sub.CurrentSeason.GetValueOrDefault(1) : 0;
                        if (sub.IsSerial && season <= 0)
                            season = 1;

                        HashSet<string> sources = enabledSources;
                        if (sources == null && sub.Sources != null && sub.Sources.Count > 0)
                        {
                            sources = sub.Sources
                                .Where(x => !string.IsNullOrWhiteSpace(x.Source))
                                .Select(x => x.Source)
                                .ToHashSet(StringComparer.OrdinalIgnoreCase);
                        }

                        var response = await TranslationProviderHub.GetVariants(new VoiceProviderQuery
                        {
                            ImdbId = sub.ImdbId,
                            KpId = kp,
                            Title = sub.Title,
                            OriginalTitle = sub.OriginalTitle,
                            Year = sub.Year.GetValueOrDefault(0),
                            IsSerial = sub.IsSerial,
                            Season = season,
                            Sources = sources
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
                        var newSources = best?.Sources?.Where(x => x != null).Select(x => new TranslationSubscriptionSource
                        {
                            Source = x.Source,
                            Path = x.Path,
                            TranslationId = x.TranslationId,
                            TranslationName = x.TranslationName
                        }).ToList();

                        string subscriptionId = sub.Id;
                        bool isSerial = sub.IsSerial;

                        SubscriptionStore.Mutate(list =>
                        {
                            var current = list.FirstOrDefault(x => x.Id == subscriptionId);
                            if (current == null)
                                return;

                            if (newSources != null && newSources.Count > 0)
                            {
                                current.Sources = newSources;
                                current.Source = newSources.Count > 1 ? "multi" : newSources[0].Source;
                            }

                            if (latestEpisode > current.LastEpisode.GetValueOrDefault(0))
                            {
                                current.LastEpisode = latestEpisode;
                                current.LastSeason = isSerial ? season : 0;
                            }

                            current.Notified = current.LastEpisode.GetValueOrDefault(0)
                                <= current.CurrentEpisode.GetValueOrDefault(0);
                            current.LastCheckedAt = DateTime.Now;
                        });
                    }
                    catch
                    {
                        // Ошибка одной подписки не должна прерывать остальные.
                    }
                }
            }
            catch
            {
                // Timer использует async callback. Не позволяем I/O/JSON ошибке
                // выйти наружу и завершить процесс Lampac.
            }
        }
        finally
        {
            Volatile.Write(ref running, 0);
        }
    }
}
