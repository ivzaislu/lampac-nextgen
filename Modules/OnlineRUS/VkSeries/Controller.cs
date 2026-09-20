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
    private const string search_api_version = "5.264";
    private const string series_api_version = "5.289";
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
        var cache = await InvokeCacheResult<SeriesPlaylist>(ipkey($"vkseries:playlist:{searchTitle}:{searchOriginalTitle}:{year}"), 20, textJson: true, onget: async e =>
        {
            var albums = await SearchAlbums(title, original_title, year);
            var best = await SelectBestPlaylist(albums, searchTitle, searchOriginalTitle, year);

            if (best == null)
            {
                // VK serial showcase exposes curated playlist marks which may be absent
                // from the ordinary search response.
                var showcaseAlbums = await SearchShowcaseAlbums(searchTitle, searchOriginalTitle, year);
                best = await SelectBestPlaylist(showcaseAlbums, searchTitle, searchOriginalTitle, year);
            }

            if (best == null)
                return e.Fail("playlist episodes");

            return e.Success(best);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        return ContentTpl(cache, () =>
        {
            var playlist = cache.Value;
            var parsed = ParseVideos(playlist.videos, (short)playlist.album.season);

            var seasons = parsed
                .Select(i => i.season)
                .Where(i => i > 0)
                .Distinct()
                .OrderBy(i => i)
                .ToList();

            var stpl = new SeasonTpl(MaxQuality(parsed), seasons.Count);
            string encTitle = HttpUtility.UrlEncode(title);
            string encOriginalTitle = HttpUtility.UrlEncode(original_title);
            string encRjson = rjson.ToString().ToLowerInvariant();

            foreach (short season in seasons)
            {
                stpl.Append(
                    $"{season} сезон",
                    $"{host}/lite/vkseries?title={encTitle}&original_title={encOriginalTitle}&year={year}&serial={serial}&s={season}&owner_id={playlist.album.owner_id}&album_id={playlist.album.id}&album_s={playlist.album.season}&rjson={encRjson}",
                    season
                );
            }

            return stpl;
        });
    }

    async Task<ActionResult> Episodes(string title, string original_title, short season, long ownerId, long albumId, short albumSeasonHint)
    {
        var videos = await GetAlbumVideos(ownerId, albumId);
        if (videos == null || videos.Count == 0)
            return OnError("video.get");

        var parsed = ParseVideos(videos, albumSeasonHint)
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

        return ContentTpl(etpl);
    }

    async Task<List<VideoAlbum>> SearchAlbums(string title, string originalTitle, short year)
    {
        var albums = new List<VideoAlbum>();
        var queries = new List<string>(4);

        void AddQuery(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return;

            if (!queries.Any(i => string.Equals(i, value, StringComparison.OrdinalIgnoreCase)))
                queries.Add(value);
        }

        if (year > 0)
        {
            AddQuery($"{title} {year}");
            AddQuery($"{originalTitle} {year}");
        }

        AddQuery(title);
        AddQuery(originalTitle);

        foreach (string query in queries)
        {
            string data = $"screen_ref=search_video_service&input_method=keyboard_search_button&q={HttpUtility.UrlEncode(query)}&extended=1";
            var root = await PostVkMethod("catalog.getVideoSearchWeb2", data, search_api_version);

            var found = root?["response"]?["albums"]?.ToObject<List<VideoAlbum>>();
            if (found != null)
                albums.AddRange(found);
        }

        return albums
            .Where(i => i != null && i.id > 0 && i.owner_id != 0)
            .GroupBy(i => $"{i.owner_id}:{i.id}")
            .Select(g => g
                .OrderByDescending(i => i.count)
                .ThenByDescending(i => i.updated_time ?? 0)
                .First())
            .ToList();
    }

    async Task<SeriesPlaylist> SelectBestPlaylist(List<VideoAlbum> albums, string searchTitle, string searchOriginalTitle, short year)
    {
        if (albums == null || albums.Count == 0)
            return null;

        var ranked = albums
            .Where(i => i != null && i.id > 0 && i.owner_id != 0)
            .Select(i => new
            {
                album = i,
                score = AlbumPreScore(i, searchTitle, searchOriginalTitle, year)
            })
            .Where(i => i.score > 0)
            .OrderByDescending(i => i.score)
            .ThenByDescending(i => i.album.updated_time ?? 0)
            .ThenBy(i => i.album.owner_id)
            .ThenBy(i => i.album.id)
            .Take(10)
            .ToList();

        SeriesPlaylist best = null;
        int bestEpisodes = 0;
        int bestScore = int.MinValue;

        foreach (var candidate in ranked)
        {
            // getAlbumById is the authoritative playlist metadata used by vkvideo.ru.
            var album = await GetAlbumInfo(candidate.album.owner_id, candidate.album.id) ?? candidate.album;
            int preScore = AlbumPreScore(album, searchTitle, searchOriginalTitle, year);

            if (preScore == 0)
                continue;

            var videos = await GetAlbumVideos(album.owner_id, album.id);
            if (videos == null || videos.Count == 0)
                continue;

            short seasonHint = (short)ParseSeason(album.title);
            var parsed = ParseVideos(videos, seasonHint);

            int episodeCount = parsed
                .Select(i => $"{i.season}:{i.episode}")
                .Distinct()
                .Count();

            if (episodeCount == 0)
                continue;

            int seasonCount = parsed
                .Select(i => i.season)
                .Where(i => i > 0)
                .Distinct()
                .Count();

            double recognitionRatio = parsed.Count / (double)Math.Max(videos.Count, 1);
            double playableRatio = videos.Count(i => QualityScore(i?.files) > 0) / (double)Math.Max(videos.Count, 1);
            double continuityRatio = EpisodeContinuityRatio(parsed);
            double seriesMatchRatio = videos.Count(i => IsSeriesMatch(i, searchTitle, searchOriginalTitle)) / (double)Math.Max(videos.Count, 1);
            double pollutionRatio = 1d - seriesMatchRatio;
            double compilationRatio = videos.Count(IsCompilationVideo) / (double)Math.Max(videos.Count, 1);

            if (videos.Count >= 5 && recognitionRatio < 0.12d)
                continue;

            int score =
                preScore +
                Math.Min(episodeCount, 40) * 6 +
                Math.Min(seasonCount, 4) * 30 +
                (int)Math.Round(continuityRatio * 120d) +
                (int)Math.Round(playableRatio * 60d) +
                (int)Math.Round(recognitionRatio * 100d) +
                (int)Math.Round(seriesMatchRatio * 100d) -
                (int)Math.Round(pollutionRatio * 180d) -
                (int)Math.Round(compilationRatio * 220d);

            if (score < bestScore)
                continue;

            if (score == bestScore && best != null)
            {
                if (episodeCount < bestEpisodes)
                    continue;

                if (episodeCount == bestEpisodes &&
                    (album.updated_time ?? 0) <= (best.album.updated_time ?? 0))
                {
                    continue;
                }
            }

            album.season = seasonHint;
            best = new SeriesPlaylist
            {
                album = album,
                videos = videos
            };
            bestEpisodes = episodeCount;
            bestScore = score;
        }

        return best;
    }

    async Task<VideoAlbum> GetAlbumInfo(long ownerId, long albumId)
    {
        return await InvokeCache<VideoAlbum>(ipkey($"vkseries:album-info:{ownerId}:{albumId}"), 60, async () =>
        {
            string data = $"album_id={albumId}&owner_id={ownerId}";
            var root = await PostVkMethod("video.getAlbumById", data, series_api_version);
            var album = root?["response"]?.ToObject<VideoAlbum>();

            if (album == null || album.id <= 0 || album.owner_id == 0)
                return null;

            return album;
        }, textJson: true);
    }

    async Task<List<VideoAlbum>> SearchShowcaseAlbums(string searchTitle, string searchOriginalTitle, short year)
    {
        var albums = new List<VideoAlbum>();

        string data = "url=https%3A%2F%2Fvkvideo.ru%2Fmovies_serials%2Fserials&ref=&from_trackcode=&need_blocks=1&section_id=";
        var root = await PostVkMethod("catalog.getVideoShowcase", data, series_api_version);

        for (int page = 0; page < 5 && root != null; page++)
        {
            var response = root["response"];
            if (response == null)
                break;

            AddShowcaseAlbums(response["video_showcase_meta_info"] as JArray, albums, searchTitle, searchOriginalTitle, year);

            if (albums.Count >= 10)
                break;

            var block = FindShowcaseBlock(response);
            string sectionId = block?["id"]?.ToString();
            string nextFrom = block?["next_from"]?.ToString();

            if (string.IsNullOrEmpty(sectionId) || string.IsNullOrEmpty(nextFrom))
                break;

            string sectionData =
                $"section_id={HttpUtility.UrlEncode(sectionId)}&start_from={HttpUtility.UrlEncode(nextFrom)}&from_trackcode=&enabled_features=";

            root = await PostVkMethod("catalog.getSection", sectionData, series_api_version);
        }

        return albums
            .Where(i => i != null && i.id > 0 && i.owner_id != 0)
            .GroupBy(i => $"{i.owner_id}:{i.id}")
            .Select(g => g.First())
            .ToList();
    }

    static JObject FindShowcaseBlock(JToken response)
    {
        JToken section = null;

        var sections = response?["catalog"]?["sections"] as JArray;
        if (sections != null && sections.Count > 0)
            section = sections[0];

        section ??= response?["section"];

        var blocks = section?["blocks"] as JArray;
        if (blocks == null)
            return null;

        return blocks
            .OfType<JObject>()
            .FirstOrDefault(i =>
                i["data_type"]?.ToString() == "videos" &&
                (i["url"]?.ToString()?.Contains("/movies_serials/serials") == true ||
                 string.IsNullOrEmpty(i["url"]?.ToString())));
    }

    static void AddShowcaseAlbums(JArray meta, List<VideoAlbum> albums, string searchTitle, string searchOriginalTitle, short year)
    {
        if (meta == null)
            return;

        foreach (var item in meta.OfType<JObject>())
        {
            string title = item["title"]?.ToString();
            var marks = item["linked_to_playlist_marks"] as JArray;

            if (marks == null || marks.Count == 0)
                continue;

            int count = ParseBadgeCount(item["badge"]?.ToString());

            foreach (var mark in marks)
            {
                if (!TryParsePlaylistId(mark?.ToString(), out long ownerId, out long albumId))
                    continue;

                var album = new VideoAlbum
                {
                    id = albumId,
                    owner_id = ownerId,
                    title = title,
                    count = count
                };

                if (AlbumPreScore(album, searchTitle, searchOriginalTitle, year) > 0)
                    albums.Add(album);
            }
        }
    }

    static int ParseBadgeCount(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return 0;

        var match = Regex.Match(value, @"\d+");
        return match.Success && int.TryParse(match.Value, out int count) ? count : 0;
    }

    static bool TryParsePlaylistId(string value, out long ownerId, out long albumId)
    {
        ownerId = 0;
        albumId = 0;

        if (string.IsNullOrWhiteSpace(value))
            return false;

        int split = value.LastIndexOf('_');
        if (split <= 0 || split >= value.Length - 1)
            return false;

        return long.TryParse(value.Substring(0, split), out ownerId) &&
               long.TryParse(value.Substring(split + 1), out albumId) &&
               ownerId != 0 && albumId > 0;
    }

    async Task<List<Video>> GetAlbumVideos(long ownerId, long albumId)
    {
        return await InvokeCache<List<Video>>(ipkey($"vkseries:album:{ownerId}:{albumId}"), 20, async () =>
        {
            var videos = await FetchAlbumVideos("video.getFromAlbum", ownerId, albumId);
            if (videos == null || videos.Count == 0 || !videos.Any(i => QualityScore(i?.files) > 0))
                videos = await FetchAlbumVideos("video.get", ownerId, albumId);

            return videos?
                .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                .GroupBy(i => $"{i.owner_id}:{i.id}")
                .Select(g => g.First())
                .ToList();
        });
    }

    async Task<List<Video>> FetchAlbumVideos(string method, long ownerId, long albumId)
    {
        bool fromAlbum = method == "video.getFromAlbum";
        int pageSize = fromAlbum ? 50 : 200;
        string apiVersion = fromAlbum ? series_api_version : search_api_version;

        var videos = new List<Video>();
        var seen = new HashSet<string>();
        int offset = 0;
        int total = int.MaxValue;

        while (offset < total)
        {
            string data =
                $"owner_id={ownerId}&album_id={albumId}&count={pageSize}&offset={offset}&extended=1" +
                (fromAlbum ? string.Empty : "&sort_album=1");

            var root = await PostVkMethod(method, data, apiVersion);
            if (root?["error"] != null)
                return null;

            var response = root?["response"];
            if (response == null)
                return null;

            total = response["count"]?.ToObject<int>() ?? int.MaxValue;
            var items = response["items"] as JArray;

            if (items == null || items.Count == 0)
                break;

            int added = 0;

            foreach (var item in items)
            {
                int playlistPosition = item?["playlist_position"]?.ToObject<int>() ?? 0;
                var videoToken = item?["video"] ?? item;
                var video = videoToken?.ToObject<Video>();

                if (video == null || video.id <= 0 || video.owner_id == 0)
                    continue;

                if (playlistPosition > 0)
                    video.playlist_position = playlistPosition;

                if (seen.Add($"{video.owner_id}:{video.id}"))
                {
                    videos.Add(video);
                    added++;
                }
            }

            if (added == 0)
                break;

            int nextOffset = offset + items.Count;
            if (nextOffset <= offset)
                break;

            offset = nextOffset;
        }

        return videos;
    }

    async Task<JObject> PostVkMethod(string method, string data, string version)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            string url = $"{init.host}/method/{method}?v={version}&client_id={client_id}";
            string payload = string.IsNullOrEmpty(data)
                ? $"access_token={access_token}"
                : $"{data}&access_token={access_token}";

            var root = await httpHydra.Post<JObject>(url, payload, textJson: true);
            int errorCode = root?["error"]?["error_code"]?.ToObject<int>() ?? 0;

            if (errorCode != 5)
                return root;

            access_token = null;
            token_expires = default;

            if (!await EnsureAnonymToken(init, proxy))
                return root;
        }

        return null;
    }

    static List<ParsedEpisode> ParseVideos(IEnumerable<Video> videos, short albumSeasonHint)
    {
        var result = new List<ParsedEpisode>();

        foreach (var video in videos)
        {
            if (video == null || IsNoise(video.title))
                continue;

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

    static int AlbumPreScore(VideoAlbum album, string searchTitle, string searchOriginalTitle, short year)
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
                score = Math.Max(score, 240);
            else if (value.StartsWith(query))
                score = Math.Max(score, 200);
            else if (value.Contains(query))
                score = Math.Max(score, 150);
            else if (ContainsAllSignificantWords(value, query))
                score = Math.Max(score, 100);
        }

        Match(searchTitle);
        Match(searchOriginalTitle);

        if (score == 0)
            return 0;

        int yearScore = YearScore(album.title, year);
        if (yearScore == int.MinValue)
            return 0;

        score += yearScore;

        if (ParseSeason(album.title) > 0)
            score += 10;

        if (album.count >= 3 && album.count <= 100)
            score += 10;

        return score;
    }

    static int YearScore(string value, short year)
    {
        if (year <= 0 || string.IsNullOrWhiteSpace(value))
            return 0;

        var matches = Regex.Matches(
            value,
            @"(?<!\d)(?<from>(?:19|20)\d{2})(?:\s*[-–—/]\s*(?<to>(?:19|20)\d{2}))?(?!\d)",
            RegexOptions.IgnoreCase
        );

        if (matches.Count == 0)
            return 0;

        foreach (Match match in matches)
        {
            if (!int.TryParse(match.Groups["from"].Value, out int from))
                continue;

            int to = from;
            if (match.Groups["to"].Success)
                int.TryParse(match.Groups["to"].Value, out to);

            if (to < from)
                (from, to) = (to, from);

            if (year >= from && year <= to)
                return 80;
        }

        return int.MinValue;
    }

    static bool ContainsAllSignificantWords(string value, string query)
    {
        var words = query
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(i => i.Length >= 3)
            .Distinct()
            .ToArray();

        return words.Length >= 2 && words.All(value.Contains);
    }

    static double EpisodeContinuityRatio(List<ParsedEpisode> parsed)
    {
        var values = parsed
            .Where(i => i.season > 0 && i.episode > 0)
            .GroupBy(i => i.season)
            .Select(g =>
            {
                var episodes = g
                    .Select(i => (int)i.episode)
                    .Distinct()
                    .OrderBy(i => i)
                    .ToList();

                if (episodes.Count == 0)
                    return 0d;

                int maxEpisode = episodes[^1];
                if (maxEpisode <= 0)
                    return 0d;

                return Math.Min(1d, episodes.Count / (double)maxEpisode);
            })
            .ToList();

        return values.Count == 0 ? 0d : values.Average();
    }

    static bool IsSeriesMatch(Video video, string searchTitle, string searchOriginalTitle)
    {
        return MatchSeriesText(video?.title, searchTitle, searchOriginalTitle) ||
               MatchSeriesText(video?.description, searchTitle, searchOriginalTitle);
    }

    static bool MatchSeriesText(string text, string searchTitle, string searchOriginalTitle)
    {
        string value = SearchNameTo.Convert(text);
        if (value == null)
            return false;

        bool Match(string query)
            => !string.IsNullOrWhiteSpace(query) &&
               (value == query || value.StartsWith(query) || value.Contains(query));

        return Match(searchTitle) || Match(searchOriginalTitle);
    }

    static bool IsCompilationVideo(Video video)
    {
        if (video == null)
            return false;

        string value = SearchNameTo.Convert(video.title);

        if (value != null &&
            (value.Contains("все серии") ||
             value.Contains("all episodes") ||
             value.Contains("полный сезон") ||
             value.Contains("полностью")))
        {
            return true;
        }

        string title = video.title ?? string.Empty;

        if (Regex.IsMatch(
            title,
            @"(?i)\b\d{1,2}(?:\s*[,/&]\s*\d{1,2}|\s+и\s+\d{1,2})+[^.]{0,32}\b(?:сезон(?:ы|ов)?|seasons?)\b"))
        {
            return true;
        }

        if (Regex.IsMatch(
            title,
            @"(?i)\b\d{1,2}\s*[-–—]\s*\d{1,2}\s*(?:сезон(?:ы|ов)?|seasons?)\b"))
        {
            return true;
        }

        if (video.duration >= 4 * 60 * 60 &&
            ParseSeason(title) > 0 &&
            !TrySeasonEpisode(title, out _, out _))
        {
            return true;
        }

        return false;
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

        if (video?.playlist_position > 0 &&
            video.playlist_position <= short.MaxValue &&
            !IsCompilationVideo(video))
        {
            season = albumSeasonHint;
            episode = (short)video.playlist_position;
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
