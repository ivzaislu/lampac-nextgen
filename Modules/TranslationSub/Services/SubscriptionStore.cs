using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using TranslationSub.Models;

namespace TranslationSub.Services;

public static class SubscriptionStore
{
    static readonly object locker = new();
    static string path => "database/translationsub/subscriptions.json";

    static List<TranslationSubscription> LoadUnsafe()
    {
        if (!File.Exists(path))
            return new List<TranslationSubscription>();

        try
        {
            return JsonConvert.DeserializeObject<List<TranslationSubscription>>(File.ReadAllText(path))
                ?? new List<TranslationSubscription>();
        }
        catch
        {
            return new List<TranslationSubscription>();
        }
    }

    static void SaveUnsafe(List<TranslationSubscription> list)
    {
        string dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(dir))
            Directory.CreateDirectory(dir);

        string json = JsonConvert.SerializeObject(list ?? new List<TranslationSubscription>(), Formatting.Indented);
        string temp = path + ".tmp";

        File.WriteAllText(temp, json);
        File.Move(temp, path, true);
    }

    public static List<TranslationSubscription> Load()
    {
        lock (locker)
            return LoadUnsafe();
    }

    public static void Mutate(Action<List<TranslationSubscription>> action)
    {
        if (action == null)
            return;

        string[] changedUids;
        lock (locker)
        {
            var list = LoadUnsafe();
            var before = SharedStateByUid(list);
            action(list);
            var after = SharedStateByUid(list);
            SaveUnsafe(list);
            changedUids = ChangedUids(before, after);
        }

        PublishSharedChanges(changedUids);
    }

    public static bool MutateIfChanged(Func<List<TranslationSubscription>, bool> action)
    {
        if (action == null)
            return false;

        string[] changedUids;
        lock (locker)
        {
            var list = LoadUnsafe();
            var before = SharedStateByUid(list);
            if (!action(list))
                return false;

            var after = SharedStateByUid(list);
            SaveUnsafe(list);
            changedUids = ChangedUids(before, after);
        }

        PublishSharedChanges(changedUids);
        return true;
    }

    static Dictionary<string, string> SharedStateByUid(IEnumerable<TranslationSubscription> list)
    {
        return (list ?? Enumerable.Empty<TranslationSubscription>())
            .Where(x => x != null && !string.IsNullOrWhiteSpace(x.Uid))
            .GroupBy(x => x.Uid.Trim(), StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => JsonConvert.SerializeObject(group
                    .OrderBy(x => x.Id, StringComparer.Ordinal)
                    .Select(x => new
                    {
                        x.Id,
                        x.ContentId,
                        x.Title,
                        x.OriginalTitle,
                        x.KpId,
                        x.ImdbId,
                        x.TmdbId,
                        x.Poster,
                        x.Year,
                        x.IsSerial,
                        x.Source,
                        x.TranslationId,
                        x.TranslationName,
                        x.CurrentSeason,
                        x.LastSeason,
                        x.LastEpisode,
                        Sources = (x.Sources ?? new List<TranslationSubscriptionSource>())
                            .Where(source => source != null)
                            .OrderBy(source => source.Source, StringComparer.OrdinalIgnoreCase)
                            .ThenBy(source => source.TranslationId, StringComparer.Ordinal)
                            .Select(source => new
                            {
                                source.Source,
                                source.TranslationId,
                                source.TranslationName
                            }),
                        x.TmdbStatus,
                        x.TmdbLastSeason,
                        x.TmdbLastEpisode,
                        x.TmdbLastAirDate,
                        x.TmdbNextSeason,
                        x.TmdbNextEpisode,
                        x.TmdbNextAirDate,
                        x.TmdbTargetSeasonEpisodes,
                        x.ScheduleState,
                        x.TmdbNewSeasonAvailable
                    })),
                StringComparer.Ordinal);
    }

    static string[] ChangedUids(
        IReadOnlyDictionary<string, string> before,
        IReadOnlyDictionary<string, string> after)
    {
        var keys = new HashSet<string>(before.Keys, StringComparer.Ordinal);
        keys.UnionWith(after.Keys);

        return keys
            .Where(uid => !before.TryGetValue(uid, out string oldState)
                || !after.TryGetValue(uid, out string newState)
                || !string.Equals(oldState, newState, StringComparison.Ordinal))
            .ToArray();
    }

    static void PublishSharedChanges(IEnumerable<string> uids)
    {
        foreach (string uid in uids ?? Enumerable.Empty<string>())
            _ = TranslationSubRealtimeService.PublishUid(uid, "subscription");
    }
}
