using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using TranslationSub.Models;

namespace TranslationSub.Services;

/// <summary>
/// Durable profile-scoped projection of Lampac TimeCode progress.
/// This store is not the source of truth: TimeCodeProgressService reconciles it
/// from database/TimeCode.sql whenever Lampac commits progress.
/// </summary>
public static class ProfileProgressStore
{
    static readonly object locker = new();
    static string path => "database/translationsub/profile-progress.json";

    public static string NormalizeProfileId(string profileId)
    {
        profileId = (profileId ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(profileId) ? "0" : profileId;
    }

    static List<SubscriptionProfileProgress> LoadUnsafe()
    {
        if (!File.Exists(path))
            return new List<SubscriptionProfileProgress>();

        try
        {
            return JsonConvert.DeserializeObject<List<SubscriptionProfileProgress>>(File.ReadAllText(path))
                ?? new List<SubscriptionProfileProgress>();
        }
        catch
        {
            return new List<SubscriptionProfileProgress>();
        }
    }

    static void SaveUnsafe(List<SubscriptionProfileProgress> list)
    {
        string dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(dir))
            Directory.CreateDirectory(dir);

        string json = JsonConvert.SerializeObject(list ?? new List<SubscriptionProfileProgress>(), Formatting.Indented);
        string temp = path + ".tmp";

        File.WriteAllText(temp, json);
        File.Move(temp, path, true);
    }

    public static List<SubscriptionProfileProgress> Load(string uid, string profileId)
    {
        uid = (uid ?? string.Empty).Trim();
        profileId = NormalizeProfileId(profileId);

        if (string.IsNullOrWhiteSpace(uid))
            return new List<SubscriptionProfileProgress>();

        lock (locker)
        {
            return LoadUnsafe()
                .Where(x => x != null
                    && string.Equals(x.Uid, uid, StringComparison.Ordinal)
                    && string.Equals(NormalizeProfileId(x.ProfileId), profileId, StringComparison.Ordinal))
                .ToList();
        }
    }

    public static Dictionary<string, int> LoadWatchedBySubscription(string uid, string profileId)
    {
        return Load(uid, profileId)
            .Where(x => !string.IsNullOrWhiteSpace(x.SubscriptionId))
            .GroupBy(x => x.SubscriptionId, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => Math.Max(0, group.OrderByDescending(x => x.UpdatedAt).First().WatchedEpisode),
                StringComparer.Ordinal);
    }

    public static int Upsert(string uid, string profileId, IReadOnlyDictionary<string, int> watchedBySubscription)
    {
        uid = (uid ?? string.Empty).Trim();
        profileId = NormalizeProfileId(profileId);

        if (string.IsNullOrWhiteSpace(uid) || watchedBySubscription == null || watchedBySubscription.Count == 0)
            return 0;

        int changed = 0;
        bool touched = false;
        DateTime now = DateTime.Now;

        lock (locker)
        {
            var list = LoadUnsafe();

            foreach (var pair in watchedBySubscription)
            {
                string subscriptionId = (pair.Key ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(subscriptionId))
                    continue;

                int watched = Math.Max(0, pair.Value);
                var current = list.FirstOrDefault(x => x != null
                    && string.Equals(x.Uid, uid, StringComparison.Ordinal)
                    && string.Equals(NormalizeProfileId(x.ProfileId), profileId, StringComparison.Ordinal)
                    && string.Equals(x.SubscriptionId, subscriptionId, StringComparison.Ordinal));

                if (current == null)
                {
                    list.Add(new SubscriptionProfileProgress
                    {
                        Uid = uid,
                        ProfileId = profileId,
                        SubscriptionId = subscriptionId,
                        WatchedEpisode = watched,
                        UpdatedAt = now
                    });
                    touched = true;
                    if (watched > 0)
                        changed++;
                    continue;
                }

                if (current.WatchedEpisode == watched)
                    continue;

                current.WatchedEpisode = watched;
                current.UpdatedAt = now;
                touched = true;
                changed++;
            }

            if (touched)
                SaveUnsafe(list);
        }

        return changed;
    }

    public static void RemoveSubscription(string uid, string subscriptionId)
    {
        uid = (uid ?? string.Empty).Trim();
        subscriptionId = (subscriptionId ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(uid) || string.IsNullOrWhiteSpace(subscriptionId))
            return;

        lock (locker)
        {
            var list = LoadUnsafe();
            int removed = list.RemoveAll(x => x != null
                && string.Equals(x.Uid, uid, StringComparison.Ordinal)
                && string.Equals(x.SubscriptionId, subscriptionId, StringComparison.Ordinal));

            if (removed > 0)
                SaveUnsafe(list);
        }
    }
}
