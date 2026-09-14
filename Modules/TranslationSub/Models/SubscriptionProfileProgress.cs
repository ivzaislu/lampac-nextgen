using System;

namespace TranslationSub.Models;

public class SubscriptionProfileProgress
{
    public string Uid { get; set; }
    public string ProfileId { get; set; } = "0";
    public string SubscriptionId { get; set; }
    public int WatchedEpisode { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}

public sealed class TranslationSubProfileProjection
{
    public TranslationSubscription Subscription { get; init; }
    public int WatchedEpisode { get; init; }
}
