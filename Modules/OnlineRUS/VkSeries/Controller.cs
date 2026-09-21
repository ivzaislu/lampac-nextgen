using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json.Linq;
using Shared;
using Shared.Attributes;
using Shared.Models.Base;
using Shared.Models.Templates;
using Shared.Services;
using Shared.Services.Utilities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;

namespace VkSeries;

public class VkSeriesController : BaseOnlineController
{
    private static readonly HttpClient http2Client = FriendlyHttp.CreateHttp2Client();

    private static readonly int client_id = 52461373;
    private static string access_token;
    private static DateTime token_expires;

    public VkSeriesController() : base(ModInit.conf) { }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/vkseries")]
    public async Task<ActionResult> Index(string title, string original_title, short year, byte serial, short s = -1, long owner_id = 0, long album_id = 0, bool rjson = false)
    {
        if (serial <= 0)
            return OnError();

        if (await IsRequestBlocked(rch: true))
            return badInitMsg;

        if (!await EnsureAnonymToken(init, proxy))
            return ShowError("token");

        string searchTitle = SearchNameTo.Convert(title);
        string searchOriginalTitle = SearchNameTo.Convert(original_title);

        if (searchTitle == null && searchOriginalTitle == null)
            return OnError("searchTitle");

        if (init.httpversion == 2)
            httpHydra.RegisterHttp(http2Client);

        if (s == -1)
            return await Seasons(title, original_title, year, serial, searchTitle, searchOriginalTitle, rjson);

        if (owner_id == 0 || album_id <= 0)
            return OnError("album");

        return await Episodes(title, original_title, s, owner_id, album_id);
    }

