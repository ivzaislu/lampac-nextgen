using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using TranslationSub.Models;
using TranslationSub.Services;

namespace TranslationSub.Providers;

public class PhantomVoiceProvider : IVoiceProvider
{
    public string Source => "phantom";
    public string Path => "/lite/phantom";

    public async Task<List<TranslationVariant>> GetVariants(VoiceProviderQuery query)
    {
        var result = new List<TranslationVariant>();

        if (query == null || !LampacMetadataClient.IsSourceAvailable(Source))
            return result;

        try
        {
            if (!query.IsSerial)
            {
                var movie = await LampacMetadataClient.GetAsync(BuildUrl(query, -1), query.Uid).ConfigureAwait(false);
                if (movie?.IsSuccess == true)
                    CollectMovie(movie.Body, result);

                return Distinct(result);
            }

            if (query.Season > 0)
            {
                var seasonResponse = await LampacMetadataClient.GetAsync(BuildUrl(query, query.Season), query.Uid).ConfigureAwait(false);
                if (seasonResponse?.IsSuccess == true)
                    await CollectSeason(seasonResponse.Body, query.Season, query.Uid, result).ConfigureAwait(false);

                return Distinct(result);
            }

            var seasonsResponse = await LampacMetadataClient.GetAsync(BuildUrl(query, -1), query.Uid).ConfigureAwait(false);
            if (seasonsResponse?.IsSuccess != true || string.IsNullOrWhiteSpace(seasonsResponse.Body))
                return result;

            var seasonsRoot = JObject.Parse(seasonsResponse.Body);
            if (seasonsRoot["data"] is not JArray seasons)
                return result;

            foreach (var item in seasons)
            {
                int season = item?.Value<int?>("id") ?? 0;
                string url = item?.Value<string>("url");
                if (season <= 0 || string.IsNullOrWhiteSpace(url))
                    continue;

                url = LampacMetadataClient.AppendQuery(url, "serial", "1");
                var seasonResponse = await LampacMetadataClient.GetAsync(url, query.Uid).ConfigureAwait(false);
                if (seasonResponse?.IsSuccess == true)
                    await CollectSeason(seasonResponse.Body, season, query.Uid, result).ConfigureAwait(false);
            }
        }
        catch { }

        return Distinct(result);
    }

    string BuildUrl(VoiceProviderQuery query, int season)
    {
        return $"{Path}?rjson=true"
            + $"&kinopoisk_id={query.KpId}"
            + $"&imdb_id={LampacMetadataClient.Encode(query.ImdbId)}"
            + $"&title={LampacMetadataClient.Encode(query.Title)}"
            + $"&original_title={LampacMetadataClient.Encode(query.OriginalTitle)}"
            + $"&year={query.Year}"
            + $"&serial={(query.IsSerial ? 1 : 0)}"
            + $"&s={season}";
    }

    async Task CollectSeason(string json, int season, string uid, List<TranslationVariant> result)
    {
        if (string.IsNullOrWhiteSpace(json) || season <= 0)
            return;

        JObject root;
        try { root = JObject.Parse(json); }
        catch { return; }

        if (root["voice"] is not JArray voices || voices.Count == 0)
            return;

        var currentEpisodes = ReadEpisodes(root["data"] as JArray, season);

        foreach (var voice in voices)
        {
            string name = voice?.Value<string>("name");
            string url = voice?.Value<string>("url");
            bool active = voice?.Value<bool?>("active") == true;
            if (string.IsNullOrWhiteSpace(name))
                continue;

            List<int> episodes = active ? currentEpisodes : null;

            if ((episodes == null || episodes.Count == 0) && !string.IsNullOrWhiteSpace(url))
            {
                string voiceUrl = LampacMetadataClient.AppendQuery(url, "serial", "1");
                var voiceResponse = await LampacMetadataClient.GetAsync(voiceUrl, uid).ConfigureAwait(false);
                if (voiceResponse?.IsSuccess == true && !string.IsNullOrWhiteSpace(voiceResponse.Body))
                {
                    try
                    {
                        var voiceRoot = JObject.Parse(voiceResponse.Body);
                        episodes = ReadEpisodes(voiceRoot["data"] as JArray, season);
                    }
                    catch { }
                }
            }

            if (episodes == null || episodes.Count == 0)
                continue;

            string translationId = QueryValue(url, "t");
            if (string.IsNullOrWhiteSpace(translationId))
                translationId = VoiceNormalize.Normalize(name);

            result.Add(new TranslationVariant
            {
                source = Source,
                path = Path,
                translation = name,
                translation_id = translationId,
                season = season,
                episode = episodes.Max(),
                Episodes = episodes
            });
        }
    }

    void CollectMovie(string json, List<TranslationVariant> result)
    {
        if (string.IsNullOrWhiteSpace(json))
            return;

        try
        {
            var root = JObject.Parse(json);
            if (root["data"] is not JArray items)
                return;

            foreach (var item in items)
            {
                string voice = item?.Value<string>("translate");
                if (string.IsNullOrWhiteSpace(voice))
                    continue;

                result.Add(new TranslationVariant
                {
                    source = Source,
                    path = Path,
                    translation = voice,
                    translation_id = VoiceNormalize.Normalize(voice),
                    season = 0,
                    episode = 1,
                    Episodes = new List<int> { 1 }
                });
            }
        }
        catch { }
    }

    static List<int> ReadEpisodes(JArray data, int targetSeason)
    {
        if (data == null)
            return new List<int>();

        return data
            .Where(x => x != null)
            .Where(x =>
            {
                int s = x.Value<int?>("s") ?? targetSeason;
                return s <= 0 || s == targetSeason;
            })
            .Select(x => x.Value<int?>("e") ?? 0)
            .Where(e => e > 0)
            .Distinct()
            .OrderBy(e => e)
            .ToList();
    }

    static string QueryValue(string url, string key)
    {
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(key))
            return null;

        var match = Regex.Match(url, $"(?:[?&]){Regex.Escape(key)}=([^&#]+)", RegexOptions.IgnoreCase);
        if (!match.Success)
            return null;

        try { return Uri.UnescapeDataString(match.Groups[1].Value.Replace("+", " ")); }
        catch { return match.Groups[1].Value; }
    }

    static List<TranslationVariant> Distinct(List<TranslationVariant> values)
        => values
            .Where(x => x != null && !string.IsNullOrWhiteSpace(x.translation))
            .GroupBy(x => $"{x.season}:{x.translation_id}:{VoiceNormalize.Normalize(x.translation)}")
            .Select(g =>
            {
                var best = g.OrderByDescending(x => x.episode).First();
                best.Episodes = g
                    .SelectMany(x => x.Episodes ?? new List<int>())
                    .Where(e => e > 0)
                    .Distinct()
                    .OrderBy(e => e)
                    .ToList();
                best.episode = best.Episodes.DefaultIfEmpty(best.episode).Max();
                return best;
            })
            .OrderBy(x => x.season)
            .ThenBy(x => x.translation)
            .ToList();
}
