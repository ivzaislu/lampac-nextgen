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
    private const string search_api_version = "5.289";
    private const string fallback_api_version = "5.264";

    private static string access_token;
    private static DateTime token_expires;

    public VkSeriesController() : base(ModInit.conf) { }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/vkseries")]
    public async Task<ActionResult> Index(
        string title,
        string original_title,
        short year,
        byte serial,
        short s = -1,
        bool rjson = false)
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
            return await Seasons(title, original_title, year, serial, rjson);

        return await Episodes(title, original_title, year, s);
    }

    async Task<ActionResult> Seasons(string title, string originalTitle, short year, byte serial, bool rjson)
    {
        string searchTitle = SearchNameTo.Convert(title) ?? string.Empty;
        string searchOriginalTitle = SearchNameTo.Convert(originalTitle) ?? string.Empty;

    rhubFallback:
        var cache = await InvokeCacheResult<List<Video>>(
            ipkey($"vkseries:v7:seasons:{searchTitle}:{searchOriginalTitle}:{year}"),
            15,
            textJson: true,
            onget: async e =>
            {
                var videos = await SearchEpisodeVideos(title, originalTitle, year, 0);
                var parsed = ParseSearchVideos(videos, title, originalTitle, year, 0);

                if (parsed.Count == 0)
                    return e.Fail($"episodes not found: search={videos?.Count ?? 0}");

                return e.Success(videos);
            }
        );

        if (IsRhubFallback(cache))
            goto rhubFallback;

        return ContentTpl(cache, () =>
        {
            var parsed = ParseSearchVideos(cache.Value, title, originalTitle, year, 0);

            var seasons = parsed
                .Select(i => i.season)
                .Distinct()
                .OrderBy(i => i)
                .ToList();

            var stpl = new SeasonTpl(MaxQuality(parsed), seasons.Count);
            string encTitle = HttpUtility.UrlEncode(title);
            string encOriginalTitle = HttpUtility.UrlEncode(originalTitle);
            string encRjson = rjson.ToString().ToLowerInvariant();

            foreach (short season in seasons)
            {
                stpl.Append(
                    $"{season} сезон",
                    $"{host}/lite/vkseries?title={encTitle}&original_title={encOriginalTitle}&year={year}&serial={serial}&s={season}&rjson={encRjson}",
                    season
                );
            }

            return stpl;
        });
    }

    async Task<ActionResult> Episodes(string title, string originalTitle, short year, short season)
    {
        var videos = await SearchEpisodeVideos(title, originalTitle, year, season);
        var parsed = ParseSearchVideos(videos, title, originalTitle, year, season);

        if (parsed.Count == 0)
            return OnError($"episodes not found: search={videos?.Count ?? 0}");

        var owner = parsed
            .GroupBy(i => i.video.owner_id)
            .Select(g => new
            {
                owner_id = g.Key,
                episodes = g.Select(i => i.episode).Distinct().Count(),
                continuity = Continuity(g.Select(i => i.episode)),
                relevance = g.Max(i => i.relevance),
                quality = g.Max(i => QualityScore(i.video.files)),
                views = g.Max(i => i.video.views ?? 0)
            })
            .OrderByDescending(i => i.episodes)
            .ThenByDescending(i => i.continuity)
            .ThenByDescending(i => i.relevance)
            .ThenByDescending(i => i.quality)
            .ThenByDescending(i => i.views)
            .First();

        var selected = parsed
            .Where(i => i.video.owner_id == owner.owner_id)
            .GroupBy(i => i.episode)
            .Select(g => g
                .OrderByDescending(i => i.relevance)
                .ThenByDescending(i => QualityScore(i.video.files))
                .ThenByDescending(i => i.video.duration)
                .ThenByDescending(i => i.video.views ?? 0)
                .First())
            .OrderBy(i => i.episode)
            .ToList();

        var etpl = new EpisodeTpl(selected.Count);
        string seriesTitle = title ?? originalTitle;

        foreach (var item in selected)
        {
            var streams = BuildStreams(item.video.files);
            if (streams.IsEmpty)
                continue;

            etpl.Append(
                $"Серия {item.episode}",
                seriesTitle,
                season,
                item.episode,
                streams.Firts().link,
                streamquality: streams,
                subtitles: BuildSubtitles(item.video.subtitles),
                headers: HeadersModel.Init(init.headers),
                vast: init.vast
            );
        }

        return ContentTpl(etpl);
    }

    async Task<List<Video>> SearchEpisodeVideos(string title, string originalTitle, short year, short season)
    {
        string searchTitle = SearchNameTo.Convert(title) ?? string.Empty;
        string searchOriginalTitle = SearchNameTo.Convert(originalTitle) ?? string.Empty;

        return await InvokeCache<List<Video>>(
            ipkey($"vkseries:v7:search:{searchTitle}:{searchOriginalTitle}:{year}:{season}"),
            10,
            async () =>
            {
                string primaryQuery = season > 0
                    ? BuildSeasonQuery(title, season, false)
                    : title;

                var primary = await SearchQuery(primaryQuery);

                if (ParseSearchVideos(primary, title, originalTitle, year, season).Count > 0)
                    return primary;

                if (string.IsNullOrWhiteSpace(originalTitle) ||
                    string.Equals(searchTitle, searchOriginalTitle, StringComparison.OrdinalIgnoreCase))
                {
                    return primary;
                }

                string fallbackQuery = season > 0
                    ? BuildSeasonQuery(originalTitle, season, true)
                    : originalTitle;

                var fallback = await SearchQuery(fallbackQuery);

                if (ParseSearchVideos(fallback, title, originalTitle, year, season).Count > 0)
                    return fallback;

                return primary.Count >= fallback.Count ? primary : fallback;
            },
            textJson: true
        );
    }

    static string BuildSeasonQuery(string title, short season, bool english)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;

        return english
            ? $"{title} S{season:00}"
            : $"{title} {season} сезон";
    }

    async Task<List<Video>> SearchQuery(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
            return new List<Video>();

        string data =
            $"screen_ref=search_video_service&q={HttpUtility.UrlEncode(query)}&input_method=keyboard_search_button";

        Root root = await PostVkRoot("catalog.getVideoSearchWeb2", data, search_api_version);

        if (!HasSearchVideos(root?.response))
            root = await PostVkRoot("catalog.getVideoSearchWeb2", data, fallback_api_version);

        var response = root?.response;
        if (response == null)
            return new List<Video>();

        var videos = new List<Video>();
        AppendSearchVideos(response, videos);

        string sectionId = response.catalog?.default_section;
        var section = response.catalog?.sections?
            .FirstOrDefault(i => i?.id == sectionId)
            ?? response.catalog?.sections?.FirstOrDefault();

        sectionId ??= section?.id;
        string nextFrom = section?.next_from;

        // Только одна дополнительная страница. Это сильно ограничивает время поиска
        // и не даёт смешивать далеко ушедшую нерелевантную выдачу.
        if (!string.IsNullOrEmpty(sectionId) && !string.IsNullOrEmpty(nextFrom))
        {
            string sectionData =
                $"section_id={HttpUtility.UrlEncode(sectionId)}" +
                $"&start_from={HttpUtility.UrlEncode(nextFrom)}" +
                "&enabled_features=%5B%7B%22name%22%3A%22safe_mode%22%2C%22enabled%22%3Afalse%7D%5D";

            Root sectionRoot = await PostVkRoot("catalog.getSection", sectionData, search_api_version);
            AppendSearchVideos(sectionRoot?.response, videos);
        }

        return videos
            .Where(i => i != null && i.id > 0 && i.owner_id != 0)
            .GroupBy(i => $"{i.owner_id}:{i.id}")
            .Select(g => g.First())
            .ToList();
    }

    static bool HasSearchVideos(Response response)
        => (response?.catalog_videos?.Count ?? 0) > 0 ||
           (response?.videos?.Count ?? 0) > 0;

    static void AppendSearchVideos(Response response, List<Video> videos)
    {
        if (response == null || videos == null)
            return;

        if (response.catalog_videos != null)
        {
            foreach (var item in response.catalog_videos)
            {
                if (item?.video != null)
                    videos.Add(item.video);
            }
        }

        if (response.videos != null)
        {
            foreach (var video in response.videos)
            {
                if (video != null)
                    videos.Add(video);
            }
        }
    }

    async Task<Root> PostVkRoot(string method, string data, string version)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            string url = $"{init.host}/method/{method}?v={version}&client_id={client_id}";
            string payload = string.IsNullOrEmpty(data)
                ? $"access_token={access_token}"
                : $"{data}&access_token={access_token}";

            var root = await httpHydra.Post<Root>(url, payload, textJson: true);

            if (root?.error?.error_code != 5)
                return root;

            access_token = null;
            token_expires = default;

            if (!await EnsureAnonymToken(init, proxy))
                return root;
        }

        return null;
    }

    static List<ParsedEpisode> ParseSearchVideos(
        IEnumerable<Video> videos,
        string title,
        string originalTitle,
        short year,
        short expectedSeason)
    {
        var result = new List<ParsedEpisode>();

        string searchTitle = SearchNameTo.Convert(title) ?? string.Empty;
        string searchOriginalTitle = SearchNameTo.Convert(originalTitle) ?? string.Empty;

        if (videos == null)
            return result;

        foreach (var video in videos)
        {
            if (video == null ||
                IsNoise(video.title) ||
                IsCompilationVideo(video) ||
                QualityScore(video.files) == 0)
            {
                continue;
            }

            // Для прямого поиска доверяем только title. Description часто содержит
            // пересказ других сезонов/серий и был одной из причин смешанной выдачи.
            if (!TrySeasonEpisode(video.title, out short season, out short episode))
                continue;

            if (expectedSeason > 0 && season != expectedSeason)
                continue;

            int relevance = SeriesTitleScore(video.title, searchTitle, searchOriginalTitle);
            if (relevance == 0)
                continue;

            if (year > 0 && HasConflictingYear(video.title, year))
                continue;

            result.Add(new ParsedEpisode
            {
                video = video,
                season = season,
                episode = episode,
                relevance = relevance
            });
        }

        return result;
    }

    static int SeriesTitleScore(string value, string searchTitle, string searchOriginalTitle)
    {
        string name = SearchNameTo.Convert(value);
        if (name == null)
            return 0;

        int score = 0;

        void Match(string query)
        {
            if (string.IsNullOrWhiteSpace(query))
                return;

            // SearchNameTo.Convert удаляет пробелы/пунктуацию:
            // "Джек Ричер. Сезон 1" -> "джекричерсезон1".
            // Поэтому границы слов на normalized-строке проверять нельзя.
            if (name == query)
                score = Math.Max(score, 140);
            else if (name.StartsWith(query))
                score = Math.Max(score, 120);
            else if (name.Contains(query, StringComparison.Ordinal))
                score = Math.Max(score, query.Length >= 5 ? 100 : 70);
        }

        Match(searchTitle);
        Match(searchOriginalTitle);
        return score;
    }

    static bool HasConflictingYear(string value, short year)
    {
        if (year <= 0 || string.IsNullOrWhiteSpace(value))
            return false;

        foreach (Match match in Regex.Matches(value, @"(?<!\d)(?:19|20)\d{2}(?!\d)"))
        {
            if (short.TryParse(match.Value, out short found) &&
                Math.Abs(found - year) > 1)
            {
                return true;
            }
        }

        return false;
    }

    static double Continuity(IEnumerable<short> episodes)
    {
        var values = episodes
            .Where(i => i > 0)
            .Distinct()
            .OrderBy(i => i)
            .ToList();

        if (values.Count == 0)
            return 0;

        return Math.Min(1d, values.Count / (double)values[^1]);
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
                season > 0 &&
                episode > 0)
            {
                return true;
            }
        }

        return false;
    }

    static bool IsCompilationVideo(Video video)
    {
        if (video == null)
            return false;

        string name = SearchNameTo.Convert(video.title);
        if (name != null &&
            (name.Contains("все серии") ||
             name.Contains("all episodes") ||
             name.Contains("полный сезон") ||
             name.Contains("полностью")))
        {
            return true;
        }

        string title = video.title ?? string.Empty;

        if (Regex.IsMatch(
            title,
            @"(?i)\b\d{1,3}\s*[-–—]\s*\d{1,3}\s*(?:серия|серии|серий|episodes?|ep)\b"))
        {
            return true;
        }

        if (Regex.IsMatch(
            title,
            @"(?i)\b\d{1,2}\s*[-–—]\s*\d{1,2}\s*(?:сезон(?:ы|ов)?|seasons?)\b"))
        {
            return true;
        }

        return video.duration >= 4 * 60 * 60;
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
               name.Contains("обзор") ||
               name.Contains("реакция") ||
               name.Contains("разбор");
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
            bool acquired = await semaphore.WaitAsync();
            if (!acquired)
                return false;

            if (!string.IsNullOrEmpty(access_token) && token_expires > DateTime.UtcNow)
                return true;

            string url = "https://login.vk.com/?act=get_anonym_token";
            string postData =
                $"client_secret=o557NLIkAErNhakXrQ7A&client_id={client_id}" +
                "&scopes=audio_anonymous%2Cvideo_anonymous%2Cphotos_anonymous%2Cprofile_anonymous" +
                "&isApiOauthAnonymEnabled=false&version=1&app_id=6287487";

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
        public int relevance { get; set; }
    }
}
