using System;
using System.Collections.Generic;
using System.Linq;
using TranslationSub.Models;

namespace TranslationSub.Services;

/// <summary>
/// Builds profile-aware read models without mutating shared subscriptions.
/// Legacy CurrentEpisode/Notified fields are populated only on detached objects
/// so the existing frontend can keep working while it migrates to v2 snapshots.
/// </summary>
public static class TranslationSubProjectionService
{
    public static List<TranslationSubscription> ForProfile(string uid, string profileId)
    {
        uid = (uid ?? string.Empty).Trim();
        profileId = ProfileProgressStore.NormalizeProfileId(profileId);

        if (string.IsNullOrWhiteSpace(uid))
            return new List<TranslationSubscription>();

        var watched = ProfileProgressStore.LoadWatchedBySubscription(uid, profileId);
        var list = SubscriptionStore.Load()
            .Where(x => x != null && string.Equals(x.Uid, uid, StringComparison.Ordinal))
            .ToList();

        foreach (var sub in list)
        {
            int value;
            if (!string.IsNullOrWhiteSpace(sub.Id) && watched.TryGetValue(sub.Id, out int stored))
            {
                value = Math.Max(0, stored);
            }
            else if (profileId == "0")
            {
                // Compatibility bridge for installations that already persisted the
                // old shared progress before profile-scoped storage existed.
                value = Math.Max(0, sub.CurrentEpisode.GetValueOrDefault(0));
            }
            else
            {
                value = 0;
            }

            sub.CurrentEpisode = value;
            sub.Notified = sub.LastEpisode.GetValueOrDefault(0) <= value;
        }

        return list;
    }
}
