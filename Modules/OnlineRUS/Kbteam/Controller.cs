using Microsoft.AspNetCore.Mvc;
using Shared;
using Shared.Attributes;
using Shared.Models.Base;
using Shared.Models.Templates;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;

namespace Kbteam;

public class KbteamController : BaseOnlineController<ModuleConf>
{
    public KbteamController() : base(ModInit.conf) { }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/kbteam")]
    async public Task<ActionResult> Index(long kinopoisk_id, string title, string original_title, short s = -1, int t = -1, bool rjson = false, bool checksearch = false)
    {
        if (kinopoisk_id <= 0)
        {
            if (checksearch)
                return Json(new { rch = false });

            return OnError("kinopoisk_id");
        }

        if (await IsRequestBlocked(rch: false))
            return badInitMsg;

        string rootParams = $"act=watch&vid={kinopoisk_id}";
        var rootCache = await InvokeCacheResult<Root>($"kbteam:{rootParams}", TimeSpan.FromSeconds(init.cache_ttl), async e =>
        {
            var data = await ApiGet(rootParams);
            if (data == null)
                return e.Fail("api", refresh_proxy: true);

            return e.Success(data);
        });

        var items = FlattenItems(rootCache.Value);
        var seasonItems = PanelItems(items);
        bool serial = seasonItems.Count > 0;
        var movieVoices = serial ? null : GroupMovieVoices(items);
        bool playable = serial || movieVoices.Count > 0;

        if (!playable)
        {
            if (checksearch)
                return Json(new { rch = false });

            return OnError();
        }

        if (checksearch)
            return Json(new { rch = true, type = serial ? "serial" : "movie", quality = "FHD" });

        if (!serial)
        {
            return ContentTpl(rootCache, () => BuildMovie(
                title,
                original_title,
                movieVoices
            ));
        }

        if (s == -1 && seasonItems.Count > 1)
        {
            return ContentTpl(rootCache, () => BuildSeasons(
                seasonItems,
                kinopoisk_id,
                title,
                original_title,
                rjson
            ));
        }

        if (s == -1)
            s = 1;

        int seasonIndex = Math.Max(0, s - 1);
        if (seasonIndex >= seasonItems.Count)
            seasonIndex = 0;

        string seasonParams = PanelToParams(seasonItems[seasonIndex].action);
        if (string.IsNullOrEmpty(seasonParams))
            return OnError("seasonParams");

        var voicesCache = await InvokeCacheResult<Root>($"kbteam:{seasonParams}", TimeSpan.FromSeconds(init.cache_ttl), async e =>
        {
            var data = await ApiGet(seasonParams);
            if (data == null)
                return e.Fail("voices", refresh_proxy: true);

            return e.Success(data);
        });

        var voicesItems = PanelItems(FlattenItems(voicesCache.Value));
        if (voicesItems.Count == 0)
            return OnError("voices");

        int voiceIndex = t < 0 ? 0 : Math.Clamp(t, 0, voicesItems.Count - 1);
        string voiceParams = PanelToParams(voicesItems[voiceIndex].action);
        if (string.IsNullOrEmpty(voiceParams))
            return OnError("voiceParams");

        var episodesCache = await InvokeCacheResult<Root>($"kbteam:{voiceParams}", TimeSpan.FromSeconds(init.cache_ttl), async e =>
        {
            var data = await ApiGet(voiceParams);
            if (data == null)
                return e.Fail("episodes", refresh_proxy: true);

            return e.Success(data);
        });

        var episodeItems = VideoItems(FlattenItems(episodesCache.Value));
        if (episodeItems.Count == 0)
            return OnError("episodes");

        return ContentTpl(episodesCache, () => BuildEpisodes(
            voicesItems,
            episodeItems,
            kinopoisk_id,
            title,
            original_title,
            s,
            voiceIndex,
            rjson
        ));
    }

    async Task<Root> ApiGet(string parameters)
    {
        string url = $"{init.apihost}?{parameters}&device=";
        return await httpHydra.Get<Root>(url, safety: true);
    }

