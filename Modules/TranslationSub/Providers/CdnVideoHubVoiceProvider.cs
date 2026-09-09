using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TranslationSub.Models;
using TranslationSub.Services;

namespace TranslationSub.Providers;

public class CdnVideoHubVoiceProvider : IVoiceProvider
{
    public string Source => "cdnvideohub";
    public string Path => "/lite/cdnvideohub";

    public async Task<List<TranslationVariant>> GetVariants(VoiceProviderQuery query)
    {
        var result = new List<TranslationVariant>();

        if (query == null || query.KpId <= 0 || !LampacMetadataClient.IsSourceAvailable(Source))
            return result;

        try
        {
            string url = $"{Path}?kinopoisk_id={query.KpId}&origsource=true";
            var response = await LampacMetadataClient.GetAsync(url).ConfigureAwait(false);
            if (response?.IsSuccess != true || string.IsNullOrWhiteSpace(response.Body))
                return result;

            var root = JsonConvert.DeserializeObject<RootObject>(response.Body);
            if (root?.items == null || root.items.Length == 0)
                return result;

            if (!root.isSerial)
            {
                foreach (var item in root.items)
                {
                    string voice = GetVoice(item);
                    if (!string.IsNullOrWhiteSpace(voice))
                        result.Add(Create(voice, 0, new[] { 1 }));
                }

                return Distinct(result);
            }

            IEnumerable<Item> items = root.items;
            if (query.Season > 0)
                items = items.Where(x => x.season == query.Season);

            foreach (var group in items
                .Where(x => x != null && x.season > 0 && x.episode > 0)
                .GroupBy(x => new { x.season, voice = GetVoice(x) }))
            {
                if (string.IsNullOrWhiteSpace(group.Key.voice))
                    continue;

                var episodes = group
                    .Select(x => (int)x.episode)
                    .Where(e => e > 0)
                    .Distinct()
                    .OrderBy(e => e)
                    .ToList();

                if (episodes.Count > 0)
                    result.Add(Create(group.Key.voice, group.Key.season, episodes));
            }
        }
        catch { }

        return Distinct(result);
    }

    static string GetVoice(Item item)
        => !string.IsNullOrWhiteSpace(item?.voiceStudio) ? item.voiceStudio : item?.voiceType;

    TranslationVariant Create(string voice, int season, IEnumerable<int> episodes)
    {
        var available = (episodes ?? Array.Empty<int>())
            .Where(e => e > 0)
            .Distinct()
            .OrderBy(e => e)
            .ToList();

        return new TranslationVariant
        {
            source = Source,
            path = Path,
            translation = voice,
            translation_id = VoiceNormalize.Normalize(voice),
            season = season,
            episode = available.DefaultIfEmpty(0).Max(),
            Episodes = available
        };
    }

    static List<TranslationVariant> Distinct(List<TranslationVariant> values)
        => values
            .Where(x => x != null && !string.IsNullOrWhiteSpace(x.translation))
            .GroupBy(x => $"{x.season}:{VoiceNormalize.Normalize(x.translation)}", StringComparer.OrdinalIgnoreCase)
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

    class RootObject
    {
        public bool isSerial { get; set; }
        public Item[] items { get; set; }
    }

    class Item
    {
        public short season { get; set; }
        public short episode { get; set; }
        public string voiceStudio { get; set; }
        public string voiceType { get; set; }
    }
}
