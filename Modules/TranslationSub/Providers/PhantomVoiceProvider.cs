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
            CollectVoices(theatrical, result, 0, 1);
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
        string key = season.ToString();
        bool found = false;

        if (all?[key] != null)
        {
            CollectVoices(all[key], result, season, 0);
            found = true;
        }

        if (all?["seasons"]?[key] != null)
        {
            CollectVoices(all["seasons"][key], result, season, 0);
            found = true;
        }

        if (all is JObject obj)
        {
            foreach (var prop in obj.Properties())
            {
                var file = prop.Value?["file"];
                if (file?[key] == null)
                    continue;

                CollectVoices(file[key], result, season, 0);
                found = true;
            }
        }

        if (!found)
            CollectVoices(all, result, season, 0, onlySeason: season);
    }

    void CollectVoices(JToken node, List<TranslationVariant> result, int season, int episodeHint, int onlySeason = 0)
    {
        if (node == null)
            return;

        if (node is JObject obj)
        {
            if (obj["translation"] != null)
            {
                int objectSeason = obj.Value<int?>("season") ?? season;
                if (onlySeason > 0 && objectSeason > 0 && objectSeason != onlySeason)
                    return;

                int episode = obj.Value<int?>("episode") ?? episodeHint;
                AddVariant(obj, result, objectSeason, episode);
                return;
            }

            foreach (var prop in obj.Properties())
            {
                int nextHint = episodeHint;
                if (int.TryParse(prop.Name, out int numeric) && numeric > 0)
                    nextHint = numeric;

                CollectVoices(prop.Value, result, season, nextHint, onlySeason);
            }
        }
        else if (node is JArray arr)
        {
            foreach (var child in arr)
                CollectVoices(child, result, season, episodeHint, onlySeason);
        }
    }

    IEnumerable<int> GetSeasons(JToken all)
    {
        var seasons = new HashSet<int>();

        if (all is not JObject obj)
            return seasons;

        foreach (var prop in obj.Properties())
        {
            if (int.TryParse(prop.Name, out int direct) && direct > 0)
                seasons.Add(direct);

            if (prop.Name == "seasons" && prop.Value is JObject seasonsObj)
            {
                foreach (var seasonProp in seasonsObj.Properties())
                    if (int.TryParse(seasonProp.Name, out int n) && n > 0)
                        seasons.Add(n);
            }

            if (prop.Value?["file"] is JObject file)
            {
                foreach (var seasonProp in file.Properties())
                    if (int.TryParse(seasonProp.Name, out int n) && n > 0)
                        seasons.Add(n);
            }
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
