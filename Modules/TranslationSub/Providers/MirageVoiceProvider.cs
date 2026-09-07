using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared.Services;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;
using TranslationSub.Models;

namespace TranslationSub.Providers;

public class MirageVoiceProvider
{
    public async Task<List<TranslationVariant>> GetVariants(string imdb, long kp, string title, bool serial, int season = 1)
    {
        if (ModInit.conf == null || !ModInit.conf.enable)
            return new List<TranslationVariant>();

        string tokenMovie = await GetTokenMovie(imdb, kp, title, serial);
        if (string.IsNullOrWhiteSpace(tokenMovie))
            return new List<TranslationVariant>();

        var all = await GetFileList(tokenMovie);
        if (all == null)
            return new List<TranslationVariant>();

        var result = new List<TranslationVariant>();

        // Фильмы в Mirage обычно лежат в all.theatrical.
        if (!serial)
        {
            JToken theatrical = all["theatrical"];
            if (theatrical != null)
                ExtractMovie(theatrical, result);

            if (result.Count == 0)
                ExtractRecursive(all, result, 0);
        }
        else
        {
            ExtractSerial(all, result, season <= 0 ? 1 : season);
        }

        return result
            .Where(x => !string.IsNullOrWhiteSpace(x.translation))
            .GroupBy(x => $"{x.translation_id}:{x.season}:{x.episode}:{x.translation}")
            .Select(x => x.First())
            .OrderBy(x => x.translation)
            .ThenBy(x => x.season)
            .ThenBy(x => x.episode)
            .ToList();
    }

    async Task<string> GetTokenMovie(string imdb, long kp, string title, bool serial)
    {
        try
        {
            string url = $"{ModInit.conf.mirage_apihost}/?token={ModInit.conf.mirage_token}&kp={kp}&imdb={HttpUtility.UrlEncode(imdb)}";
            string json = await Http.Get(url);
            var root = string.IsNullOrWhiteSpace(json) ? null : JsonConvert.DeserializeObject<JObject>(json);

            string tokenMovie = root?["data"]?.Value<string>("token_movie");
            if (!string.IsNullOrWhiteSpace(tokenMovie))
                return tokenMovie;
        }
        catch { }

        if (string.IsNullOrWhiteSpace(title))
            return null;

        try
        {
            string url = $"{ModInit.conf.mirage_apihost}/?token={ModInit.conf.mirage_token}&name={HttpUtility.UrlEncode(title)}&list={(serial ? "serial" : "movie")}";
            string json = await Http.Get(url);
            var root = string.IsNullOrWhiteSpace(json) ? null : JsonConvert.DeserializeObject<JObject>(json);

            foreach (var item in root?["data"] ?? new JArray())
            {
                string tokenMovie = item.Value<string>("token_movie");
                if (!string.IsNullOrWhiteSpace(tokenMovie))
                    return tokenMovie;
            }
        }
        catch { }

        return null;
    }

    async Task<JToken> GetFileList(string tokenMovie)
    {
        try
        {
            string url = $"{ModInit.conf.mirage_linkhost}/?token_movie={HttpUtility.UrlEncode(tokenMovie)}&token={ModInit.conf.mirage_token}";
            string html = await Http.Get(url);
            if (string.IsNullOrWhiteSpace(html))
                return null;

            string raw = Regex.Match(html, "fileList = JSON.parse\\('([^\\n\\r]+)'\\);").Groups[1].Value;
            if (string.IsNullOrWhiteSpace(raw))
                return null;

            raw = Regex.Unescape(raw);

            var root = JsonConvert.DeserializeObject<JObject>(raw);
            return root?["all"];
        }
        catch
        {
            return null;
        }
    }

    void ExtractMovie(JToken node, List<TranslationVariant> result)
    {
        if (node is JObject obj)
        {
            foreach (var property in obj.Properties())
            {
                if (property.Value is JObject voiceObj && voiceObj["translation"] != null)
                    AddVariant(voiceObj, result, 0, 0);
                else
                    ExtractMovie(property.Value, result);
            }
        }
        else if (node is JArray arr)
        {
            foreach (var child in arr)
                ExtractMovie(child, result);
        }
    }

    void ExtractSerial(JToken all, List<TranslationVariant> result, int season)
    {
        string s = season.ToString();

        // Основной формат: all[season][episode][voice].
        if (all[s] != null)
        {
            ExtractEpisodesNode(all[s], result, season);
            return;
        }

        // Альтернативный формат: all[t*].file[season]...
        if (all is JObject obj)
        {
            foreach (var prop in obj.Properties())
            {
                var file = prop.Value?["file"];
                if (file?[s] != null)
                    ExtractEpisodesNode(file[s], result, season);
            }
        }
    }

    void ExtractEpisodesNode(JToken node, List<TranslationVariant> result, int season)
    {
        if (node is JArray arr)
        {
            foreach (var child in arr)
                ExtractEpisodesNode(child, result, season);
            return;
        }

        if (node is not JObject obj)
            return;

        if (obj["translation"] != null)
        {
            int episode = obj.Value<int?>("episode") ?? 0;
            AddVariant(obj, result, season, episode);
            return;
        }

        foreach (var prop in obj.Properties())
        {
            if (prop.Value is JObject voiceObj && voiceObj["translation"] != null)
            {
                int episode = voiceObj.Value<int?>("episode") ?? ParseInt(prop.Name);
                AddVariant(voiceObj, result, season, episode);
            }
            else
            {
                ExtractEpisodesNode(prop.Value, result, season);
            }
        }
    }

    void ExtractRecursive(JToken node, List<TranslationVariant> result, int season)
    {
        if (node is JObject obj)
        {
            if (obj["translation"] != null)
            {
                AddVariant(obj, result, season, obj.Value<int?>("episode") ?? 0);
                return;
            }

            foreach (var prop in obj.Properties())
                ExtractRecursive(prop.Value, result, season);
        }
        else if (node is JArray arr)
        {
            foreach (var child in arr)
                ExtractRecursive(child, result, season);
        }
    }

    void AddVariant(JToken voice, List<TranslationVariant> result, int season, int episode)
    {
        result.Add(new TranslationVariant
        {
            translation = voice.Value<string>("translation"),
            translation_id = voice.Value<int?>("id_translation") ?? 0,
            season = season,
            episode = episode,
            quality = voice.Value<string>("quality"),
            file_id = voice.Value<long?>("id") ?? 0
        });
    }

    int ParseInt(string value)
    {
        return int.TryParse(value, out int n) ? n : 0;
    }
}
