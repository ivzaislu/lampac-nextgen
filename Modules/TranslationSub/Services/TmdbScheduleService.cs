using Newtonsoft.Json.Linq;
using Shared.Services;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;

namespace TranslationSub.Services;

public class TmdbScheduleSnapshot
{
    public string TmdbId { get; set; }
    public string Status { get; set; }
    public bool InProduction { get; set; }
    public int NumberOfSeasons { get; set; }
    public int LastSeason { get; set; }
    public int LastEpisode { get; set; }
    public DateTime? LastAirDate { get; set; }
    public int NextSeason { get; set; }
    public int NextEpisode { get; set; }
    public DateTime? NextAirDate { get; set; }
    public DateTime SyncedAt { get; set; } = DateTime.Now;
    public Dictionary<int, int> SeasonEpisodeCounts { get; set; } = new();

    public bool IsEnded
        => string.Equals(Status, "Ended", StringComparison.OrdinalIgnoreCase)
        || string.Equals(Status, "Canceled", StringComparison.OrdinalIgnoreCase)
        || string.Equals(Status, "Cancelled", StringComparison.OrdinalIgnoreCase);

    public int ExpectedAiredEpisode(int season, DateTime now)
    {
        if (season <= 0)
            return 0;

        int dueNext = 0;
        if (NextSeason == season && NextAirDate.HasValue && NextAirDate.Value.Date <= now.Date)
            dueNext = Math.Max(1, NextEpisode);

        if (LastSeason > season)
            return SeasonEpisodeCounts.TryGetValue(season, out int count) ? Math.Max(0, count) : dueNext;

        if (LastSeason == season)
            return Math.Max(Math.Max(0, LastEpisode), dueNext);

        return dueNext;
    }
}

public static class TmdbScheduleService
{
    static readonly object cacheLock = new();
    static readonly Dictionary<string, (TmdbScheduleSnapshot value, DateTime fetchedAt)> cache = new(StringComparer.OrdinalIgnoreCase);
    static readonly TimeSpan cacheLifetime = TimeSpan.FromMinutes(30);

    public static async Task<TmdbScheduleSnapshot> Get(string tmdbId)
    {
        if (string.IsNullOrWhiteSpace(tmdbId))
            return null;

        if (!long.TryParse(tmdbId, out long id) || id <= 0)
            return null;

        string normalizedId = id.ToString();
        lock (cacheLock)
        {
            if (cache.TryGetValue(normalizedId, out var cached)
                && DateTime.Now - cached.fetchedAt < cacheLifetime)
                return cached.value;
        }

        string host = (ModInit.conf?.tmdb_apihost ?? "https://api.themoviedb.org/3").TrimEnd('/');
        string key = ModInit.conf?.tmdb_apikey;
        if (string.IsNullOrWhiteSpace(key))
            return null;

        try
        {
            string url = $"{host}/tv/{id}?api_key={Uri.EscapeDataString(key)}&language=ru-RU";
            string json = await Http.Get(url, timeoutSeconds: 12).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(json))
                return null;

            var root = JObject.Parse(json);
            var result = new TmdbScheduleSnapshot
            {
                TmdbId = normalizedId,
                Status = root.Value<string>("status") ?? string.Empty,
                InProduction = root.Value<bool?>("in_production") ?? false,
                NumberOfSeasons = root.Value<int?>("number_of_seasons") ?? 0,
                SyncedAt = DateTime.Now
            };

            var last = root["last_episode_to_air"] as JObject;
            if (last != null)
            {
                result.LastSeason = last.Value<int?>("season_number") ?? 0;
                result.LastEpisode = last.Value<int?>("episode_number") ?? 0;
                result.LastAirDate = ParseDate(last.Value<string>("air_date"));
            }
            else
            {
                result.LastAirDate = ParseDate(root.Value<string>("last_air_date"));
            }

            var next = root["next_episode_to_air"] as JObject;
            if (next != null)
            {
                result.NextSeason = next.Value<int?>("season_number") ?? 0;
                result.NextEpisode = next.Value<int?>("episode_number") ?? 0;
                result.NextAirDate = ParseDate(next.Value<string>("air_date"));
            }

            var seasons = root["seasons"] as JArray;
            if (seasons != null)
            {
                foreach (var token in seasons)
                {
                    var season = token as JObject;
                    if (season == null)
                        continue;

                    int number = season.Value<int?>("season_number") ?? 0;
                    int count = season.Value<int?>("episode_count") ?? 0;
                    if (number > 0 && count >= 0)
                        result.SeasonEpisodeCounts[number] = count;
                }
            }

            lock (cacheLock)
                cache[normalizedId] = (result, DateTime.Now);

            return result;
        }
        catch
        {
            return null;
        }
    }

    static DateTime? ParseDate(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        if (DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.AllowWhiteSpaces, out DateTime exact))
            return exact.Date;

        if (DateTime.TryParse(value, CultureInfo.InvariantCulture,
            DateTimeStyles.AllowWhiteSpaces, out DateTime parsed))
            return parsed.Date;

        return null;
    }
}
