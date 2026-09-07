using System;
using System.Collections.Generic;

namespace TranslationSub.Models;

public class TranslationSubscription
{
    public string Id { get; set; }
    public string UserKey { get; set; }
    public string ContentId { get; set; }
    public string Title { get; set; }
    public string OriginalTitle { get; set; }
    public string KpId { get; set; }
    public string ImdbId { get; set; }
    public string TmdbId { get; set; }
    public string Poster { get; set; }
    public int? Year { get; set; }
    public bool IsSerial { get; set; } = true;
    public string Source { get; set; }
    public string TranslationId { get; set; }
    public string TranslationName { get; set; }
    public int? CurrentSeason { get; set; }
    public int? CurrentEpisode { get; set; }
    public int? LastSeason { get; set; }
    public int? LastEpisode { get; set; }
    public bool Notified { get; set; }
    public List<TranslationSubscriptionSource> Sources { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime? LastCheckedAt { get; set; }

    // TMDB is the scheduling source: it tells us when there is actually
    // something new to look for in the voice balancers.
    public string TmdbStatus { get; set; }
    public int? TmdbLastSeason { get; set; }
    public int? TmdbLastEpisode { get; set; }
    public DateTime? TmdbLastAirDate { get; set; }
    public int? TmdbNextSeason { get; set; }
    public int? TmdbNextEpisode { get; set; }
    public DateTime? TmdbNextAirDate { get; set; }
    public int? TmdbTargetSeasonEpisodes { get; set; }
    public DateTime? TmdbLastSyncedAt { get; set; }
    public string ScheduleState { get; set; }
    public bool TmdbNewSeasonAvailable { get; set; }
}

public class TranslationSubscriptionSource
{
    public string Source { get; set; }
    public string Path { get; set; }
    public string TranslationId { get; set; }
    public string TranslationName { get; set; }
}
