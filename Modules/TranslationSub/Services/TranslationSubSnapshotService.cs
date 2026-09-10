using System;
using System.Collections.Generic;
using System.Linq;
using TranslationSub.Models;

namespace TranslationSub.Services;

/// <summary>
/// Builds the canonical profile-aware TranslationSub read model consumed by
/// thin clients. All progress/update/schedule decisions belong here, not in JS.
/// </summary>
public static class TranslationSubSnapshotService
{
    public static TranslationSubSnapshot Build(string uid, string profileId)
    {
        profileId = ProfileProgressStore.NormalizeProfileId(profileId);
        var subscriptions = TranslationSubProjectionService.ForProfile(uid, profileId)
            .Select(ToSnapshot)
            .OrderByDescending(x => x.HasNewEpisodes)
            .ThenBy(x => x.Title ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.TranslationName ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var updates = subscriptions
            .Where(x => x.HasNewEpisodes)
            .ToList();

        return new TranslationSubSnapshot
        {
            GeneratedAt = DateTime.Now,
            ProfileId = profileId,
            Badge = new TranslationSubBadgeSnapshot
            {
                Count = updates.Count
            },
            Subscriptions = subscriptions,
            Updates = updates
        };
    }

    static TranslationSubSubscriptionSnapshot ToSnapshot(TranslationSubscription sub)
    {
        int watched = Math.Max(0, sub.CurrentEpisode.GetValueOrDefault(0));
        int available = Math.Max(0, sub.LastEpisode.GetValueOrDefault(0));
        bool hasNew = available > watched;
        int season = Math.Max(1, sub.LastSeason ?? sub.CurrentSeason ?? 1);

        return new TranslationSubSubscriptionSnapshot
        {
            Id = sub.Id,
            ContentId = sub.ContentId,
            Title = sub.Title,
            OriginalTitle = sub.OriginalTitle,
            KpId = sub.KpId,
            ImdbId = sub.ImdbId,
            TmdbId = sub.TmdbId,
            Poster = sub.Poster,
            Year = sub.Year,
            IsSerial = sub.IsSerial,
            Season = season,
            WatchedEpisode = watched,
            AvailableEpisode = available,
            HasNewEpisodes = hasNew,
            FromEpisode = hasNew ? watched + 1 : 0,
            ToEpisode = hasNew ? available : 0,
            NewCount = Math.Max(0, available - watched),
            ProgressPercent = available > 0
                ? Math.Max(0, Math.Min(100, (int)Math.Round(watched * 100d / available)))
                : 0,
            Source = sub.Source,
            Sources = (sub.Sources ?? new List<TranslationSubscriptionSource>())
                .Where(x => x != null)
                .Select(x => new TranslationSubSourceSnapshot
                {
                    Source = x.Source,
                    TranslationId = x.TranslationId,
                    TranslationName = x.TranslationName
                })
                .ToList(),
            TranslationId = sub.TranslationId,
            TranslationName = sub.TranslationName,
            LastCheckedAt = sub.LastCheckedAt,
            Schedule = BuildSchedule(sub, available),
            Tmdb = new TranslationSubTmdbSnapshot
            {
                Status = sub.TmdbStatus,
                LastSeason = sub.TmdbLastSeason,
                LastEpisode = sub.TmdbLastEpisode,
                LastAirDate = sub.TmdbLastAirDate,
                NextSeason = sub.TmdbNextSeason,
                NextEpisode = sub.TmdbNextEpisode,
                NextAirDate = sub.TmdbNextAirDate,
                TargetSeasonEpisodes = sub.TmdbTargetSeasonEpisodes,
                LastSyncedAt = sub.TmdbLastSyncedAt,
                NewSeasonAvailable = sub.TmdbNewSeasonAvailable
            }
        };
    }

    static TranslationSubScheduleSnapshot BuildSchedule(TranslationSubscription sub, int available)
    {
        int aired = Math.Max(0, sub.TmdbTargetSeasonEpisodes.GetValueOrDefault(0));
        int tmdbLastSeason = Math.Max(0, sub.TmdbLastSeason.GetValueOrDefault(0));
        int nextSeason = Math.Max(0, sub.TmdbNextSeason.GetValueOrDefault(0));
        string code = (sub.ScheduleState ?? string.Empty).Trim();

        if (sub.TmdbNewSeasonAvailable)
        {
            int season = Math.Max(tmdbLastSeason, nextSeason);
            return Schedule(code, season > 0
                ? "Новый сезон S" + season + " уже начался"
                : "Новый сезон уже начался", "new-season");
        }

        if (code == "active_dubbing")
        {
            if (aired > available)
            {
                string text = "Ждём озвучку E" + (available + 1);
                if (aired > available + 1)
                    text += "–E" + aired;
                return Schedule(code, text, "active");
            }

            return Schedule(code, "Ждём обновление озвучки", "active");
        }

        return code switch
        {
            "waiting_air" => Schedule(code, "Балансеры спят до выхода следующей серии", "sleep"),
            "ended" => Schedule(code, "Сериал завершён · балансеры спят", "sleep"),
            "new_season" => Schedule(code, "Новый сезон уже начался", "new-season"),
            "season_complete" => Schedule(code, "Сезон завершён · ждём TMDB", "sleep"),
            "waiting_tmdb" => Schedule(code, "Озвучка догнала вышедшие серии", "ok"),
            "tmdb_unavailable" => Schedule(code, "TMDB временно недоступен · используется резервный интервал", "warn"),
            "sources_disabled" => Schedule(code, "Балансеры отключены", "warn"),
            "interval_wait" => Schedule(code, "Умное расписание TMDB отключено", "plain"),
            _ when aired > 0 => Schedule(code, "TMDB отслеживает сезон", "plain"),
            _ => null
        };
    }

    static TranslationSubScheduleSnapshot Schedule(string code, string text, string type)
        => new()
        {
            Code = code,
            Text = text,
            Type = type
        };
}
