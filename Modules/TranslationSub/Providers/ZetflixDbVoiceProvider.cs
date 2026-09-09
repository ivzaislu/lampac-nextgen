using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using TranslationSub.Models;
using TranslationSub.Services;

namespace TranslationSub.Providers;

public class ZetflixDbVoiceProvider : IVoiceProvider
{
    public string Source => "zetflixdb";
    public string Path => "/lite/zetflixdb";

    public async Task<List<TranslationVariant>> GetVariants(VoiceProviderQuery query)
    {
        var result = new List<TranslationVariant>();

        if (query == null || query.KpId <= 0 || !LampacMetadataClient.IsSourceAvailable(Source))
            return result;

        try
        {
            string firstUrl = $"{Path}?kinopoisk_id={query.KpId}"
                + $"&title={LampacMetadataClient.Encode(query.Title)}"
                + $"&original_title={LampacMetadataClient.Encode(query.OriginalTitle)}";

            var redirect = await LampacMetadataClient.GetAsync(firstUrl).ConfigureAwait(false);
            if (redirect?.IsRedirect != true)
                return result;

            string metadataUrl = LampacMetadataClient.AppendQuery(redirect.Location, "origsource", "true");
            var response = await LampacMetadataClient.GetAsync(metadataUrl).ConfigureAwait(false);
            if (response?.IsSuccess != true || string.IsNullOrWhiteSpace(response.Body))
                return result;

            var root = JsonConvert.DeserializeObject<EmbedModel>(response.Body);
            if (root?.pl == null || root.pl.Length == 0)
                return result;

            if (root.movie)
            {
                foreach (var item in root.pl)
                {
                    if (!string.IsNullOrWhiteSpace(item?.title))
                        result.Add(Create(item.title, 0, new[] { 1 }));
                }

                return Distinct(result);
            }

            foreach (var seasonNode in root.pl)
            {
                int season = ParseLeadingNumber(seasonNode?.title);
                if (season <= 0 || (query.Season > 0 && season != query.Season) || seasonNode?.folder == null)
                    continue;

                var byVoice = new Dictionary<string, HashSet<int>>(StringComparer.OrdinalIgnoreCase);

                foreach (var episodeNode in seasonNode.folder)
                {
                    int episode = ParseLeadingNumber(episodeNode?.title);
                    if (episode <= 0 || episodeNode?.folder == null)
                        continue;

                    foreach (var voiceNode in episodeNode.folder)
                    {
                        string voice = NormalizeVoiceTitle(voiceNode?.title);
                        if (string.IsNullOrWhiteSpace(voice))
                            continue;

                        if (!byVoice.TryGetValue(voice, out var episodes))
                        {
                            episodes = new HashSet<int>();
                            byVoice[voice] = episodes;
                        }

                        episodes.Add(episode);
                    }
                }

                foreach (var voice in byVoice)
                    result.Add(Create(voice.Key, season, voice.Value));
            }
        }
        catch { }

        return Distinct(result);
    }

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
            .GroupBy(x => $"{x.season}:{VoiceNormalize.Normalize(x.translation)}")
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

    static string NormalizeVoiceTitle(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        return Regex.Replace(value, "^[a-zA-Z]{3} \\| ", "").Trim();
    }

    static int ParseLeadingNumber(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return 0;

        return int.TryParse(Regex.Match(value, "^([0-9]+)").Groups[1].Value, out int n) ? n : 0;
    }

    class EmbedModel
    {
        public RootObject[] pl { get; set; }
        public bool movie { get; set; }
    }

    class RootObject
    {
        public string title { get; set; }
        public Folder[] folder { get; set; }
    }

    class Folder
    {
        public string title { get; set; }
        public Folder[] folder { get; set; }
    }
}
