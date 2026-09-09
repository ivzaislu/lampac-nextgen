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
    static readonly SemaphoreSlim tickGate = new(1, 1);

    public static void Start()
    {
        Stop();

        // Cheap scheduler wake-up only. External requests happen only when
        // TMDB/user settings say a subscription is actually due.
        timer = new Timer(async _ => await Tick(), null,
            TimeSpan.FromSeconds(15),
            TimeSpan.FromMinutes(Math.Max(5, ModInit.conf?.check_interval_minutes ?? 15)));
    }

    public static void Stop()
    {
        timer?.Dispose();
        timer = null;
    }

    public static async Task Tick(string userKey = null, HashSet<string> enabledSources = null, bool force = false)
    {
        // Keep backward compatibility for callers that historically used userKey
        // as the implicit force flag. Explicit force is required for manual checks
        // without a userKey (for example local/global maintenance calls).
        force = force || !string.IsNullOrWhiteSpace(userKey);

        bool entered = false;
        try
        {
            if (force)
            {
                // Manual checks must never disappear just because the background
                // timer is currently running. Queue and execute them afterwards.
                await tickGate.WaitAsync().ConfigureAwait(false);
                entered = true;
            }
            else
            {
                // Background wake-ups are cheap and may be skipped while another
                // tick is active. The next timer wake-up will try again.
                entered = await tickGate.WaitAsync(0).ConfigureAwait(false);
                if (!entered)
                    return;
            }

            DateTime now = DateTime.Now;

            try
            {
                var snapshot = SubscriptionStore.Load();
                var settingsCache = new Dictionary<string, TranslationUserSettings>(StringComparer.Ordinal);
                var tmdbCache = new Dictionary<string, TmdbScheduleSnapshot>(StringComparer.OrdinalIgnoreCase);
                var variantCache = new Dictionary<string, TranslationVariantsResponse>(StringComparer.Ordinal);

                foreach (var sub in snapshot)
                {
                    if (!string.IsNullOrWhiteSpace(userKey) && sub.UserKey != userKey)
                        continue;

                    try
                    {
                        string settingsKey = string.IsNullOrWhiteSpace(sub.UserKey) ? "local" : sub.UserKey;
                        if (!settingsCache.TryGetValue(settingsKey, out var settings))
                        {
                            settings = TranslationSettingsStore.Get(settingsKey);
                            settingsCache[settingsKey] = settings;
                        }

                        bool smartTmdb = settings.UseTmdbSchedule && sub.IsSerial
                            && (IsTmdbId(sub.TmdbId) || IsImdbId(sub.ImdbId));
                        TmdbScheduleSnapshot tmdb = null;

                        if (smartTmdb)
                        {
                            string identityKey = TmdbCacheKey(sub);

                            // If another subscription for the same show refreshed TMDB in
                            // this tick, reuse it. This is important when several voices are
                            // subscribed for the same series.
                            if (!string.IsNullOrWhiteSpace(identityKey)
                                && tmdbCache.TryGetValue(identityKey, out tmdb))
                            {
                                ApplyTmdbState(sub.Id, tmdb, settings, now);
                                CopyTmdbState(sub, tmdb, settings, now);
                                HandleNewSeason(sub, tmdb, settings, now);
                            }
                            else if (force || ShouldRefreshTmdb(sub, settings, now))
                            {
                                tmdb = await TmdbScheduleService.Get(sub.TmdbId, sub.ImdbId).ConfigureAwait(false);
                                if (tmdb != null)
                                {
                                    string resolvedTmdbKey = "tmdb:" + tmdb.TmdbId;
                                    tmdbCache[resolvedTmdbKey] = tmdb;
                                    if (IsImdbId(tmdb.ImdbId))
                                        tmdbCache["imdb:" + tmdb.ImdbId.ToLowerInvariant()] = tmdb;
                                    if (!string.IsNullOrWhiteSpace(identityKey))
                                        tmdbCache[identityKey] = tmdb;

                                    ApplyTmdbState(sub.Id, tmdb, settings, now);
                                    CopyTmdbState(sub, tmdb, settings, now);
                                    HandleNewSeason(sub, tmdb, settings, now);
                                }
                            }

                            if (tmdb == null)
                                tmdb = SnapshotFromStored(sub);
                        }

                        int season = sub.IsSerial ? sub.CurrentSeason.GetValueOrDefault(1) : 0;
                        if (sub.IsSerial && season <= 0)
                            season = 1;

                        int expectedAired = smartTmdb ? ExpectedAiredEpisode(sub, tmdb, season, now) : 0;

                        if (!force)
                        {
                            if (smartTmdb && tmdb != null)
                            {
                                if (!ShouldPollBalancersSmart(sub, tmdb, settings, season, expectedAired, now, out string state))
                                {
                                    SetScheduleState(sub.Id, state, expectedAired);
                                    continue;
                                }
                            }
                            else if (!IntervalDue(sub.LastCheckedAt, settings.CheckIntervalHours, now))
                            {
                                SetScheduleState(sub.Id, smartTmdb ? "tmdb_unavailable" : "interval_wait", expectedAired);
                                continue;
                            }
                        }

                        HashSet<string> sources = ResolveSources(sub, settings, enabledSources, force);
                        if (sources != null && sources.Count == 0)
                        {
                            SetScheduleState(sub.Id, "sources_disabled", expectedAired);
                            continue;
                        }

                        long.TryParse(sub.KpId, out long kp);
                        var query = new VoiceProviderQuery
                        {
                            ImdbId = sub.ImdbId,
                            KpId = kp,
                            Title = sub.Title,
                            OriginalTitle = sub.OriginalTitle,
                            Year = sub.Year.GetValueOrDefault(0),
                            IsSerial = sub.IsSerial,
                            Season = season,
                            Sources = sources
                        };

                        string cacheKey = BuildVariantCacheKey(query);
                        if (!variantCache.TryGetValue(cacheKey, out var response))
                        {
                            response = await TranslationProviderHub.GetVariants(query).ConfigureAwait(false);
                            variantCache[cacheKey] = response;
                        }

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

                        // TMDB is authoritative for what has actually aired. This also
                        // fixes old bad data such as a balancer reporting E13 while TMDB
                        // says the season has only aired through E10.
                        if (smartTmdb && expectedAired > 0)
                            latestEpisode = Math.Min(latestEpisode, expectedAired);

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

                            if (smartTmdb && expectedAired > 0 && current.LastEpisode.GetValueOrDefault(0) > expectedAired)
                                current.LastEpisode = expectedAired;

                            current.Notified = current.LastEpisode.GetValueOrDefault(0)
                                <= current.CurrentEpisode.GetValueOrDefault(0);
                            current.LastCheckedAt = now;
                            current.ScheduleState = ResolveAfterCheckState(current, tmdb, settings, expectedAired, now);
                        });
                    }
                    catch
                    {
                        // One broken subscription/provider must not stop the queue.
                    }
                }
            }
            catch
            {
                // Timer uses an async callback. Never let storage/network failures
                // escape and terminate the Lampac process.
            }
        }
        finally
        {
            if (entered)
                tickGate.Release();
        }
    }

    static bool IsTmdbId(string value)
        => long.TryParse(value, out long id) && id > 0;

    static bool IsImdbId(string value)
    {
        value = (value ?? string.Empty).Trim();
        return value.StartsWith("tt", StringComparison.OrdinalIgnoreCase)
            && long.TryParse(value.Substring(2), out long id)
            && id > 0;
    }

    static string TmdbCacheKey(TranslationSubscription sub)
    {
        if (IsImdbId(sub.ImdbId))
            return "imdb:" + sub.ImdbId.Trim().ToLowerInvariant();
        if (IsTmdbId(sub.TmdbId))
            return "tmdb:" + sub.TmdbId.Trim();
        return string.Empty;
    }

    static bool ShouldRefreshTmdb(TranslationSubscription sub, TranslationUserSettings settings, DateTime now)
    {
        if (!sub.TmdbLastSyncedAt.HasValue)
            return true;

        // A known release date is a hard wake-up point. Do not wait another
        // TmdbRefreshHours after the calendar reaches that date.
        if (sub.TmdbNextAirDate.HasValue && sub.TmdbNextAirDate.Value.Date <= now.Date)
        {
            int lastSeason = sub.TmdbLastSeason.GetValueOrDefault(0);
            int lastEpisode = sub.TmdbLastEpisode.GetValueOrDefault(0);
            int nextSeason = sub.TmdbNextSeason.GetValueOrDefault(0);
            int nextEpisode = sub.TmdbNextEpisode.GetValueOrDefault(0);

            if (nextSeason > lastSeason || (nextSeason == lastSeason && nextEpisode > lastEpisode))
                return true;
        }

        bool ended = IsEndedStatus(sub.TmdbStatus);
        TimeSpan interval = ended
            ? TimeSpan.FromDays(Math.Max(1, settings.EndedRefreshDays))
            : TimeSpan.FromHours(Math.Max(6, settings.TmdbRefreshHours));

        return now - sub.TmdbLastSyncedAt.Value >= interval;
    }

    static bool IntervalDue(DateTime? last, int hours, DateTime now)
        => !last.HasValue || now - last.Value >= TimeSpan.FromHours(Math.Max(1, Math.Min(24, hours)));

    static HashSet<string> ResolveSources(
        TranslationSubscription sub,
        TranslationUserSettings settings,
        HashSet<string> enabledSources,
        bool force)
    {
        if (enabledSources != null)
            return enabledSources;

        if (!force)
        {
            return (settings.Sources ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        if (sub.Sources != null && sub.Sources.Count > 0)
        {
            return sub.Sources
                .Where(x => !string.IsNullOrWhiteSpace(x.Source))
                .Select(x => x.Source)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        return null;
    }

    static string BuildVariantCacheKey(VoiceProviderQuery query)
    {
        string sources = query.Sources == null
            ? "*"
            : string.Join(",", query.Sources.OrderBy(x => x, StringComparer.OrdinalIgnoreCase));

        return string.Join("|",
            query.KpId,
            query.ImdbId ?? string.Empty,
            query.Title ?? string.Empty,
            query.OriginalTitle ?? string.Empty,
            query.Year,
            query.IsSerial ? 1 : 0,
            query.Season,
            sources);
    }

    static void ApplyTmdbState(string subscriptionId, TmdbScheduleSnapshot tmdb, TranslationUserSettings settings, DateTime now)
    {
        SubscriptionStore.Mutate(list =>
        {
            var current = list.FirstOrDefault(x => x.Id == subscriptionId);
            if (current == null)
                return;

            int season = current.CurrentSeason.GetValueOrDefault(1);
            int expected = ExpectedAiredEpisode(tmdb, season, now);

            current.TmdbId = tmdb.TmdbId;
            if (string.IsNullOrWhiteSpace(current.ImdbId) && IsImdbId(tmdb.ImdbId))
                current.ImdbId = tmdb.ImdbId;
            current.TmdbStatus = tmdb.Status;
            current.TmdbLastSeason = tmdb.LastSeason > 0 ? tmdb.LastSeason : null;
            current.TmdbLastEpisode = tmdb.LastEpisode > 0 ? tmdb.LastEpisode : null;
            current.TmdbLastAirDate = tmdb.LastAirDate;
            current.TmdbNextSeason = tmdb.NextSeason > 0 ? tmdb.NextSeason : null;
            current.TmdbNextEpisode = tmdb.NextEpisode > 0 ? tmdb.NextEpisode : null;
            current.TmdbNextAirDate = tmdb.NextAirDate;
            current.TmdbTargetSeasonEpisodes = expected > 0 ? expected : null;
            current.TmdbLastSyncedAt = tmdb.SyncedAt;

            if (expected > 0 && current.LastEpisode.GetValueOrDefault(0) > expected)
                current.LastEpisode = expected;

            current.TmdbNewSeasonAvailable = NewSeasonStarted(tmdb, season, now)
                && string.Equals(settings.NewSeasonMode, "notify", StringComparison.OrdinalIgnoreCase);
        });
    }

    static void CopyTmdbState(TranslationSubscription sub, TmdbScheduleSnapshot tmdb, TranslationUserSettings settings, DateTime now)
    {
        int season = sub.CurrentSeason.GetValueOrDefault(1);
        int expected = ExpectedAiredEpisode(tmdb, season, now);

        sub.TmdbId = tmdb.TmdbId;
        if (string.IsNullOrWhiteSpace(sub.ImdbId) && IsImdbId(tmdb.ImdbId))
            sub.ImdbId = tmdb.ImdbId;
        sub.TmdbStatus = tmdb.Status;
        sub.TmdbLastSeason = tmdb.LastSeason > 0 ? tmdb.LastSeason : null;
        sub.TmdbLastEpisode = tmdb.LastEpisode > 0 ? tmdb.LastEpisode : null;
        sub.TmdbLastAirDate = tmdb.LastAirDate;
        sub.TmdbNextSeason = tmdb.NextSeason > 0 ? tmdb.NextSeason : null;
        sub.TmdbNextEpisode = tmdb.NextEpisode > 0 ? tmdb.NextEpisode : null;
        sub.TmdbNextAirDate = tmdb.NextAirDate;
        sub.TmdbTargetSeasonEpisodes = expected > 0 ? expected : null;
        sub.TmdbLastSyncedAt = tmdb.SyncedAt;
        sub.TmdbNewSeasonAvailable = NewSeasonStarted(tmdb, season, now)
            && string.Equals(settings.NewSeasonMode, "notify", StringComparison.OrdinalIgnoreCase);

        if (expected > 0 && sub.LastEpisode.GetValueOrDefault(0) > expected)
            sub.LastEpisode = expected;
    }

    static TmdbScheduleSnapshot SnapshotFromStored(TranslationSubscription sub)
    {
        if (!sub.TmdbLastSyncedAt.HasValue)
            return null;

        return new TmdbScheduleSnapshot
        {
            TmdbId = sub.TmdbId,
            ImdbId = sub.ImdbId,
            Status = sub.TmdbStatus,
            LastSeason = sub.TmdbLastSeason.GetValueOrDefault(0),
            LastEpisode = sub.TmdbLastEpisode.GetValueOrDefault(0),
            LastAirDate = sub.TmdbLastAirDate,
            NextSeason = sub.TmdbNextSeason.GetValueOrDefault(0),
            NextEpisode = sub.TmdbNextEpisode.GetValueOrDefault(0),
            NextAirDate = sub.TmdbNextAirDate,
            SyncedAt = sub.TmdbLastSyncedAt.Value
        };
    }

    static int ExpectedAiredEpisode(TranslationSubscription sub, TmdbScheduleSnapshot tmdb, int season, DateTime now)
    {
        if (tmdb == null)
            return sub.TmdbTargetSeasonEpisodes.GetValueOrDefault(0);

        int value = ExpectedAiredEpisode(tmdb, season, now);
        if (value <= 0)
            value = sub.TmdbTargetSeasonEpisodes.GetValueOrDefault(0);
        return value;
    }

    static int ExpectedAiredEpisode(TmdbScheduleSnapshot tmdb, int season, DateTime now)
    {
        if (tmdb == null || season <= 0)
            return 0;

        int dueNext = 0;
        if (tmdb.NextSeason == season && tmdb.NextAirDate.HasValue && tmdb.NextAirDate.Value.Date <= now.Date)
            dueNext = Math.Max(1, tmdb.NextEpisode);

        if (tmdb.LastSeason > season)
            return tmdb.SeasonEpisodeCounts.TryGetValue(season, out int count) ? Math.Max(0, count) : dueNext;

        if (tmdb.LastSeason == season)
            return Math.Max(Math.Max(0, tmdb.LastEpisode), dueNext);

        return dueNext;
    }

    static bool ShouldPollBalancersSmart(
        TranslationSubscription sub,
        TmdbScheduleSnapshot tmdb,
        TranslationUserSettings settings,
        int season,
        int expectedAired,
        DateTime now,
        out string state)
    {
        int available = sub.LastEpisode.GetValueOrDefault(0);

        if (expectedAired > available)
        {
            state = "active_dubbing";
            return IntervalDue(sub.LastCheckedAt, settings.CheckIntervalHours, now);
        }

        if (tmdb.NextAirDate.HasValue && tmdb.NextAirDate.Value.Date > now.Date)
        {
            state = "waiting_air";
            return false;
        }

        if (IsEndedStatus(tmdb.Status))
        {
            state = "ended";
            return false;
        }

        if (NewSeasonStarted(tmdb, season, now))
        {
            state = string.Equals(settings.NewSeasonMode, "notify", StringComparison.OrdinalIgnoreCase)
                ? "new_season"
                : "season_complete";
            return false;
        }

        state = "waiting_tmdb";
        return false;
    }

    static string ResolveAfterCheckState(
        TranslationSubscription current,
        TmdbScheduleSnapshot tmdb,
        TranslationUserSettings settings,
        int expectedAired,
        DateTime now)
    {
        if (tmdb == null || !settings.UseTmdbSchedule)
            return "interval_wait";

        int available = current.LastEpisode.GetValueOrDefault(0);
        if (expectedAired > available)
            return "active_dubbing";

        if (tmdb.NextAirDate.HasValue && tmdb.NextAirDate.Value.Date > now.Date)
            return "waiting_air";

        if (IsEndedStatus(tmdb.Status))
            return "ended";

        if (NewSeasonStarted(tmdb, current.CurrentSeason.GetValueOrDefault(1), now))
            return string.Equals(settings.NewSeasonMode, "notify", StringComparison.OrdinalIgnoreCase)
                ? "new_season"
                : "season_complete";

        return "waiting_tmdb";
    }

    static bool NewSeasonStarted(TmdbScheduleSnapshot tmdb, int currentSeason, DateTime now)
    {
        if (tmdb == null)
            return false;

        if (tmdb.LastSeason > currentSeason && tmdb.LastAirDate.HasValue && tmdb.LastAirDate.Value.Date <= now.Date)
            return true;

        return tmdb.NextSeason > currentSeason
            && tmdb.NextAirDate.HasValue
            && tmdb.NextAirDate.Value.Date <= now.Date;
    }

    static bool IsEndedStatus(string status)
        => string.Equals(status, "Ended", StringComparison.OrdinalIgnoreCase)
        || string.Equals(status, "Canceled", StringComparison.OrdinalIgnoreCase)
        || string.Equals(status, "Cancelled", StringComparison.OrdinalIgnoreCase);

    static void SetScheduleState(string subscriptionId, string state, int expectedAired)
    {
        SubscriptionStore.MutateIfChanged(list =>
        {
            var current = list.FirstOrDefault(x => x.Id == subscriptionId);
            if (current == null)
                return false;

            bool changed = false;
            if (!string.Equals(current.ScheduleState, state, StringComparison.Ordinal))
            {
                current.ScheduleState = state;
                changed = true;
            }

            if (expectedAired > 0 && current.TmdbTargetSeasonEpisodes.GetValueOrDefault(0) != expectedAired)
            {
                current.TmdbTargetSeasonEpisodes = expectedAired;
                changed = true;
            }

            return changed;
        });
    }

    static void HandleNewSeason(TranslationSubscription sub, TmdbScheduleSnapshot tmdb, TranslationUserSettings settings, DateTime now)
    {
        if (!sub.IsSerial || tmdb == null)
            return;

        int currentSeason = sub.CurrentSeason.GetValueOrDefault(1);
        if (!NewSeasonStarted(tmdb, currentSeason, now))
            return;

        string mode = settings.NewSeasonMode ?? "auto";
        if (!string.Equals(mode, "auto", StringComparison.OrdinalIgnoreCase))
            return;

        int newSeason = tmdb.LastSeason > currentSeason ? tmdb.LastSeason : tmdb.NextSeason;
        if (newSeason <= currentSeason)
            return;

        int expected = ExpectedAiredEpisode(tmdb, newSeason, now);
        string normalizedVoice = VoiceNormalize.Normalize(sub.TranslationName);

        SubscriptionStore.MutateIfChanged(list =>
        {
            bool exists = list.Any(x =>
                x.UserKey == sub.UserKey
                && x.ContentId == sub.ContentId
                && x.CurrentSeason.GetValueOrDefault(1) == newSeason
                && (
                    (!string.IsNullOrWhiteSpace(sub.TranslationId) && x.TranslationId == sub.TranslationId)
                    || VoiceNormalize.Normalize(x.TranslationName) == normalizedVoice
                ));

            if (exists)
                return false;

            list.Add(new TranslationSubscription
            {
                Id = Guid.NewGuid().ToString("N"),
                UserKey = sub.UserKey,
                ContentId = sub.ContentId,
                Title = sub.Title,
                OriginalTitle = sub.OriginalTitle,
                KpId = sub.KpId,
                ImdbId = sub.ImdbId,
                TmdbId = sub.TmdbId,
                Poster = sub.Poster,
                Year = sub.Year,
                IsSerial = true,
                Source = sub.Source,
                TranslationId = sub.TranslationId,
                TranslationName = sub.TranslationName,
                CurrentSeason = newSeason,
                CurrentEpisode = 0,
                LastSeason = newSeason,
                LastEpisode = 0,
                Notified = true,
                Sources = sub.Sources?.Select(x => new TranslationSubscriptionSource
                {
                    Source = x.Source,
                    Path = x.Path,
                    TranslationId = x.TranslationId,
                    TranslationName = x.TranslationName
                }).ToList() ?? new List<TranslationSubscriptionSource>(),
                CreatedAt = now,
                TmdbStatus = tmdb.Status,
                TmdbLastSeason = tmdb.LastSeason > 0 ? tmdb.LastSeason : null,
                TmdbLastEpisode = tmdb.LastEpisode > 0 ? tmdb.LastEpisode : null,
                TmdbLastAirDate = tmdb.LastAirDate,
                TmdbNextSeason = tmdb.NextSeason > 0 ? tmdb.NextSeason : null,
                TmdbNextEpisode = tmdb.NextEpisode > 0 ? tmdb.NextEpisode : null,
                TmdbNextAirDate = tmdb.NextAirDate,
                TmdbTargetSeasonEpisodes = expected > 0 ? expected : null,
                TmdbLastSyncedAt = tmdb.SyncedAt,
                ScheduleState = "active_dubbing",
                TmdbNewSeasonAvailable = false
            });
            return true;
        });
    }
}
