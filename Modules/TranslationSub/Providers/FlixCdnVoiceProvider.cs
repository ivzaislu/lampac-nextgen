using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TranslationSub.Models;
using TranslationSub.Services;

namespace TranslationSub.Providers;

public class FlixCdnVoiceProvider : IVoiceProvider
{
    public string Source => "flixcdn";
    public string Path => "/lite/flixcdn";

    public async Task<List<TranslationVariant>> GetVariants(VoiceProviderQuery query)
    {
        var result = new List<TranslationVariant>();

        if (query == null || query.KpId <= 0 || !LampacMetadataClient.IsSourceAvailable(Source))
            return result;

        try
        {
            string url = $"{Path}?kinopoisk_id={query.KpId}&origsource=true";
            var response = await LampacMetadataClient.GetAsync(url, query.Uid).ConfigureAwait(false);
            if (response?.IsSuccess != true || string.IsNullOrWhiteSpace(response.Body))
                return result;

            var player = JsonConvert.DeserializeObject<PlayerPayload>(response.Body);
            if (player == null || player.id <= 0)
                return result;

            var voices = player.translations?
                .Where(v => v != null && v.id > 0 && !string.IsNullOrWhiteSpace(v.title))
                .GroupBy(v => v.id)
                .Select(g => g.First())
                .ToList() ?? new List<PlayerTranslation>();

            var seasons = GetSeasons(player);

            if (player.translate > 0 && !voices.Any(v => v.id == player.translate))
            {
                voices.Insert(0, new PlayerTranslation
                {
                    id = player.translate,
                    title = string.IsNullOrWhiteSpace(player.translateTitle) ? "Перевод" : player.translateTitle,
                    episodes_qty = TotalEpisodes(seasons)
                });
            }

            if (!player.is_serial)
            {
                foreach (var voice in voices)
                    result.Add(Create(voice, 0, new[] { 1 }));

                return result;
            }

            IEnumerable<short> targetSeasons = query.Season > 0
                ? seasons.Keys.Where(s => s == query.Season)
                : seasons.Keys;

            foreach (short season in targetSeasons)
            {
                if (!seasons.TryGetValue(season, out var seasonEpisodes) || seasonEpisodes == null || seasonEpisodes.Length == 0)
                    continue;

                foreach (var voice in voices)
                {
                    int count = AvailableEpisodeCount(seasons, voice, season);
                    if (count <= 0)
                        continue;

                    var episodes = seasonEpisodes
                        .Take(count)
                        .Where(e => e > 0)
                        .Distinct()
                        .OrderBy(e => e)
                        .ToList();

                    if (episodes.Count > 0)
                        result.Add(Create(voice, season, episodes));
                }
            }
        }
        catch { }

        return result;
    }

    TranslationVariant Create(PlayerTranslation voice, int season, IEnumerable<int> episodes)
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
            translation = voice.title,
            translation_id = voice.id.ToString(),
            season = season,
            episode = available.DefaultIfEmpty(0).Max(),
            Episodes = available
        };
    }

    static SortedDictionary<short, int[]> GetSeasons(PlayerPayload player)
    {
        var seasons = new SortedDictionary<short, int[]>();

        if (player?.seasons_episodes != null)
        {
            foreach (var item in player.seasons_episodes)
            {
                if (!short.TryParse(item.Key, out short season) || season <= 0 || item.Value == null)
                    continue;

                var episodes = item.Value.Where(e => e > 0).Distinct().OrderBy(e => e).ToArray();
                if (episodes.Length > 0)
                    seasons[season] = episodes;
            }
        }

        if (seasons.Count == 0 && player?.season > 0 && player.episodes?.Length > 0)
            seasons[player.season.Value] = player.episodes.Where(e => e > 0).Distinct().OrderBy(e => e).ToArray();

        return seasons;
    }

    static int AvailableEpisodeCount(SortedDictionary<short, int[]> seasons, PlayerTranslation voice, short targetSeason)
    {
        if (voice == null || !seasons.TryGetValue(targetSeason, out var targetEpisodes))
            return 0;

        int totalAvailable = voice.episodes_qty > 0 ? voice.episodes_qty : TotalEpisodes(seasons);

        foreach (var season in seasons)
        {
            if (season.Key == targetSeason)
                return Math.Min(Math.Max(totalAvailable, 0), targetEpisodes.Length);

            totalAvailable -= season.Value?.Length ?? 0;
        }

        return 0;
    }

    static int TotalEpisodes(SortedDictionary<short, int[]> seasons)
        => seasons.Sum(s => s.Value?.Length ?? 0);

    class PlayerPayload
    {
        public int id { get; set; }
        public bool is_serial { get; set; }
        public int translate { get; set; }
        public string translateTitle { get; set; }
        public short? season { get; set; }
        public int[] episodes { get; set; }
        public Dictionary<string, int[]> seasons_episodes { get; set; }
        public List<PlayerTranslation> translations { get; set; }
    }

    class PlayerTranslation
    {
        public int id { get; set; }
        public string title { get; set; }
        public int episodes_qty { get; set; }
    }
}
