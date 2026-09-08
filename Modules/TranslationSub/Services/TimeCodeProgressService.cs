using Microsoft.Data.Sqlite;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using TranslationSub.Models;

namespace TranslationSub.Services;

/// <summary>
/// Reads the progress written by Lampac's TimeCode module (database/TimeCode.sql)
/// and reconciles TranslationSub subscriptions with that server-side source.
///
/// Lampa.Timeline is only a client-side trigger. The durable Lampac TimeCode
/// database is the authoritative source for watched progress.
/// </summary>
public static class TimeCodeProgressService
{
    const int WatchedPercent = 60;
    const int MaxEpisodeScan = 400;
    const string DatabasePath = "database/TimeCode.sql";

    sealed class TimeCodeRow
    {
        public string Card { get; init; }
        public int Percent { get; init; }
    }

    public static int SyncUser(string userKey, string requestUserUid, string profileId = null)
    {
        userKey = string.IsNullOrWhiteSpace(userKey) ? "local" : userKey;
        string timeCodeUser = BuildTimeCodeUserId(requestUserUid, profileId);

        if (string.IsNullOrWhiteSpace(timeCodeUser) || !File.Exists(DatabasePath))
            return 0;

        try
        {
            var subscriptions = SubscriptionStore.Load()
                .Where(x => x.IsSerial && x.UserKey == userKey)
                .ToList();

            if (subscriptions.Count == 0)
                return 0;

            var rows = LoadRows(timeCodeUser);
            if (rows.Count == 0)
                return 0;

            var watchedBySubscription = new Dictionary<string, int>(StringComparer.Ordinal);
            var progressCache = new Dictionary<string, int>(StringComparer.Ordinal);

            foreach (var sub in subscriptions)
            {
                if (string.IsNullOrWhiteSpace(sub.Id))
                    continue;

                int season = Math.Max(1, sub.CurrentSeason.GetValueOrDefault(1));
                string cacheKey = BuildProgressCacheKey(sub, season);

                if (!progressCache.TryGetValue(cacheKey, out int watched))
                {
                    watched = FindWatchedEpisode(sub, season, rows);
                    progressCache[cacheKey] = watched;
                }

                if (watched >= 0)
                    watchedBySubscription[sub.Id] = watched;
            }

            if (watchedBySubscription.Count == 0)
                return 0;

            int changed = 0;

            SubscriptionStore.Mutate(list =>
            {
                foreach (var item in list)
                {
                    if (item.UserKey != userKey || string.IsNullOrWhiteSpace(item.Id))
                        continue;

                    if (!watchedBySubscription.TryGetValue(item.Id, out int watched))
                        continue;

                    int previous = item.CurrentEpisode.GetValueOrDefault(0);
                    if (watched != previous)
                    {
                        item.CurrentEpisode = watched;
                        changed++;
                    }

                    // One invariant for every client: an update exists only while
                    // the selected voice has episodes beyond Lampac TimeCode progress.
                    item.Notified = item.LastEpisode.GetValueOrDefault(0) <= watched;
                }
            });

            return changed;
        }
        catch
        {
            // TimeCode may be disabled, being migrated, or momentarily locked.
            // Progress reconciliation is best-effort; never break subscriptions/API.
            return 0;
        }
    }

    public static string BuildTimeCodeUserId(string requestUserUid, string profileId = null)
    {
        string value = (requestUserUid ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        profileId = (profileId ?? string.Empty).Trim();
        if (!string.IsNullOrWhiteSpace(profileId) && profileId != "0")
            value += "_" + profileId;

        // Keep this identical to Modules/Sync/TimeCode/Controller.cs#getUserid.
        return Regex.Replace(value, "[^a-z0-9\\-_\\.]+", string.Empty, RegexOptions.IgnoreCase);
    }

    static Dictionary<string, List<TimeCodeRow>> LoadRows(string user)
    {
        var result = new Dictionary<string, List<TimeCodeRow>>(StringComparer.Ordinal);

        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = DatabasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Shared,
            DefaultTimeout = 2
        }.ToString();

        using var connection = new SqliteConnection(connectionString);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = "SELECT card, item, data FROM timecodes WHERE user = $user";
        command.Parameters.AddWithValue("$user", user);

        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            string item = reader.IsDBNull(1) ? null : reader.GetString(1);
            if (string.IsNullOrWhiteSpace(item))
                continue;

            string data = reader.IsDBNull(2) ? null : reader.GetString(2);
            int percent = ReadPercent(data);

            if (!result.TryGetValue(item, out var list))
            {
                list = new List<TimeCodeRow>();
                result[item] = list;
            }

            list.Add(new TimeCodeRow
            {
                Card = reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
                Percent = percent
            });
        }