    static List<Item> FlattenItems(Root data)
    {
        if (data?.items != null)
            return data.items;

        var result = new List<Item>();
        if (data?.pages == null)
            return result;

        foreach (var page in data.pages)
        {
            if (page?.items != null)
                result.AddRange(page.items);
        }

        return result;
    }

    static bool IsPanelItem(Item item)
    {
        return item?.type == "control"
            && !string.IsNullOrEmpty(item.action)
            && item.action.StartsWith("panel:", StringComparison.OrdinalIgnoreCase);
    }

    static bool IsVideoItem(Item item)
    {
        return !string.IsNullOrEmpty(item?.action)
            && item.action.StartsWith("video:", StringComparison.OrdinalIgnoreCase);
    }

    static List<Item> PanelItems(List<Item> items)
    {
        return items?.Where(IsPanelItem).ToList() ?? new List<Item>();
    }

    static List<Item> VideoItems(List<Item> items)
    {
        return items?.Where(IsVideoItem).ToList() ?? new List<Item>();
    }

    static List<VoiceGroup> GroupMovieVoices(List<Item> items)
    {
        var voices = new List<VoiceGroup>();
        VoiceGroup current = null;

        foreach (var item in items)
        {
            if (item == null)
                continue;

            if (item.type == "space")
            {
                if (current?.urls.Count > 0)
                    voices.Add(current);

                current = new VoiceGroup
                {
                    name = CleanMsx(item.titleHeader ?? item.label)
                };

                if (string.IsNullOrWhiteSpace(current.name))
                    current.name = $"Озвучка {voices.Count + 1}";

                continue;
            }

            if (!IsVideoItem(item))
                continue;

            if (current == null)
            {
                current = new VoiceGroup
                {
                    name = $"Озвучка {voices.Count + 1}"
                };
            }

            string url = StripVideo(item.action);
            int quality = QualityFromAction(item.action);
            if (string.IsNullOrEmpty(url) || quality <= 0)
                continue;

            current.urls.Add(new QualityLink
            {
                quality = quality,
                url = url
            });
        }

        if (current?.urls.Count > 0)
            voices.Add(current);

        return voices;
    }

    ITplResult BuildMovie(string title, string originalTitle, List<VoiceGroup> voices)
    {
        if (voices == null || voices.Count == 0)
            return default;

        var mtpl = new MovieTpl(title, originalTitle, voices.Count);

        foreach (var voice in voices)
        {
            var sorted = voice.urls
                .Where(i => i != null && i.quality > 0 && !string.IsNullOrEmpty(i.url))
                .OrderByDescending(i => i.quality)
                .ToList();

            if (sorted.Count == 0)
                continue;

            var qualityTpl = new StreamQualityTpl(sorted.Count);
            foreach (var item in sorted)
                qualityTpl.Append(StreamUrl(item.url), QualityLabel(item.quality));

            string stream = StreamUrl(sorted[0].url);
            mtpl.Append(
                voice.name ?? "Озвучка",
                stream,
                streamquality: qualityTpl,
                voice_name: voice.name
            );
        }

        return mtpl;
    }

    ITplResult BuildSeasons(List<Item> items, long kinopoiskId, string title, string originalTitle, bool rjson)
    {
        var tpl = new SeasonTpl(items.Count);
        string encTitle = HttpUtility.UrlEncode(title);
        string encOriginalTitle = HttpUtility.UrlEncode(originalTitle);

        for (int i = 0; i < items.Count; i++)
        {
            var item = items[i];
            string parameters = PanelToParams(item?.action);
            var match = Regex.Match(parameters ?? string.Empty, @"(?:^|&)sid=(\d+)");
            int seasonIndex = match.Success && int.TryParse(match.Groups[1].Value, out int sid) ? sid : i;
            int season = seasonIndex + 1;

            string label = CleanMsx(item?.label);
            if (string.IsNullOrWhiteSpace(label))
                label = $"Сезон {season}";

            tpl.Append(
                label,
                $"{host}/lite/kbteam?kinopoisk_id={kinopoiskId}&title={encTitle}&original_title={encOriginalTitle}&rjson={rjson}&s={season}",
                season
            );
        }

        return tpl;
    }

