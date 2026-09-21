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
    private static readonly string[] trustedChannels = new[] { "mirserialov" };

    private static string access_token;
    private static DateTime token_expires;

    public VkSeriesController() : base(ModInit.conf) { }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/vkseries")]
    public async Task<ActionResult> Index(string title, string original_title, short year, byte serial, short s = -1, long owner_id = 0, long album_id = 0, short album_s = 0, bool rjson = false)
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

        return await Episodes(title, original_title, s, owner_id, album_id, album_s);
    }

    async Task<ActionResult> Seasons(string title, string original_title, short year, byte serial, string searchTitle, string searchOriginalTitle, bool rjson)
    {
    rhubFallback:
        var cache = await InvokeCacheResult<List<VideoAlbum>>(ipkey($"vkseries:v5:trusted:{searchTitle}:{searchOriginalTitle}:{year}"), 20, textJson: true, onget: async e =>
        {
            var albums = await SearchTrustedAlbums();
            if (albums == null || albums.Count == 0)
                return e.Fail("trusted albums");

            var result = albums
                .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                .Select(i => new
                {
                    album = i,
                    season = ParseSeason(i.title),
                    score = AlbumScore(i, searchTitle, searchOriginalTitle, year)
                })
                .Where(i => i.season > 0 && i.score > 0)
                .GroupBy(i => i.season)
                .Select(g => g
                    .OrderByDescending(i => i.score)
                    .ThenByDescending(i => i.album.count)
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
                return e.Fail("trusted season playlists");

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
                short season = (short)album.season;
                if (season <= 0)
                    continue;

                stpl.Append(
                    $"{season} сезон",
                    $"{host}/lite/vkseries?title={encTitle}&original_title={encOriginalTitle}&year={year}&serial={serial}&s={season}&owner_id={album.owner_id}&album_id={album.id}&album_s={season}&rjson={encRjson}",
                    season
                );
            }

            return stpl;
        });
    }

    async Task<ActionResult> Episodes(string title, string original_title, short season, long ownerId, long albumId, short albumSeasonHint)
    {
    rhubFallback:
        var cache = await InvokeCacheResult<List<Video>>(ipkey($"vkseries:v5:album:{ownerId}:{albumId}"), 20, textJson: true, onget: async e =>
        {
            var videos = await GetAlbumVideos(ownerId, albumId);
            if (videos == null || videos.Count == 0)
                return e.Fail("video.get");

            return e.Success(videos);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        return ContentTpl(cache, () =>
        {
            var parsed = ParseVideos(cache.Value, albumSeasonHint)
                .Where(i => i.season == season)
                .GroupBy(i => i.episode)
                .Select(g => g
                    .OrderByDescending(i => QualityScore(i.video.files))
                    .ThenByDescending(i => i.video.duration)
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

    async Task<List<VideoAlbum>> SearchTrustedAlbums()
    {
        var result = new List<VideoAlbum>();

        foreach (string screenName in trustedChannels)
        {
            long ownerId = await ResolveChannelOwnerId(screenName);
            if (ownerId == 0)
                continue;

            var albums = await GetOwnerAlbums(ownerId);
            if (albums != null && albums.Count > 0)
                result.AddRange(albums);
        }

        return result
            .Where(i => i != null && i.id > 0 && i.owner_id != 0)
            .GroupBy(i => $"{i.owner_id}:{i.id}")
            .Select(g => g
                .OrderByDescending(i => i.updated_time ?? 0)
                .First())
            .ToList();
    }

    async Task<long> ResolveChannelOwnerId(string screenName)
    {
        string url = $"{init.host}/method/utils.resolveScreenName?v=5.264&client_id={client_id}";
        string data = $"screen_name={HttpUtility.UrlEncode(screenName)}&access_token={access_token}";

        var root = await httpHydra.Post<ResolveScreenNameRoot>(url, data, textJson: true);
        if (root?.error != null || root?.response == null || root.response.object_id <= 0)
            return 0;

        return string.Equals(root.response.type, "user", StringComparison.OrdinalIgnoreCase)
            ? root.response.object_id
            : -root.response.object_id;
    }

    async Task<List<VideoAlbum>> GetOwnerAlbums(long ownerId)
    {
        return await InvokeCache<List<VideoAlbum>>(ipkey($"vkseries:v5:channel:{ownerId}:albums"), 20, async () =>
        {
            const int pageSize = 100;
            var albums = new List<VideoAlbum>();
            int offset = 0;
            int total = int.MaxValue;

            while (offset < total && offset < 5000)
            {
                string url = $"{init.host}/method/video.getAlbums?v=5.264&client_id={client_id}";
                string data = $"owner_id={ownerId}&count={pageSize}&offset={offset}&extended=1&need_system=0&access_token={access_token}";

                var root = await httpHydra.Post<VideoAlbumsRoot>(url, data, textJson: true);
                if (root?.error != null || root?.response == null)
                    return null;

                var items = root.response.items;
                total = root.response.count;

                if (items == null || items.Count == 0)
                    break;

                albums.AddRange(items);

                int nextOffset = offset + items.Count;
                if (nextOffset <= offset)
                    break;

                offset = nextOffset;

                if (items.Count < pageSize)
                    break;
            }

            return albums
                .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                .GroupBy(i => $"{i.owner_id}:{i.id}")
                .Select(g => g.First())
                .ToList();
        });
    }

    async Task<List<Video>> GetAlbumVideos(long ownerId, long albumId)
    {
        return await InvokeCache<List<Video>>(ipkey($"vkseries:v5:album:{ownerId}:{albumId}"), 20, async () =>
        {
            const int pageSize = 200;
            var videos = new List<Video>();
            int offset = 0;
            int total = int.MaxValue;

            while (offset < total)
            {
                string url = $"{init.host}/method/video.get?v=5.264&client_id={client_id}";
                string data = $"owner_id={ownerId}&album_id={albumId}&count={pageSize}&offset={offset}&sort_album=1&extended=1&access_token={access_token}";

                var root = await httpHydra.Post<VideoGetRoot>(url, data, textJson: true);
                if (root?.error != null || root?.response == null)
                    return null;

                var items = root.response.items;
                total = root.response.count;

                if (items == null || items.Count == 0)
                    break;

                videos.AddRange(items);

                int nextOffset = offset + items.Count;
                if (nextOffset <= offset)
                    break;

                offset = nextOffset;
            }

            return videos
                .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                .GroupBy(i => $"{i.owner_id}:{i.id}")
                .Select(g => g.First())
                .ToList();
        });
    }

    static List<ParsedEpisode> ParseVideos(IEnumerable<Video> videos, short albumSeasonHint)
    {
        var result = new List<ParsedEpisode>();

        foreach (var video in videos)
        {
            if (video == null ||
                IsNoise(video.title) ||
                IsMomentVideo(video) ||
                IsCompilationVideo(video))
            {
                continue;
            }

            if (!TryParseEpisode(video, albumSeasonHint, out short season, out short episode))
                continue;

            if (QualityScore(video.files) == 0)
                continue;

            result.Add(new ParsedEpisode
            {
                video = video,
                season = season,
                episode = episode
            });
        }

        return result;
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

        if (streams.IsEmpty)
        {
            Append(files?.hls_fmp4, "auto");
            Append(files?.hls, "auto");
        }

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

    static int AlbumScore(VideoAlbum album, string searchTitle, string searchOriginalTitle, short year)
    {
        string value = SearchNameTo.Convert(album?.title);
        if (value == null)
            return 0;

        int score = 0;

        void Match(string query)
        {
            if (string.IsNullOrWhiteSpace(query))
                return;

            if (value == query)
                score = Math.Max(score, 220);
            else if (value.StartsWith(query))
                score = Math.Max(score, 180);
            else if (value.Contains(query))
                score = Math.Max(score, 120);
        }

        Match(searchTitle);
        Match(searchOriginalTitle);

        if (score == 0)
            return 0;

        if (year > 0)
        {
            if (value.Contains(year.ToString()))
                score += 30;
            else if (Regex.IsMatch(value, @"\b(?:19|20)\d{2}\b"))
                score -= 20;
        }

        score += Math.Min(album.count, 50);
        return score;
    }

    static int ParseSeason(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return 0;

        foreach (string pattern in new[]
        {
            @"(?i)\b(?:сезон|season)\s*[№#]?\s*(?<s>\d{1,2})\b",
            @"(?i)\b(?<s>\d{1,2})\s*(?:-?й\s*)?(?:сезон|season)\b",
            @"(?i)\bS(?<s>\d{1,2})\b"
        })
        {
            var match = Regex.Match(value, pattern);
            if (match.Success && int.TryParse(match.Groups["s"].Value, out int season) && season > 0)
                return season;
        }

        return 0;
    }

    static bool TryParseEpisode(Video video, short albumSeasonHint, out short season, out short episode)
    {
        season = 0;
        episode = 0;

        if (TrySeasonEpisode(video?.title, out season, out episode))
            return true;

        if (TrySeasonEpisode(video?.description, out season, out episode))
            return true;

        int titleSeason = ParseSeason(video?.title);
        int descriptionSeason = ParseSeason(video?.description);
        int explicitSeason = titleSeason > 0 ? titleSeason : descriptionSeason;

        if (explicitSeason > 0)
        {
            if (TryGenericEpisode(video?.title, out episode) ||
                TryGenericEpisode(video?.description, out episode))
            {
                season = (short)explicitSeason;
                return true;
            }

            return false;
        }

        if (albumSeasonHint <= 0)
            return false;

        if (TryGenericEpisode(video?.title, out episode) ||
            TryGenericEpisode(video?.description, out episode))
        {
            season = albumSeasonHint;
            return true;
        }

        return false;
    }

    static bool TrySeasonEpisode(string value, out short season, out short episode)
    {
        season = 0;
        episode = 0;

        if (string.IsNullOrWhiteSpace(value))
            return false;

        foreach (string pattern in new[]
        {
            @"(?i)\bS(?<s>\d{1,2})[\s._-]*E(?<e>\d{1,3})\b",
            @"(?i)\b(?<s>\d{1,2})\s*[xх]\s*(?<e>\d{1,3})\b",
            @"(?i)\b(?<s>\d{1,2})\s*(?:-?й\s*)?(?:сезон|season)\D{0,32}(?<e>\d{1,3})(?:\s*[-–—]?\s*(?:я|ая))?\s*(?:серия|серии|episode|ep|эпизод)\b",
            @"(?i)\b(?:сезон|season)\s*[№#]?\s*(?<s>\d{1,2})\D{0,32}(?:серия|серии|episode|ep|эпизод)\s*[№#]?\s*(?<e>\d{1,3})\b"
        })
        {
            var match = Regex.Match(value, pattern);
            if (!match.Success)
                continue;

            if (short.TryParse(match.Groups["s"].Value, out season) &&
                short.TryParse(match.Groups["e"].Value, out episode) &&
                season > 0 && episode > 0)
            {
                return true;
            }
        }

        season = 0;
        episode = 0;
        return false;
    }

    static bool TryGenericEpisode(string value, out short episode)
    {
        episode = 0;

        if (string.IsNullOrWhiteSpace(value))
            return false;

        foreach (string pattern in new[]
        {
            @"(?i)\b(?<e>\d{1,3})(?:\s*[-–—]?\s*(?:я|ая))?\s*(?:серия|серии|episode|ep|эпизод)\b",
            @"(?i)\b(?:серия|серии|episode|ep|эпизод)\s*[№#]?\s*(?<e>\d{1,3})\b",
            @"(?i)\bE(?<e>\d{1,3})\b"
        })
        {
            var match = Regex.Match(value, pattern);
            if (match.Success &&
                short.TryParse(match.Groups["e"].Value, out episode) &&
                episode > 0)
            {
                return true;
            }
        }

        episode = 0;
        return false;
    }

    static bool IsCompilationVideo(Video video)
    {
        if (video == null)
            return true;

        string title = SearchNameTo.Convert(video.title);
        string description = SearchNameTo.Convert(video.description);

        bool HasMarker(string value)
        {
            if (string.IsNullOrEmpty(value))
                return false;

            return value.Contains("всесерии") ||
                   value.Contains("всесериисезона") ||
                   value.Contains("полныйсезон") ||
                   value.Contains("сезонполностью") ||
                   value.Contains("allepisodes") ||
                   value.Contains("fullseason");
        }

        if (HasMarker(title) || HasMarker(description))
            return true;

        string rawTitle = video.title ?? string.Empty;

        // "1-7 серия", "1–10 серии", "episodes 1-8".
        if (Regex.IsMatch(
            rawTitle,
            @"(?i)(?:\b\d{1,3}\s*[-–—]\s*\d{1,3}\s*(?:серия|серии|серий|episodes?|ep)\b|\b(?:episodes?|ep)\s*\d{1,3}\s*[-–—]\s*\d{1,3}\b)"))
        {
            return true;
        }

        // "1, 2, 3 серии" / "1 и 2 серия".
        if (Regex.IsMatch(
            rawTitle,
            @"(?i)\b\d{1,3}(?:\s*[,/&]\s*\d{1,3}|\s+и\s+\d{1,3})+\s*(?:серия|серии|серий|episodes?)\b"))
        {
            return true;
        }

        return false;
    }

    static bool IsMomentVideo(Video video)
    {
        if (video == null)
            return true;

        if (video.short_video_info != null)
            return true;

        string name = SearchNameTo.Convert(video.title);
        if (name != null &&
            (name.Contains("момент") ||
             name.Contains("фрагмент") ||
             name.Contains("отрывок") ||
             name.Contains("сцена") ||
             name.Contains("moment") ||
             name.Contains("clip")))
        {
            return true;
        }

        // Полноценные серии сериалов обычно заметно длиннее нарезок/моментов.
        // Нулевую duration не режем: у части ответов VK она может отсутствовать.
        if (video.duration > 0 && video.duration < 10 * 60)
            return true;

        return false;
    }

    static bool IsNoise(string value)
    {
        string name = SearchNameTo.Convert(value);
        if (name == null)
            return false;

        return name.Contains("трейлер") ||
               name.Contains("trailer") ||
               name.Contains("тизер") ||
               name.Contains("teaser") ||
               name.Contains("премьера") ||
               name.Contains("обзор");
    }

    static int QualityScore(VideoFiles files)
    {
        if (!string.IsNullOrEmpty(files?.mp4_2160)) return 9;
        if (!string.IsNullOrEmpty(files?.mp4_1440)) return 8;
        if (!string.IsNullOrEmpty(files?.mp4_1080)) return 7;
        if (!string.IsNullOrEmpty(files?.mp4_720)) return 6;
        if (!string.IsNullOrEmpty(files?.mp4_480)) return 5;
        if (!string.IsNullOrEmpty(files?.mp4_360)) return 4;
        if (!string.IsNullOrEmpty(files?.mp4_240)) return 3;
        if (!string.IsNullOrEmpty(files?.mp4_144)) return 2;
        if (!string.IsNullOrEmpty(files?.hls_fmp4) || !string.IsNullOrEmpty(files?.hls)) return 1;
        return 0;
    }

    static string MaxQuality(IEnumerable<ParsedEpisode> episodes)
    {
        int score = episodes?
            .Select(i => QualityScore(i.video?.files))
            .DefaultIfEmpty(0)
            .Max() ?? 0;

        return score switch
        {
            >= 9 => "2160p",
            8 => "1440p",
            7 => "1080p",
            6 => "720p",
            5 => "480p",
            4 => "360p",
            3 => "240p",
            2 => "144p",
            1 => "auto",
            _ => null
        };
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

    private sealed class ParsedEpisode
    {
        public Video video { get; set; }
        public short season { get; set; }
        public short episode { get; set; }
    }
}