        return result;
    }

    static int ReadPercent(string data)
    {
        if (string.IsNullOrWhiteSpace(data))
            return 0;

        try
        {
            var value = JObject.Parse(data);
            return Math.Max(0, Math.Min(100, value.Value<int?>("percent") ?? 0));
        }
        catch
        {
            return 0;
        }
    }

    static int FindWatchedEpisode(
        TranslationSubscription sub,
        int season,
        Dictionary<string, List<TimeCodeRow>> rows)
    {
        var titles = TitleCandidates(sub);
        if (titles.Count == 0)
            return -1;

        var cards = CardCandidates(sub);
        int scanTo = Math.Max(
            32,
            Math.Max(
                sub.CurrentEpisode.GetValueOrDefault(0) + 8,
                Math.Max(
                    sub.LastEpisode.GetValueOrDefault(0) + 8,
                    sub.TmdbTargetSeasonEpisodes.GetValueOrDefault(0) + 3
                )
            )
        );
        scanTo = Math.Min(MaxEpisodeScan, scanTo);

        int watched = 0;
        bool foundAnyTimelineRow = false;

        for (int episode = 1; episode <= scanTo; episode++)
        {
            bool episodeWatched = false;

            foreach (string title in titles)
            {
                string hash = LampaHash(BuildEpisodeHashInput(season, episode, title));
                if (!rows.TryGetValue(hash, out var matchingRows))
                    continue;

                foundAnyTimelineRow = true;

                bool exactWatched = matchingRows.Any(x =>
                    x.Percent >= WatchedPercent && cards.Contains(x.Card));

                // The TimeCode card key depends on the Lampa card source. If the user
                // watched the same TMDB show after switching TMDB/CUB, the episode hash
                // remains identical, so allow the hash as a source-independent fallback.
                bool hashWatched = matchingRows.Any(x => x.Percent >= WatchedPercent);
                if (exactWatched || hashWatched)
                {
                    episodeWatched = true;
                    break;
                }
            }

            if (episodeWatched)
                watched = episode;
        }

        return foundAnyTimelineRow ? watched : -1;
    }

    static HashSet<string> CardCandidates(TranslationSubscription sub)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        AddCard(result, sub.TmdbId);
        AddCard(result, sub.ContentId);
        AddCard(result, sub.KpId);

        return result;
    }

    static void AddCard(HashSet<string> result, string id)
    {
        id = (id ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(id))
            return;

        result.Add(id.EndsWith("_tv", StringComparison.OrdinalIgnoreCase) ? id : id + "_tv");
    }

    static List<string> TitleCandidates(TranslationSubscription sub)
    {
        var result = new List<string>(2);

        string original = (sub.OriginalTitle ?? string.Empty).Trim();
        string title = (sub.Title ?? string.Empty).Trim();

        if (!string.IsNullOrWhiteSpace(original))
            result.Add(original);

        if (!string.IsNullOrWhiteSpace(title)
            && !result.Contains(title, StringComparer.Ordinal))
            result.Add(title);

        return result;
    }

    static string BuildProgressCacheKey(TranslationSubscription sub, int season)
        => string.Join("|",
            sub.TmdbId ?? string.Empty,
            sub.ContentId ?? string.Empty,
            season.ToString(CultureInfo.InvariantCulture),
            sub.OriginalTitle ?? string.Empty,
            sub.Title ?? string.Empty);

    static string BuildEpisodeHashInput(int season, int episode, string title)
        => season.ToString(CultureInfo.InvariantCulture)
            + (season > 10 ? ":" : string.Empty)
            + episode.ToString(CultureInfo.InvariantCulture)
            + title;

    // Exact equivalent of Lampa.Utils.hash.
    static string LampaHash(string input)
    {
        input ??= string.Empty;
        int hash = 0;

        unchecked
        {
            foreach (char ch in input)
                hash = ((hash << 5) - hash) + ch;
        }

        long absolute = hash == int.MinValue ? 2147483648L : Math.Abs((long)hash);
        return absolute.ToString(CultureInfo.InvariantCulture);
    }
}