    async Task<ActionResult> Seasons(string title, string original_title, short year, byte serial, string searchTitle, string searchOriginalTitle, bool rjson)
    {
    rhubFallback:
        var cache = await InvokeCacheResult<List<VideoAlbum>>(ipkey($"vkseries:albums:{searchTitle}:{searchOriginalTitle}:{year}"), 20, textJson: true, onget: async e =>
        {
            var albums = new List<VideoAlbum>();

            async Task Search(string query)
            {
                if (string.IsNullOrWhiteSpace(query))
                    return;

                string url = $"{init.host}/method/catalog.getVideoSearchWeb2?v=5.264&client_id={client_id}";
                string data = $"screen_ref=search_video_service&input_method=keyboard_search_button&q={HttpUtility.UrlEncode(query)}&extended=1&access_token={access_token}";

                var root = await httpHydra.Post<Root>(url, data, textJson: true);
                if (root?.response?.albums != null)
                    albums.AddRange(root.response.albums);
            }

            await Search(title);

            if (!string.IsNullOrWhiteSpace(original_title) &&
                !string.Equals(title, original_title, StringComparison.OrdinalIgnoreCase))
            {
                await Search(original_title);
            }

            var result = albums
                .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                .Where(i => MatchAlbum(i.title, searchTitle, searchOriginalTitle))
                .Select(i => new { album = i, season = ParseSeason(i.title) })
                .Where(i => i.season > 0)
                .GroupBy(i => i.season)
                .Select(g => g
                    .OrderByDescending(i => i.album.count)
                    .ThenByDescending(i => i.album.updated_time ?? 0)
                    .First())
                .OrderBy(i => i.season)
                .Select(i =>
                {
                    i.album.season = i.season;
                    return i.album;
                })
                .ToList();

            if (result.Count == 0)
                return e.Fail("albums");

            return e.Success(result);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        return ContentTpl(cache, () =>
        {
            var stpl = new SeasonTpl("2160p", cache.Value.Count);
            string encTitle = HttpUtility.UrlEncode(title);
            string encOriginalTitle = HttpUtility.UrlEncode(original_title);
            string encRjson = rjson.ToString().ToLowerInvariant();

            foreach (var album in cache.Value)
            {
                int season = album.season;
                if (season <= 0)
                    continue;

                stpl.Append(
                    $"{season} сезон",
                    $"{host}/lite/vkseries?title={encTitle}&original_title={encOriginalTitle}&year={year}&serial={serial}&s={season}&owner_id={album.owner_id}&album_id={album.id}&rjson={encRjson}",
                    season
                );
            }

            return stpl;
        });
    }

    async Task<ActionResult> Episodes(string title, string original_title, short season, long ownerId, long albumId)
    {
    rhubFallback:
        var cache = await InvokeCacheResult<List<Video>>(ipkey($"vkseries:album:{ownerId}:{albumId}"), 20, textJson: true, onget: async e =>
        {
            const int pageSize = 100;
            var videos = new List<Video>();
            int offset = 0;
            int total = int.MaxValue;

            while (offset < total && offset < 2000)
            {
                string url = $"{init.host}/method/video.get?v=5.264&client_id={client_id}";
                string data = $"owner_id={ownerId}&album_id={albumId}&count={pageSize}&offset={offset}&extended=1&access_token={access_token}";

                var root = await httpHydra.Post<VideoGetRoot>(url, data, textJson: true);
                var response = root?.response;
                var items = response?.items;

                if (response == null)
                    return e.Fail("video.get");

                total = response.count;

                if (items == null || items.Count == 0)
                    break;

                videos.AddRange(items);
                offset += items.Count;

                if (items.Count < pageSize)
                    break;
            }

            var result = videos
                .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                .GroupBy(i => $"{i.owner_id}:{i.id}")
                .Select(g => g.First())
                .ToList();

            if (result.Count == 0)
                return e.Fail("episodes");

            return e.Success(result);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        return ContentTpl(cache, () =>
        {
            var parsed = cache.Value
                .Where(v => !IsNoise(v?.title))
                .Select(v => new
                {
                    video = v,
                    episode = TryEpisode(v?.title, season, out short ep)
                        ? ep
                        : TryEpisode(v?.description, season, out ep)
                            ? ep
                            : (short)0
                })
                .Where(i => i.episode > 0 && i.video?.files != null)
                .GroupBy(i => i.episode)
                .Select(g => g
                    .OrderByDescending(i => QualityScore(i.video.files))
                    .ThenByDescending(i => i.video.views ?? 0)
                    .First())
                .OrderBy(i => i.episode)
                .ToList();

            var etpl = new EpisodeTpl(parsed.Count);
            string seriesTitle = title ?? original_title;

            foreach (var item in parsed)
            {
                var streams = BuildStreams(item.video.files);
                if (streams.IsEmpty)
                    continue;

                var subtitles = BuildSubtitles(item.video.subtitles);

                etpl.Append(
                    $"Серия {item.episode}",
                    seriesTitle,
                    season,
                    item.episode,
                    streams.Firts().link,
                    streamquality: streams,
                    subtitles: subtitles,
                    headers: HeadersModel.Init(init.headers),
                    vast: init.vast
                );
            }

            return etpl;
        });
    }

    StreamQualityTpl BuildStreams(VideoFiles files)
    {
        var streams = new StreamQualityTpl();

        void Append(string url, string quality)
        {
            if (!string.IsNullOrWhiteSpace(url))
                streams.Append(HostStreamProxy(url), quality);
        }

        Append(files?.mp4_2160, "2160p");
        Append(files?.mp4_1440, "1440p");
        Append(files?.mp4_1080, "1080p");
        Append(files?.mp4_720, "720p");
        Append(files?.mp4_480, "480p");
        Append(files?.mp4_360, "360p");
        Append(files?.mp4_240, "240p");
        Append(files?.mp4_144, "144p");

        return streams;
    }

    SubtitleTpl BuildSubtitles(VideoSubtitle[] subtitles)
    {
        if (subtitles == null || subtitles.Length == 0)
            return null;

        var tpl = new SubtitleTpl(subtitles.Length);

        foreach (var subtitle in subtitles)
        {
            if (string.IsNullOrWhiteSpace(subtitle?.url))
                continue;

            string label = subtitle.manifest_name;
            if (string.IsNullOrWhiteSpace(label))
                label = !string.IsNullOrWhiteSpace(subtitle.title) ? subtitle.title : subtitle.lang;

            tpl.Append(label, HostStreamProxy(subtitle.url));
        }

        return tpl.IsEmpty ? null : tpl;
    }

    static bool MatchAlbum(string title, string searchTitle, string searchOriginalTitle)
    {
        string value = SearchNameTo.Convert(title);
        if (value == null)
            return false;

        return (!string.IsNullOrEmpty(searchTitle) && value.Contains(searchTitle)) ||
               (!string.IsNullOrEmpty(searchOriginalTitle) && value.Contains(searchOriginalTitle));
    }

    static int ParseSeason(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return 0;

        foreach (string pattern in new[]
        {
            @"(?i)\b(?:сезон|season)\s*(?<s>\d{1,2})\b",
            @"(?i)\b(?<s>\d{1,2})\s*(?:сезон|season)\b",
            @"(?i)\bS(?<s>\d{1,2})\b"
        })
        {
            var match = Regex.Match(value, pattern);
            if (match.Success && int.TryParse(match.Groups["s"].Value, out int season) && season > 0)
                return season;
        }

        return 0;
    }

    static bool TryEpisode(string value, short expectedSeason, out short episode)
    {
        episode = 0;
        if (string.IsNullOrWhiteSpace(value))
            return false;

        foreach (string pattern in new[]
        {
            @"(?i)\bS(?<s>\d{1,2})\s*E(?<e>\d{1,3})\b",
            @"(?i)\b(?<s>\d{1,2})\s*(?:сезон|season)\D{0,24}(?<e>\d{1,3})\s*(?:серия|серии|episode|ep|эпизод)\b",
            @"(?i)\b(?:сезон|season)\s*(?<s>\d{1,2})\D{0,24}(?:серия|серии|episode|ep|эпизод)\s*(?<e>\d{1,3})\b"
        })
        {
            var match = Regex.Match(value, pattern);
            if (!match.Success)
                continue;

            if (!short.TryParse(match.Groups["s"].Value, out short season) ||
                !short.TryParse(match.Groups["e"].Value, out short parsedEpisode) ||
                season <= 0 || parsedEpisode <= 0)
            {
                continue;
            }

            if (expectedSeason > 0 && season != expectedSeason)
                return false;

            episode = parsedEpisode;
            return true;
        }

        foreach (string pattern in new[]
        {
            @"(?i)\b(?<e>\d{1,3})\s*(?:серия|серии|episode|эпизод)\b",
            @"(?i)\b(?:серия|серии|episode|ep|эпизод)\s*(?<e>\d{1,3})\b"
        })
        {
            var match = Regex.Match(value, pattern);
            if (match.Success &&
                short.TryParse(match.Groups["e"].Value, out short parsedEpisode) &&
                parsedEpisode > 0)
            {
                episode = parsedEpisode;
                return true;
            }
        }

        return false;
    }

    static bool IsNoise(string value)
    {
        string name = SearchNameTo.Convert(value);
        if (name == null)
            return false;

        return name.Contains("трейлер") ||
               name.Contains("trailer") ||
               name.Contains("премьера") ||
               name.Contains("обзор");
    }

    static int QualityScore(VideoFiles files)
    {
        if (!string.IsNullOrEmpty(files?.mp4_2160)) return 8;
        if (!string.IsNullOrEmpty(files?.mp4_1440)) return 7;
        if (!string.IsNullOrEmpty(files?.mp4_1080)) return 6;
        if (!string.IsNullOrEmpty(files?.mp4_720)) return 5;
        if (!string.IsNullOrEmpty(files?.mp4_480)) return 4;
        if (!string.IsNullOrEmpty(files?.mp4_360)) return 3;
        if (!string.IsNullOrEmpty(files?.mp4_240)) return 2;
        if (!string.IsNullOrEmpty(files?.mp4_144)) return 1;
        return 0;
    }

    async Task<bool> EnsureAnonymToken(BaseSettings init, WebProxy proxy)
    {
        if (!string.IsNullOrEmpty(access_token) && token_expires > DateTime.UtcNow)
            return true;

        var semaphore = new SemaphorManager("vkseries:anonym_token", TimeSpan.FromSeconds(30));

        try
        {
            bool _acquired = await semaphore.WaitAsync();
            if (!_acquired)
                return false;

            if (!string.IsNullOrEmpty(access_token) && token_expires > DateTime.UtcNow)
                return true;

            string url = "https://login.vk.com/?act=get_anonym_token";
            string postData = $"client_secret=o557NLIkAErNhakXrQ7A&client_id={client_id}&scopes=audio_anonymous%2Cvideo_anonymous%2Cphotos_anonymous%2Cprofile_anonymous&isApiOauthAnonymEnabled=false&version=1&app_id=6287487";

            JObject root = null;

            try
            {
                root = await httpHydra.Post<JObject>(url, postData);
            }
            catch { }

            if (root == null || !root.ContainsKey("data"))
                return false;

            var data = root["data"];

            string token = data?["access_token"]?.ToString();
            if (string.IsNullOrEmpty(token))
                return false;

            access_token = token;

            long? expires = data?["expires"]?.ToObject<long?>()
                ?? data?["expired_at"]?.ToObject<long?>()
                ?? -1;

            token_expires = expires == -1
                ? DateTime.UtcNow.AddHours(10)
                : DateTimeOffset.FromUnixTimeSeconds(expires.Value).UtcDateTime.AddHours(-4);

            return true;
        }
        finally
        {
            semaphore.Release();
        }
    }
}
