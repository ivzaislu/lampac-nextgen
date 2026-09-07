using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared.Models.Base;
using Shared.Services;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;
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

        if (ModInit.conf?.phantom != true)
            return result;

        string tokenMovie = await FindTokenMovie(query);
        if (string.IsNullOrWhiteSpace(tokenMovie))
            return result;

        JToken all = await GetFileList(tokenMovie);
        if (all == null)
            return result;

        if (!query.IsSerial)
        {
            JToken theatrical = all["theatrical"] ?? all;
            CollectAnyVoices(theatrical, result, 0, 1);
        }
        else
        {
            IEnumerable<int> seasons = query.Season > 0
                ? new[] { query.Season }
                : GetSeasons(all);

            foreach (int season in seasons.Distinct().Where(s => s > 0).OrderBy(s => s))
                ExtractSeason(all, result, season);
        }

        return result
            .Where(x => !string.IsNullOrWhiteSpace(x.translation))
            .Where(x => !query.IsSerial || query.Season <= 0 || x.season == query.Season)
            .GroupBy(x => $"{x.season}:{x.translation_id}:{VoiceNormalize.Normalize(x.translation)}")
            .Select(g => g.OrderByDescending(x => x.episode).First())
            .OrderBy(x => x.season)
            .ThenBy(x => x.translation)
            .ToList();
    }

    async Task<string> FindTokenMovie(VoiceProviderQuery query)
    {
        string apihost = ModInit.conf.phantom_apihost.TrimEnd('/');
        string token = ModInit.conf.phantom_token;

        if (query.KpId > 0 || !string.IsNullOrWhiteSpace(query.ImdbId))
        {
            try
            {
                string url = $"{apihost}/?token={token}&kp={query.KpId}&imdb={HttpUtility.UrlEncode(query.ImdbId)}";
                string json = await Http.Get(url, timeoutSeconds: 12, httpversion: 2);
                var root = string.IsNullOrWhiteSpace(json) ? null : JsonConvert.DeserializeObject<JObject>(json);
                string tokenMovie = root?["data"]?.Value<string>("token_movie");
                if (!string.IsNullOrWhiteSpace(tokenMovie))
                    return tokenMovie;
            }
            catch { }
        }

        string title = !string.IsNullOrWhiteSpace(query.Title) ? query.Title : query.OriginalTitle;
        if (string.IsNullOrWhiteSpace(title))
            return null;

        try
        {
            string url = $"{apihost}/?token={token}&name={HttpUtility.UrlEncode(title)}&list={(query.IsSerial ? "serial" : "movie")}";
            string json = await Http.Get(url, timeoutSeconds: 12, httpversion: 2);
            var root = string.IsNullOrWhiteSpace(json) ? null : JsonConvert.DeserializeObject<JObject>(json);

            var items = root?["data"] as JArray;
            if (items == null)
                return null;

            string expected = NormalizeTitle(title);
            JToken best = null;

            foreach (var item in items)
            {
                string name = item.Value<string>("name");
                string original = item.Value<string>("original_name");
                bool titleMatch = NormalizeTitle(name) == expected || NormalizeTitle(original) == expected;
                if (!titleMatch)
                    continue;

                int itemYear = item.Value<int?>("year") ?? 0;
                if (query.Year > 0 && itemYear > 0 && Math.Abs(itemYear - query.Year) > 1)
                    continue;

                best = item;
                break;
            }

            best ??= items.FirstOrDefault(x =>
            {
                int itemYear = x.Value<int?>("year") ?? 0;
                return query.Year <= 0 || itemYear <= 0 || Math.Abs(itemYear - query.Year) <= 1;
            });

            return best?.Value<string>("token_movie");
        }
        catch
        {
            return null;
        }
    }

    async Task<JToken> GetFileList(string tokenMovie)
    {
        try
        {
            string url = $"{ModInit.conf.phantom_linkhost.TrimEnd('/')}/?token_movie={HttpUtility.UrlEncode(tokenMovie)}&token={ModInit.conf.phantom_token}";
            string html = await Http.Get(url,
                referer: "https://kinogo-go.tv/",
                timeoutSeconds: 15,
                headers: HeadersModel.Init(
                    ("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"),
                    ("sec-fetch-dest", "iframe"),
                    ("sec-fetch-mode", "navigate"),
                    ("sec-fetch-site", "cross-site"),
                    ("upgrade-insecure-requests", "1")
                ),
                httpversion: 2);

            if (string.IsNullOrWhiteSpace(html))
                return null;

            string raw = Regex.Match(html, "fileList = JSON.parse\\('([^\\n\\r]+)'\\);").Groups[1].Value;
            if (string.IsNullOrWhiteSpace(raw))
                return null;

            var root = JsonConvert.DeserializeObject<JObject>(raw);
            return root?["all"];
        }
        catch
        {
            return null;
        }
    }

    void ExtractSeason(JToken all, List<TranslationVariant> result, int season)
    {
        if (all == null || season <= 0)
            return;

        string key = season.ToString();
        bool found = false;

        // Основной формат Phantom: all[season] -> episodes -> voices.
        if (all[key] != null)
        {
            CollectSeasonNode(all[key], result, season);
            found = true;
        }

        // В некоторых ответах сезоны лежат под all.seasons.
        if (all["seasons"]?[key] != null)
        {
            CollectSeasonNode(all["seasons"][key], result, season);
            found = true;
        }

        // Translation-first формат: t... -> file -> season -> episodes.
        if (all is JObject obj)
        {
            foreach (var translation in obj.Properties())
            {
                JToken seasonNode = translation.Value?["file"]?[key];
                if (seasonNode == null)
                    continue;

                CollectSeasonNode(seasonNode, result, season);
                found = true;
            }
        }

        // Безопасный fallback: берём только объекты, где season указан явно.
        if (!found)
            CollectExplicitSeasonVoices(all, result, season);
    }

    void CollectSeasonNode(JToken node, List<TranslationVariant> result, int season)
    {
        if (node == null)
            return;

        if (node is JArray arr)
        {
            for (int i = 0; i < arr.Count; i++)
            {
                // В массивном формате номер серии обычно есть внутри voice. Если его нет,
                // индекс массива является единственным безопасным fallback на уровне серии.
                CollectEpisodeContainer(arr[i], result, season, i + 1);
            }
            return;
        }

        if (node is JObject obj)
        {
            if (obj["translation"] != null)
            {
                int episode = obj.Value<int?>("episode") ?? 0;
                AddVariant(obj, result, season, episode);
                return;
            }

            // Здесь числовой ключ действительно является ключом СЕРИИ,
            // потому что мы уже находимся внутри конкретного сезона.
            foreach (var episodeNode in obj.Properties())
            {
                int episode = int.TryParse(episodeNode.Name, out int parsed) && parsed > 0 ? parsed : 0;
                CollectEpisodeContainer(episodeNode.Value, result, season, episode);
            }
        }
    }

    void CollectEpisodeContainer(JToken node, List<TranslationVariant> result, int season, int episodeHint)
    {
        if (node == null)
            return;

        if (node is JObject obj)
        {
            if (obj["translation"] != null)
            {
                int episode = obj.Value<int?>("episode") ?? episodeHint;
                AddVariant(obj, result, season, episode);
                return;
            }

            // Ниже уровня серии числовые ключи могут быть ID озвучки/файла,
            // поэтому НЕ используем их как episodeHint.
            foreach (var child in obj.Properties())
                CollectEpisodeContainer(child.Value, result, season, episodeHint);
        }
        else if (node is JArray arr)
        {
            foreach (var child in arr)
                CollectEpisodeContainer(child, result, season, episodeHint);
        }
    }

    void CollectExplicitSeasonVoices(JToken node, List<TranslationVariant> result, int targetSeason)
    {
        if (node == null)
            return;

        if (node is JObject obj)
        {
            if (obj["translation"] != null)
            {
                int objectSeason = obj.Value<int?>("season") ?? 0;
                if (objectSeason == targetSeason)
                {
                    int episode = obj.Value<int?>("episode") ?? 0;
                    AddVariant(obj, result, targetSeason, episode);
                }
                return;
            }

            foreach (var child in obj.Properties())
                CollectExplicitSeasonVoices(child.Value, result, targetSeason);
        }
        else if (node is JArray arr)
        {
            foreach (var child in arr)
                CollectExplicitSeasonVoices(child, result, targetSeason);
        }
    }

    void CollectAnyVoices(JToken node, List<TranslationVariant> result, int season, int episodeHint)
    {
        if (node == null)
            return;

        if (node is JObject obj)
        {
            if (obj["translation"] != null)
            {
                int episode = obj.Value<int?>("episode") ?? episodeHint;
                AddVariant(obj, result, season, episode);
                return;
            }

            foreach (var child in obj.Properties())
                CollectAnyVoices(child.Value, result, season, episodeHint);
        }
        else if (node is JArray arr)
        {
            foreach (var child in arr)
                CollectAnyVoices(child, result, season, episodeHint);
        }
    }

    IEnumerable<int> GetSeasons(JToken all)
    {
        var seasons = new HashSet<int>();

        if (all is not JObject obj)
            return seasons;

        // Такой же выбор структуры, как в штатном PhantomController.
        if (obj["seasons"] is JObject seasonsObj)
        {
            foreach (var season in seasonsObj.Properties())
                if (int.TryParse(season.Name, out int n) && n > 0)
                    seasons.Add(n);

            if (seasons.Count > 0)
                return seasons;
        }

        var first = obj.Properties().FirstOrDefault();
        bool translationFirst = first != null && first.Name.StartsWith("t", StringComparison.OrdinalIgnoreCase);

        if (translationFirst)
        {
            foreach (var translation in obj.Properties())
            {
                if (translation.Value?["file"] is not JObject file)
                    continue;

                foreach (var season in file.Properties())
                    if (int.TryParse(season.Name, out int n) && n > 0)
                        seasons.Add(n);
            }
        }
        else
        {
            foreach (var season in obj.Properties())
                if (int.TryParse(season.Name, out int n) && n > 0)
                    seasons.Add(n);
        }

        return seasons;
    }

    void AddVariant(JToken voice, List<TranslationVariant> result, int season, int episode)
    {
        string name = voice.Value<string>("translation");
        if (string.IsNullOrWhiteSpace(name))
            return;

        int translationId = voice.Value<int?>("id_translation") ?? 0;
        long fileId = voice.Value<long?>("id") ?? 0;

        result.Add(new TranslationVariant
        {
            source = Source,
            path = Path,
            translation = name,
            translation_id = translationId > 0 ? translationId.ToString() : VoiceNormalize.Normalize(name),
            season = Math.Max(0, season),
            episode = episode > 0 ? episode : (season > 0 ? 0 : 1),
            quality = voice.Value<string>("quality"),
            file_id = fileId
        });
    }

    static string NormalizeTitle(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        return Regex.Replace(value.ToLowerInvariant(), "[^a-zа-яё0-9]+", "").Trim();
    }
}