    ITplResult BuildEpisodes(List<Item> voiceItems, List<Item> episodeItems, long kinopoiskId, string title, string originalTitle, short season, int voiceIndex, bool rjson)
    {
        var vtpl = new VoiceTpl(voiceItems.Count);
        string encTitle = HttpUtility.UrlEncode(title);
        string encOriginalTitle = HttpUtility.UrlEncode(originalTitle);

        for (int i = 0; i < voiceItems.Count; i++)
        {
            string voiceName = CleanMsx(voiceItems[i]?.label);
            if (string.IsNullOrWhiteSpace(voiceName))
                voiceName = $"Озвучка {i + 1}";

            vtpl.Append(
                voiceName,
                i == voiceIndex,
                $"{host}/lite/kbteam?kinopoisk_id={kinopoiskId}&title={encTitle}&original_title={encOriginalTitle}&rjson={rjson}&s={season}&t={i}"
            );
        }

        var etpl = new EpisodeTpl(vtpl, episodeItems.Count);
        string selectedVoice = voiceIndex >= 0 && voiceIndex < voiceItems.Count
            ? CleanMsx(voiceItems[voiceIndex]?.label)
            : null;

        for (int i = 0; i < episodeItems.Count; i++)
        {
            var item = episodeItems[i];
            string stream = StreamUrl(StripVideo(item?.action));
            if (string.IsNullOrEmpty(stream))
                continue;

            int episode = i + 1;
            var match = Regex.Match(item?.label ?? string.Empty, @"(\d+)");
            if (match.Success && int.TryParse(match.Groups[1].Value, out int parsed))
                episode = parsed;

            string name = CleanMsx(item?.label);
            if (string.IsNullOrWhiteSpace(name))
                name = $"Серия {episode}";

            etpl.Append(
                name,
                title ?? originalTitle,
                season,
                episode.ToString(),
                stream,
                voice_name: selectedVoice
            );
        }

        return etpl;
    }

    string StreamUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return null;

        if (url.StartsWith("//"))
            url = "https:" + url;

        return init.streamproxy
            ? HostStreamProxy(url, force_streamproxy: true)
            : url;
    }

    static string StripVideo(string action)
    {
        if (string.IsNullOrEmpty(action))
            return string.Empty;

        return Regex.Replace(action, "^video:", string.Empty, RegexOptions.IgnoreCase);
    }

    static string PanelToParams(string action)
    {
        if (string.IsNullOrEmpty(action))
            return string.Empty;

        string value = Regex.Replace(action, "^panel:", string.Empty, RegexOptions.IgnoreCase);
        int index = value.IndexOf('?');
        if (index < 0 || index + 1 >= value.Length)
            return string.Empty;

        string parameters = value[(index + 1)..];
        if (parameters.EndsWith("&device=", StringComparison.Ordinal))
            parameters = parameters[..^8];

        return parameters;
    }

    static string CleanMsx(string value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;

        value = Regex.Replace(value, @"\{[^}]+\}", string.Empty);
        return Regex.Replace(value, @"\s+", " ").Trim();
    }

    static int QualityFromAction(string action)
    {
        var match = Regex.Match(action ?? string.Empty, @"/(\d+)(?:-[^/]+)?\.mp4");
        return match.Success && int.TryParse(match.Groups[1].Value, out int quality)
            ? quality
            : 0;
    }

    static string QualityLabel(int quality)
    {
        if (quality >= 1080)
            return "1080p";
        if (quality >= 720)
            return "720p";
        if (quality >= 480)
            return "480p";
        if (quality >= 360)
            return "360p";

        return $"{quality}p";
    }
}
