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
}

public class TranslationSubscriptionSource
{
    public string Source { get; set; }
    public string Path { get; set; }
    public string TranslationId { get; set; }
    public string TranslationName { get; set; }
}
