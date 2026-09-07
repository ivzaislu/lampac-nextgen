using Newtonsoft.Json;
using Shared.Services;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TranslationSub.Models;

namespace TranslationSub.Providers;

public class FlixCdnVoiceProvider : IVoiceProvider
{
    public string Source => "flixcdn";
    public string Path => "/lite/flixcdn";

    public async Task<List<TranslationVariant>> GetVariants(VoiceProviderQuery query)
    {
        var result = new List<TranslationVariant>();

        if (ModInit.conf?.flixcdn != true || query.KpId <= 0)
            return result;

        try
        {
            string url = $"{ModInit.conf.flixcdn_host.TrimEnd('/')}/show/kinopoisk/{query.KpId}?extrans=1&extepi=1&unfseason=1";
            string html = await Http.Get(url, timeoutSeconds: 12);
            if (string.IsNullOrWhiteSpace(html))
                return result;

            const string marker = "window.__PLAYER_PAYLOAD__ = ";
            int start = html.IndexOf(marker, StringComparison.Ordinal);
            if (start < 0)
                return result;

            start += marker.Length;
            int end = html.IndexOf(';', start);
            if (end < 0)
                return result;

            string json = html.Substring(start, end - start).Trim();
            var player = JsonConvert.DeserializeObject<PlayerPayload>(json);
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
                    result.Add(Create(voice, 0, 1));

                return result;
            }

            IEnumerable<short> targetSeasons = query.Season > 0
                ? seasons.Keys.Where(s => s == query.Season)
                : seasons.Keys;

            foreach (short season in targetSeasons)
            {
                if (!seasons.TryGetValue(season, out var episodes) || episodes == null || episodes.Length == 0)
                    continue;

                foreach (var voice in voices)
                {
                    int count = AvailableEpisodeCount(seasons, voice, season);
                    if (count <= 0)
                        continue;

                    int latestEpisode = episodes.Take(count).DefaultIfEmpty(0).Max();
                    if (latestEpisode <= 0)
                        continue;

                    result.Add(Create(voice, season, latestEpisode));
                }
            }
        }
        catch { }

        return result;
    }

    TranslationVariant Create(PlayerTranslation voice, int season, int episode)
    {
        return new TranslationVariant
        {
            source = Source,
            path = Path,
            translation = voice.title,
            translation_id = voice.id.ToString(),
            season = season,
            episode = episode,
            quality = "1080p"
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

                var episodes = item.Value.Where(e => e > 0).ToArray();
                if (episodes.Length > 0)
                    seasons[season] = episodes;
            }
        }

        if (seasons.Count == 0 && player?.season > 0 && player.episodes?.Length > 0)
            seasons[player.season.Value] = player.episodes.Where(e => e > 0).ToArray();

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
