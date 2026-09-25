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
    public async Task<ActionResult> Index(string title, string original_title, short year, byte serial, short s = -1, long owner_id = 0, long album_id = 0, short album_s = 0, bool direct = false, bool rjson = false)
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

        if (direct)
            return await EpisodesDirect(title, original_title, year, s);

        if (owner_id == 0 || album_id <= 0)
            return OnError("album");

        return await Episodes(title, original_title, year, s, owner_id, album_id, album_s);
    }

    async Task<ActionResult> Seasons(string title, string original_title, short year, byte serial, string searchTitle, string searchOriginalTitle, bool rjson)
    {
    rhubFallback:
        var cache = await InvokeCacheResult<List<VideoAlbum>>(ipkey($"vkseries:v11:global:{searchTitle}:{searchOriginalTitle}:{year}"), 20, textJson: true, onget: async e =>
        {
            var albums = await SearchGlobalAlbums(title, original_title, year);
            var seasonAlbums = await DiscoverSeasonAlbums(albums, searchTitle, searchOriginalTitle, year);

            // Global video search is a second discovery channel. It is especially useful
            // when VK does not expose a useful playlist in response.albums.
            var directVideos = await SearchGlobalVideos(title, original_title, year, 0);
            AddDirectSeasons(seasonAlbums, directVideos, searchTitle, searchOriginalTitle, year, 0);

            // response.albums is intentionally small (usually 10 items). Probe only the
            // next two missing seasons so later seasons do not disappear behind old playlists.
            int maxSeason = seasonAlbums
                .Select(i => i.album.season)
                .DefaultIfEmpty(0)
                .Max();

            int probeMax = Math.Min(Math.Max(maxSeason + 2, 3), 12);
            for (short targetSeason = 1; targetSeason <= probeMax; targetSeason++)
            {
                if (seasonAlbums.Any(i => i.album.season == targetSeason))
                    continue;

                var seasonSearchAlbums = await SearchGlobalAlbums(title, original_title, year, targetSeason);
                var discovered = await DiscoverSeasonAlbums(
                    seasonSearchAlbums,
                    searchTitle,
                    searchOriginalTitle,
                    year,
                    targetSeason
                );

                if (discovered.Count > 0)
                {
                    seasonAlbums.AddRange(discovered);
                    continue;
                }

                var seasonVideos = await SearchGlobalVideos(title, original_title, year, targetSeason);
                AddDirectSeasons(
                    seasonAlbums,
                    seasonVideos,
                    searchTitle,
                    searchOriginalTitle,
                    year,
                    targetSeason
                );
            }

            var result = seasonAlbums
                .GroupBy(i => i.album.season)
                .Select(g => g
                    .OrderByDescending(i => i.score)
                    .ThenByDescending(i => i.album.count)
                    .ThenByDescending(i => i.album.updated_time ?? 0)
                    .First()
                    .album)
                .OrderBy(i => i.season)
                .ToList();

            if (result.Count == 0)
                return e.Fail("global season discovery");

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

                bool direct = album.id <= 0 || album.owner_id == 0;
                string source = direct
                    ? "&direct=true"
                    : $"&owner_id={album.owner_id}&album_id={album.id}&album_s={season}";

                stpl.Append(
                    $"{season} сезон",
                    $"{host}/lite/vkseries?title={encTitle}&original_title={encOriginalTitle}&year={year}&serial={serial}&s={season}{source}&rjson={encRjson}",
                    season
                );
            }

            return stpl;
        });
    }

    async Task<List<(VideoAlbum album, int score)>> DiscoverSeasonAlbums(
        List<VideoAlbum> albums,
        string searchTitle,
        string searchOriginalTitle,
        short year,
        short requiredSeason = 0)
    {
        var result = new List<(VideoAlbum album, int score)>();

        if (albums == null || albums.Count == 0)
            return result;

        var candidates = albums
            .Where(i => i != null && i.id > 0 && i.owner_id != 0)
            .Select(i => (album: i, score: AlbumScore(i, searchTitle, searchOriginalTitle, year)))
            .Where(i => i.score >= 140)
            .OrderByDescending(i => i.score)
            .ThenByDescending(i => i.album.count)
            .ThenByDescending(i => i.album.updated_time ?? 0)
            .Take(30)
            .ToList();

        foreach (var candidate in candidates)
        {
            var albumInfo = await GetAlbumById(candidate.album.owner_id, candidate.album.id);
            var nativeSeasons = albumInfo?.series_object?.seasons;

            if (nativeSeasons != null && nativeSeasons.Count > 0)
            {
                foreach (var nativeSeason in nativeSeasons)
                {
                    short season = (short)ParseSeason(nativeSeason.title);
                    if (season <= 0 || nativeSeason.id <= 0)
                        continue;

                    if (requiredSeason > 0 && season != requiredSeason)
                        continue;

                    result.Add((new VideoAlbum
                    {
                        id = nativeSeason.id,
                        owner_id = nativeSeason.owner_id != 0 ? nativeSeason.owner_id : candidate.album.owner_id,
                        title = $"{candidate.album.title} {nativeSeason.title}",
                        count = nativeSeason.count,
                        updated_time = candidate.album.updated_time,
                        season = season
                    }, candidate.score + 200));
                }

                continue;
            }

            short seasonHint = (short)ParseSeason(candidate.album.title);
            if (requiredSeason > 0 && seasonHint > 0 && seasonHint != requiredSeason)
                continue;

            var videos = await GetAlbumVideos(candidate.album.owner_id, candidate.album.id);
            if (videos == null || videos.Count == 0)
                continue;

            var scopedVideos = videos
                .Where(i => SeriesVideoScore(i, searchTitle, searchOriginalTitle, year) >= 120)
                .ToList();

            // Exact/strong playlist titles are allowed to carry episodes whose titles omit
            // the show name. Weak substring playlist matches are not.
            if (scopedVideos.Count == 0 && candidate.score >= 180)
                scopedVideos = videos;

            var parsed = ParseVideos(scopedVideos, seasonHint)
                .Where(i => requiredSeason <= 0 || i.season == requiredSeason)
                .ToList();

            foreach (short season in parsed
                .Select(i => i.season)
                .Where(i => i > 0)
                .Distinct())
            {
                int playableEpisodes = parsed.Count(i => i.season == season);
                if (playableEpisodes == 0)
                    continue;

                result.Add((new VideoAlbum
                {
                    id = candidate.album.id,
                    owner_id = candidate.album.owner_id,
                    title = candidate.album.title,
                    count = Math.Max(candidate.album.count, playableEpisodes),
                    updated_time = candidate.album.updated_time,
                    season = season
                }, candidate.score + Math.Min(playableEpisodes * 4, 80)));
            }
        }

        return result;
    }

    static void AddDirectSeasons(
        List<(VideoAlbum album, int score)> target,
        List<Video> videos,
        string searchTitle,
        string searchOriginalTitle,
        short year,
        short seasonHint)
    {
        if (videos == null || videos.Count == 0)
            return;

        var parsed = ParseVideos(
                videos.Where(i => SeriesVideoScore(i, searchTitle, searchOriginalTitle, year) >= 150),
                seasonHint)
            .ToList();

        foreach (var group in parsed.GroupBy(i => i.season))
        {
            if (group.Key <= 0 || target.Any(i => i.album.season == group.Key))
                continue;

            int count = group.Select(i => i.episode).Distinct().Count();
            if (count == 0)
                continue;

            target.Add((new VideoAlbum
            {
                id = 0,
                owner_id = 0,
                title = "VK global search",
                count = count,
                season = group.Key
            }, 150 + Math.Min(count * 5, 80)));
        }
    }

    async Task<ActionResult> Episodes(string title, string original_title, short year, short season, long ownerId, long albumId, short albumSeasonHint)
    {
    rhubFallback:
        var cache = await InvokeCacheResult<List<Video>>(ipkey($"vkseries:v11:album:{ownerId}:{albumId}"), 20, textJson: true, onget: async e =>
        {
            var videos = await GetAlbumVideos(ownerId, albumId);
            if (videos == null || videos.Count == 0)
                return e.Fail("album videos");

            return e.Success(videos);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        string searchTitle = SearchNameTo.Convert(title);
        string searchOriginalTitle = SearchNameTo.Convert(original_title);
        var directVideos = await SearchGlobalVideos(title, original_title, year, season);

        return ContentTpl(cache, () =>
        {
            var scopedAlbumVideos = cache.Value
                .Where(i => SeriesVideoScore(i, searchTitle, searchOriginalTitle, year) >= 120)
                .ToList();

            if (scopedAlbumVideos.Count == 0)
                scopedAlbumVideos = cache.Value;

            var albumParsed = ParseVideos(scopedAlbumVideos, albumSeasonHint)
                .Where(i => i.season == season);

            var directParsed = ParseVideos(
                    (directVideos ?? new List<Video>())
                        .Where(i => SeriesVideoScore(i, searchTitle, searchOriginalTitle, year) >= 150),
                    season)
                .Where(i => i.season == season);

            var parsed = albumParsed
                .Concat(directParsed)
                .GroupBy(i => i.episode)
                .Select(g => g
                    .OrderByDescending(i => SeriesVideoScore(i.video, searchTitle, searchOriginalTitle, year))
                    .ThenByDescending(i => QualityScore(i.video.files))
                    .ThenByDescending(i => i.video.duration)
                    .ThenByDescending(i => i.video.views ?? 0)
                    .First())
                .OrderBy(i => i.episode)
                .ToList();

            return BuildEpisodeTpl(parsed, title ?? original_title, season);
        });
    }

    async Task<ActionResult> EpisodesDirect(string title, string original_title, short year, short season)
    {
    rhubFallback:
        string searchTitle = SearchNameTo.Convert(title);
        string searchOriginalTitle = SearchNameTo.Convert(original_title);

        var cache = await InvokeCacheResult<List<Video>>(ipkey($"vkseries:v11:direct:{searchTitle}:{searchOriginalTitle}:{year}:{season}"), 20, textJson: true, onget: async e =>
        {
            var videos = await SearchGlobalVideos(title, original_title, year, season);
            if (videos == null || videos.Count == 0)
                return e.Fail("global videos");

            return e.Success(videos);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        return ContentTpl(cache, () =>
        {
            var parsed = ParseVideos(
                    cache.Value.Where(i => SeriesVideoScore(i, searchTitle, searchOriginalTitle, year) >= 150),
                    season)
                .Where(i => i.season == season)
                .GroupBy(i => i.episode)
                .Select(g => g
                    .OrderByDescending(i => SeriesVideoScore(i.video, searchTitle, searchOriginalTitle, year))
                    .ThenByDescending(i => QualityScore(i.video.files))
                    .ThenByDescending(i => i.video.duration)
                    .ThenByDescending(i => i.video.views ?? 0)
                    .First())
                .OrderBy(i => i.episode)
                .ToList();

            return BuildEpisodeTpl(parsed, title ?? original_title, season);
        });
    }

    EpisodeTpl BuildEpisodeTpl(List<ParsedEpisode> parsed, string seriesTitle, short season)
    {
        var etpl = new EpisodeTpl(parsed.Count);

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
    }

    async Task<List<VideoAlbum>> SearchGlobalAlbums(string title, string originalTitle, short year, short season = 0)
    {
        string keyTitle = SearchNameTo.Convert(title);
        string keyOriginal = SearchNameTo.Convert(originalTitle);

        return await InvokeCache<List<VideoAlbum>>(ipkey($"vkseries:v11:search:albums:{keyTitle}:{keyOriginal}:{year}:{season}"), 20, async () =>
        {
            var result = new List<VideoAlbum>();

            foreach (string query in BuildSearchQueries(title, originalTitle, year, season, albums: true))
            {
                var root = await SearchCatalog(query);
                if (root?.error != null || root?.response?.albums == null)
                    continue;

                result.AddRange(root.response.albums);
            }

            return result
                .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                .GroupBy(i => $"{i.owner_id}:{i.id}")
                .Select(g => g
                    .OrderByDescending(i => i.updated_time ?? 0)
                    .First())
                .ToList();
        });
    }

    async Task<List<Video>> SearchGlobalVideos(string title, string originalTitle, short year, short season)
    {
        string keyTitle = SearchNameTo.Convert(title);
        string keyOriginal = SearchNameTo.Convert(originalTitle);

        return await InvokeCache<List<Video>>(ipkey($"vkseries:v11:search:videos:{keyTitle}:{keyOriginal}:{year}:{season}"), 20, async () =>
        {
            var result = new List<Video>();

            foreach (string query in BuildSearchQueries(title, originalTitle, year, season, albums: false))
            {
                var root = await SearchCatalog(query);
                if (root?.error != null || root?.response == null)
                    continue;

                if (root.response.catalog_videos != null)
                {
                    result.AddRange(root.response.catalog_videos
                        .Where(i => i?.video != null)
                        .Select(i => i.video));
                }

                if (root.response.videos != null)
                    result.AddRange(root.response.videos.Where(i => i != null));
            }

            return result
                .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                .GroupBy(i => $"{i.owner_id}:{i.id}")
                .Select(g => g
                    .OrderByDescending(i => QualityScore(i.files))
                    .First())
                .ToList();
        });
    }

    async Task<Root> SearchCatalog(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
            return null;

        string url = $"{init.host}/method/catalog.getVideoSearchWeb2?v=5.264&client_id={client_id}";
        string data =
            $"screen_ref=search_video_service&input_method=keyboard_search_button&count=50&q={HttpUtility.UrlEncode(query)}&access_token={access_token}";

        return await httpHydra.Post<Root>(url, data, textJson: true);
    }

    static List<string> BuildSearchQueries(string title, string originalTitle, short year, short season, bool albums)
    {
        var queries = new List<string>();

        void Add(string value)
        {
            if (!string.IsNullOrWhiteSpace(value) &&
                !queries.Any(i => string.Equals(i, value, StringComparison.OrdinalIgnoreCase)))
            {
                queries.Add(value.Trim());
            }
        }

        foreach (string name in new[] { title, originalTitle })
        {
            if (string.IsNullOrWhiteSpace(name))
                continue;

            if (season > 0)
            {
                Add($"{name} {season} сезон");
                Add($"{name} сезон {season}");
                if (year > 0)
                    Add($"{name} {year} {season} сезон");
            }
            else
            {
                Add(name);
                if (year > 0)
                    Add($"{name} {year}");

                if (albums)
                {
                    Add($"{name} сезон");
                    Add($"{name} сериал");
                }
            }
        }

        return queries.Take(6).ToList();
    }

    async Task<VideoAlbum> GetAlbumById(long ownerId, long albumId)
    {
        return await InvokeCache<VideoAlbum>(ipkey($"vkseries:v11:albuminfo:{ownerId}:{albumId}"), 20, async () =>
        {
            string url = $"{init.host}/method/video.getAlbumById?v=5.264&client_id={client_id}";
            string data = $"owner_id={ownerId}&album_id={albumId}&access_token={access_token}";

            var root = await httpHydra.Post<VideoAlbumRoot>(url, data, textJson: true);
            if (root?.error != null)
                return null;

            return root?.response;
        });
    }

    async Task<List<Video>> GetAlbumVideos(long ownerId, long albumId)
    {
        return await InvokeCache<List<Video>>(ipkey($"vkseries:v11:album:{ownerId}:{albumId}"), 20, async () =>
        {
            const int pageSize = 200;

            // VK's web player uses video.getFromAlbum for normal playlists too, not only
            // for the native serial owner. It also provides playlist_position.
            var fromAlbum = new List<Video>();
            int offset = 0;
            int total = int.MaxValue;

            while (offset < total)
            {
                string url = $"{init.host}/method/video.getFromAlbum?v=5.264&client_id={client_id}";
                string data = $"owner_id={ownerId}&album_id={albumId}&count={pageSize}&offset={offset}&extended=1&access_token={access_token}";

                var root = await httpHydra.Post<VideoFromAlbumRoot>(url, data, textJson: true);
                if (root?.error != null || root?.response == null)
                {
                    fromAlbum.Clear();
                    break;
                }

                var items = root.response.items;
                total = root.response.count;

                if (items == null || items.Count == 0)
                    break;

                foreach (var item in items)
                {
                    if (item?.video == null)
                        continue;

                    item.video.playlist_position = item.playlist_position;
                    fromAlbum.Add(item.video);
                }

                int nextOffset = offset + items.Count;
                if (nextOffset <= offset)
                    break;

                offset = nextOffset;

                if (items.Count < pageSize)
                    break;
            }

            if (fromAlbum.Count > 0)
            {
                return fromAlbum
                    .Where(i => i != null && i.id > 0 && i.owner_id != 0)
                    .GroupBy(i => $"{i.owner_id}:{i.id}")
                    .Select(g => g.First())
                    .ToList();
            }

            // Legacy fallback for playlists where getFromAlbum is unavailable.
            var videos = new List<Video>();
            int legacyOffset = 0;
            int legacyTotal = int.MaxValue;

            while (legacyOffset < legacyTotal)
            {
                string url = $"{init.host}/method/video.get?v=5.264&client_id={client_id}";
                string data = $"owner_id={ownerId}&album_id={albumId}&count={pageSize}&offset={legacyOffset}&sort_album=1&extended=1&access_token={access_token}";

                var root = await httpHydra.Post<VideoGetRoot>(url, data, textJson: true);
                if (root?.error != null || root?.response == null)
                    return null;

                var items = root.response.items;
                legacyTotal = root.response.count;

                if (items == null || items.Count == 0)
                    break;

                videos.AddRange(items);

                int nextOffset = legacyOffset + items.Count;
                if (nextOffset <= legacyOffset)
                    break;

                legacyOffset = nextOffset;

                if (items.Count < pageSize)
                    break;
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

    static bool IsSeriesVideo(Video video, string searchTitle, string searchOriginalTitle)
    {
        if (video == null)
            return false;

        bool Match(string value, string query)
        {
            if (string.IsNullOrWhiteSpace(value) || string.IsNullOrWhiteSpace(query))
                return false;

            return value.Contains(query);
        }

        string title = SearchNameTo.Convert(video.title);
        string description = SearchNameTo.Convert(video.description);

        return Match(title, searchTitle) ||
               Match(title, searchOriginalTitle) ||
               Match(description, searchTitle) ||
               Match(description, searchOriginalTitle);
    }

    static int SeriesVideoScore(Video video, string searchTitle, string searchOriginalTitle, short year)
    {
        if (video == null)
            return 0;

        string value = SearchNameTo.Convert(video.title);
        string description = SearchNameTo.Convert(video.description);
        int score = 0;

        void Match(string query)
        {
            if (string.IsNullOrWhiteSpace(query))
                return;

            if (!string.IsNullOrWhiteSpace(value))
            {
                if (value == query)
                    score = Math.Max(score, 220);
                else if (value.StartsWith(query))
                    score = Math.Max(score, 180);
                else if (value.Contains(query))
                    score = Math.Max(score, 120);
            }

            if (!string.IsNullOrWhiteSpace(description) && description.Contains(query))
                score = Math.Max(score, 90);
        }

        Match(searchTitle);
        Match(searchOriginalTitle);

        if (score == 0)
            return 0;

        string raw = $"{video.title} {video.description}";
        if (year > 0)
        {
            if (raw.Contains(year.ToString()))
                score += 30;
            else if (Regex.IsMatch(raw, @"\b(?:19|20)\d{2}\b"))
                score -= 80;
        }

        return score;
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
                score -= 80;
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
            @"(?i)\b(?<s>\d{1,2})\s*(?:-?й\s*)?(?:сезон|season)\b",
            @"(?i)\b(?:сезон|season)\s*[№#]?\s*(?<s>\d{1,2})\b",
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

            if (video?.playlist_position > 0 && video.playlist_position <= 999)
            {
                season = (short)explicitSeason;
                episode = (short)video.playlist_position;
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

        if (video?.playlist_position > 0 && video.playlist_position <= 999)
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
