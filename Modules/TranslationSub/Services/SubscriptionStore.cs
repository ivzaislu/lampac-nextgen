using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using TranslationSub.Models;

namespace TranslationSub.Services;

public static class SubscriptionStore
{
    static readonly object locker = new();
    static readonly AsyncLocal<MutationBatch> ambientBatch = new();
    static string path => "database/translationsub/subscriptions.json";

    sealed class MutationBatch
    {
        public int Depth { get; set; } = 1;
        public List<Action<List<TranslationSubscription>>> Operations { get; } = new();
    }

    sealed class MutationBatchScope : IDisposable
    {
        readonly MutationBatch batch;
        bool disposed;

        public MutationBatchScope(MutationBatch batch)
        {
            this.batch = batch;
        }

        public void Dispose()
        {
            if (disposed)
                return;
            disposed = true;

            if (batch == null || --batch.Depth > 0)
                return;

            ambientBatch.Value = null;
            FlushBatch(batch);
        }
    }

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

    static string PersistedState(IEnumerable<TranslationSubscription> list)
        => JsonConvert.SerializeObject(list ?? Enumerable.Empty<TranslationSubscription>(), Formatting.None);

    public static IDisposable BeginBatch()
    {
        var batch = ambientBatch.Value;
        if (batch != null)
        {
            batch.Depth++;
            return new MutationBatchScope(batch);
        }

        batch = new MutationBatch();
        ambientBatch.Value = batch;
        return new MutationBatchScope(batch);
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

        var batch = ambientBatch.Value;
        if (batch != null)
        {
            batch.Operations.Add(action);
            return;
        }

        string[] changedUids;
        lock (locker)
        {
            var list = LoadUnsafe();
            string beforePersisted = PersistedState(list);
            var beforeShared = SharedStateByUid(list);
            action(list);

            if (string.Equals(beforePersisted, PersistedState(list), StringComparison.Ordinal))
                return;

            var afterShared = SharedStateByUid(list);
            SaveUnsafe(list);
            changedUids = ChangedUids(beforeShared, afterShared);
        }

        PublishSharedChanges(changedUids);
    }

    public static bool MutateIfChanged(Func<List<TranslationSubscription>, bool> action)
    {
        if (action == null)
            return false;

        var batch = ambientBatch.Value;
        if (batch != null)
        {
            batch.Operations.Add(list => action(list));
            return true;
        }

        string[] changedUids;
        lock (locker)
        {
            var list = LoadUnsafe();
            string beforePersisted = PersistedState(list);
            var beforeShared = SharedStateByUid(list);
            if (!action(list))
                return false;

            if (string.Equals(beforePersisted, PersistedState(list), StringComparison.Ordinal))
                return false;

            var afterShared = SharedStateByUid(list);
            SaveUnsafe(list);
            changedUids = ChangedUids(beforeShared, afterShared);
        }

        PublishSharedChanges(changedUids);
        return true;
    }

    static void FlushBatch(MutationBatch batch)
    {
        if (batch?.Operations == null || batch.Operations.Count == 0)
            return;

        string[] changedUids;
        lock (locker)
        {
            var list = LoadUnsafe();
            string beforePersisted = PersistedState(list);
            var beforeShared = SharedStateByUid(list);

            foreach (var operation in batch.Operations)
            {
                try
                {
                    operation?.Invoke(list);
                }
                catch
                {
                    // Scheduler mutations are isolated per subscription. One stale
                    // or invalid operation must not discard the rest of the batch.
                }
            }

            if (string.Equals(beforePersisted, PersistedState(list), StringComparison.Ordinal))
                return;

            var afterShared = SharedStateByUid(list);
            SaveUnsafe(list);
            changedUids = ChangedUids(beforeShared, afterShared);
        }

        PublishSharedChanges(changedUids);
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
