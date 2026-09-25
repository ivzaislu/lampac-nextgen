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

        if (!await EnsureAnonymToken(init))
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
        var cache = await InvokeCacheResult<List<VideoAlbum>>(ipkey($"vkseries:v20:global:{searchTitle}:{searchOriginalTitle}:{year}"), 20, textJson: true, onget: async e =>
        {
            var albums = await SearchGlobalAlbums(title, original_title, year);
            albums = await ExpandDiscoveredOwnerAlbums(
                albums,
                searchTitle,
                searchOriginalTitle,
                year
            );

            var seasonAlbums = await DiscoverSeasonAlbums(albums, searchTitle, searchOriginalTitle, year);

            // response.albums is small. Global video results provide an independent
            // fallback and also reveal seasons whose playlist did not make the album list.
            var directVideos = await SearchGlobalVideos(title, original_title, year, 0);
            AddDirectSeasons(seasonAlbums, directVideos, searchTitle, searchOriginalTitle, year, 0);

            // Fill gaps iteratively. Every targeted global hit is expanded through its
            // dynamically discovered owner, so one lookup can reveal many adjacent seasons.
            // The budget bounds worst-case traffic while still supporting long-running shows.
            var attemptedSeasons = new HashSet<short>();

            for (int attempt = 0; attempt < 12; attempt++)
            {
                int maxSeason = seasonAlbums
                    .Select(i => i.album.season)
                    .DefaultIfEmpty(0)
                    .Max();

                int scanMax = maxSeason > 0
                    ? Math.Min(Math.Max(maxSeason + 2, 3), 50)
                    : 12;

                short targetSeason = Enumerable.Range(1, scanMax)
                    .Select(i => (short)i)
                    .FirstOrDefault(i =>
                        !attemptedSeasons.Contains(i) &&
                        !seasonAlbums.Any(x => x.album.season == i));

                if (targetSeason <= 0)
                    break;

                attemptedSeasons.Add(targetSeason);

                var extraAlbums = await SearchGlobalAlbums(title, original_title, year, targetSeason);
                extraAlbums = await ExpandDiscoveredOwnerAlbums(
                    extraAlbums,
                    searchTitle,
                    searchOriginalTitle,
                    year
                );

                var extra = await DiscoverSeasonAlbums(
                    extraAlbums,
                    searchTitle,
                    searchOriginalTitle,
                    year,
                    targetSeason
                );

                if (extra.Count > 0)
                {
                    seasonAlbums.AddRange(extra);
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
                    .ThenByDescending(i => i.episodes)
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

    async Task<List<(VideoAlbum album, int score, int episodes)>> DiscoverSeasonAlbums(
        List<VideoAlbum> albums,
        string searchTitle,
        string searchOriginalTitle,
        short year,
        short requiredSeason = 0)
    {
        var result = new List<(VideoAlbum album, int score, int episodes)>();

        if (albums == null || albums.Count == 0)
            return result;

        var scoredCandidates = albums
            .Where(i => i != null && i.id > 0 && i.owner_id != 0)
            .Select(i =>
            {
                int score = AlbumScore(i, searchTitle, searchOriginalTitle, year);
                if (score == 0 && i.context_verified && IsGenericSeasonAlbum(i))
                    score = 850 + Math.Min(i.count, 30);

                bool multiSeason = IsMultiSeasonAlbumTitle(i.title);
                if (multiSeason)
                    score = Math.Max(1, score - 200);

                return (
                    album: i,
                    score,
                    season: (short)(multiSeason ? 0 : ParseSeason(i.title))
                );
            })
            .Where(i => i.score > 0)
            .Where(i => requiredSeason <= 0 || i.season == 0 || i.season == requiredSeason)
            .ToList();

        // Do not let several copies of early seasons consume a global Take(N) budget.
        // Keep a small number of alternatives per concrete season, plus a few parent
        // albums without an explicit season because those may expose series_object.
        var candidates = scoredCandidates
            .Where(i => i.season > 0)
            .GroupBy(i => i.season)
            .SelectMany(g => g
                .OrderByDescending(i => i.score)
                .ThenByDescending(i => i.album.count)
                .ThenByDescending(i => i.album.updated_time ?? 0)
                .Take(requiredSeason > 0 ? 6 : 2))
            .Concat(
                scoredCandidates
                    .Where(i => i.season <= 0)
                    .OrderByDescending(i => i.score)
                    .ThenByDescending(i => i.album.count)
                    .ThenByDescending(i => i.album.updated_time ?? 0)
                    .Take(8)
            )
            .OrderByDescending(i => i.score)
            .ThenBy(i => i.season <= 0 ? short.MaxValue : i.season)
            .ThenByDescending(i => i.album.count)
            .ToList();

        foreach (var candidate in candidates)
        {
            // Native series hierarchy is normally attached to a parent album.
            // Explicit "N season" playlists can go straight to getFromAlbum;
            // this avoids one network request per season on long-running shows.
            var nativeSeasons = candidate.album.series_object?.seasons;

            if ((nativeSeasons == null || nativeSeasons.Count == 0) &&
                candidate.season <= 0)
            {
                var albumInfo = await GetAlbumById(
                    candidate.album.owner_id,
                    candidate.album.id
                );

                nativeSeasons = albumInfo?.series_object?.seasons;
            }

            if (nativeSeasons != null && nativeSeasons.Count > 0)
            {
                int addedNative = 0;

                foreach (var nativeSeason in nativeSeasons)
                {
                    short season = (short)ParseSeason(nativeSeason.title);
                    if (season <= 0 || nativeSeason.id <= 0)
                        continue;

                    if (requiredSeason > 0 && season != requiredSeason)
                        continue;

                    long seasonOwner = nativeSeason.owner_id != 0
                        ? nativeSeason.owner_id
                        : candidate.album.owner_id;

                    var seasonVideos = await GetAlbumVideos(seasonOwner, nativeSeason.id);
                    var parsedNative = ParseVideos(seasonVideos ?? new List<Video>(), season)
                        .Where(i => i.season == season)
                        .ToList();

                    int episodeCount = parsedNative
                        .Select(i => i.episode)
                        .Distinct()
                        .Count();

                    if (episodeCount == 0)
                        continue;

                    int quality = parsedNative
                        .Select(i => QualityScore(i.video?.files))
                        .DefaultIfEmpty(0)
                        .Max();

                    result.Add((new VideoAlbum
                    {
                        id = nativeSeason.id,
                        owner_id = seasonOwner,
                        title = $"{candidate.album.title} {nativeSeason.title}",
                        count = Math.Max(nativeSeason.count, episodeCount),
                        updated_time = candidate.album.updated_time,
                        season = season
                    }, candidate.score + 500 + Math.Min(episodeCount, 30) * 10 + quality * 3 + EpisodeDurationScore(parsedNative), episodeCount));

                    addedNative++;
                }

                if (addedNative > 0)
                    continue;
            }

            short seasonHint = (short)ParseSeason(candidate.album.title);
            if (requiredSeason > 0 && seasonHint > 0 && seasonHint != requiredSeason)
                continue;

            var videos = await GetAlbumVideos(candidate.album.owner_id, candidate.album.id);
            if (videos == null || videos.Count == 0)
                continue;

            var parsed = ParseVideos(videos, seasonHint)
                .Where(i => requiredSeason <= 0 || i.season == requiredSeason)
                .ToList();

            foreach (var group in parsed.GroupBy(i => i.season).Where(g => g.Key > 0))
            {
                int episodeCount = group.Select(i => i.episode).Distinct().Count();
                if (episodeCount == 0)
                    continue;

                // A parent album can contain promos, clips and unrelated numbered
                // videos. Without an explicit season in the album title, require
                // a real cluster of full episodes before inferring a season.
                if (candidate.season <= 0 &&
                    !IsConfidentEpisodeSet(group, minEpisodes: 3, minMedianSeconds: 8 * 60))
                {
                    continue;
                }

                int quality = group
                    .Select(i => QualityScore(i.video?.files))
                    .DefaultIfEmpty(0)
                    .Max();

                result.Add((new VideoAlbum
                {
                    id = candidate.album.id,
                    owner_id = candidate.album.owner_id,
                    title = candidate.album.title,
                    count = Math.Max(candidate.album.count, episodeCount),
                    updated_time = candidate.album.updated_time,
                    season = group.Key
                }, candidate.score + Math.Min(episodeCount, 30) * 10 + quality * 3 + EpisodeDurationScore(group), episodeCount));
            }
        }

        return result;
    }

    static void AddDirectSeasons(
        List<(VideoAlbum album, int score, int episodes)> target,
        List<Video> videos,
        string searchTitle,
        string searchOriginalTitle,
        short year,
        short seasonHint)
    {
        if (videos == null || videos.Count == 0)
            return;

        var parsed = ParseTrustedDirectVideos(
            videos,
            searchTitle,
            searchOriginalTitle,
            year,
            seasonHint
        );

        foreach (var group in parsed.GroupBy(i => i.season))
        {
            if (group.Key <= 0 || target.Any(i => i.album.season == group.Key))
                continue;

            int count = group.Select(i => i.episode).Distinct().Count();
            if (count < 3)
                continue;

            int quality = group
                .Select(i => QualityScore(i.video?.files))
                .DefaultIfEmpty(0)
                .Max();

            target.Add((new VideoAlbum
            {
                id = 0,
                owner_id = 0,
                title = "VK global search",
                count = count,
                season = group.Key
            }, 300 + Math.Min(count, 30) * 10 + quality * 3 + EpisodeDurationScore(group), count));
        }
    }

    async Task<ActionResult> Episodes(string title, string original_title, short year, short season, long ownerId, long albumId, short albumSeasonHint)
    {
    rhubFallback:
        // Keep the rendered cache separate from the raw album cache.
        var cache = await InvokeCacheResult<List<Video>>(ipkey($"vkseries:v20:episodes:{ownerId}:{albumId}:{season}"), 20, textJson: true, onget: async e =>
        {
            var videos = await GetAlbumVideos(ownerId, albumId);
            if (videos == null || videos.Count == 0)
                return e.Fail("video album");

            return e.Success(videos);
        });

        if (IsRhubFallback(cache))
            goto rhubFallback;

        string searchTitle = SearchNameTo.Convert(title);
        string searchOriginalTitle = SearchNameTo.Convert(original_title);
        var directVideos = await SearchGlobalVideos(title, original_title, year, season);

        return ContentTpl(cache, () =>
        {
            var scopedVideos = cache.Value
                .Where(i => IsSeriesVideo(i, searchTitle, searchOriginalTitle))
                .ToList();

            var albumParsed = ParseVideos(scopedVideos.Count > 0 ? scopedVideos : cache.Value, albumSeasonHint)
                .Where(i => i.season == season);

            var directParsed = ParseTrustedDirectVideos(
                    directVideos ?? new List<Video>(),
                    searchTitle,
                    searchOriginalTitle,
                    year,
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

        var cache = await InvokeCacheResult<List<Video>>(ipkey($"vkseries:v20:direct:{searchTitle}:{searchOriginalTitle}:{year}:{season}"), 20, textJson: true, onget: async e =>
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
            var parsed = ParseTrustedDirectVideos(
                    cache.Value,
                    searchTitle,
                    searchOriginalTitle,
                    year,
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

        return await InvokeCache<List<VideoAlbum>>(ipkey($"vkseries:v20:search:albums:{keyTitle}:{keyOriginal}:{year}:{season}"), 20, async () =>
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
                .Select(g => g.OrderByDescending(i => i.updated_time ?? 0).First())
                .ToList();
        });
    }

    async Task<List<VideoAlbum>> ExpandDiscoveredOwnerAlbums(
        List<VideoAlbum> seedAlbums,
        string searchTitle,
        string searchOriginalTitle,
        short year)
    {
        if (seedAlbums == null || seedAlbums.Count == 0)
            return seedAlbums ?? new List<VideoAlbum>();

        var result = new List<VideoAlbum>(seedAlbums);
        var ownerScores = new Dictionary<long, int>();
        var contextualOwners = new HashSet<long>();

        foreach (var seed in seedAlbums.Where(i => i != null && i.owner_id != 0))
        {
            int score = AlbumScore(seed, searchTitle, searchOriginalTitle, year);
            if (score > 0)
            {
                int ownerScore = score + Math.Min(seed.count, 30);
                if (!ownerScores.TryGetValue(seed.owner_id, out int current) || ownerScore > current)
                    ownerScores[seed.owner_id] = ownerScore;
            }
        }

        // VK search sometimes returns a correct album named only "9 Сезон".
        // Such a title has no series identity, so verify the content before trusting
        // its owner. This is generic: no owner id or show name is hard-coded.
        var genericSeeds = seedAlbums
            .Where(i => i != null &&
                        i.owner_id != 0 &&
                        AlbumScore(i, searchTitle, searchOriginalTitle, year) == 0 &&
                        IsGenericSeasonAlbum(i))
            .OrderByDescending(i => i.count)
            .ThenByDescending(i => i.updated_time ?? 0)
            .Take(8)
            .ToList();

        foreach (var seed in genericSeeds)
        {
            if (!await ValidateGenericSeasonAlbum(seed, searchTitle, searchOriginalTitle, year))
                continue;

            seed.context_verified = true;
            contextualOwners.Add(seed.owner_id);

            if (!ownerScores.TryGetValue(seed.owner_id, out int current) || current < 850)
                ownerScores[seed.owner_id] = 850;
        }

        var owners = ownerScores
            .OrderByDescending(i => i.Value)
            .Take(8)
            .Select(i => i.Key)
            .ToList();

        foreach (long ownerId in owners)
        {
            var ownerAlbums = await GetDiscoveredOwnerAlbums(ownerId);
            if (ownerAlbums == null || ownerAlbums.Count == 0)
                continue;

            bool contextual = contextualOwners.Contains(ownerId);
            var genericSiblings = contextual
                ? ownerAlbums
                    .Where(IsGenericSeasonAlbum)
                    .OrderByDescending(i => i.count)
                    .ThenByDescending(i => i.updated_time ?? 0)
                    .ToList()
                : new List<VideoAlbum>();

            // A single validated "9 season" is not enough to trust every nameless
            // season on a mixed owner. Require content confirmation from at least two
            // different season albums before promoting all generic siblings.
            int verifiedGenericSiblings = 0;

            if (contextual &&
                genericSiblings.Count >= 3 &&
                genericSiblings.Count * 2 >= ownerAlbums.Count)
            {
                foreach (var sibling in genericSiblings.Take(6))
                {
                    if (!await ValidateGenericSeasonAlbum(
                        sibling,
                        searchTitle,
                        searchOriginalTitle,
                        year))
                    {
                        continue;
                    }

                    verifiedGenericSiblings++;
                    if (verifiedGenericSiblings >= 2)
                        break;
                }
            }

            bool allowGenericSiblings = verifiedGenericSiblings >= 2;

            foreach (var album in ownerAlbums)
            {
                if (AlbumScore(album, searchTitle, searchOriginalTitle, year) > 0)
                {
                    result.Add(album);
                    continue;
                }

                if (allowGenericSiblings && IsGenericSeasonAlbum(album))
                {
                    album.context_verified = true;
                    result.Add(album);
                }
            }
        }

        return result
            .Where(i => i != null && i.id > 0 && i.owner_id != 0)
            .GroupBy(i => $"{i.owner_id}:{i.id}")
            .Select(g => g
                .OrderByDescending(i => i.context_verified)
                .ThenByDescending(i => i.updated_time ?? 0)
                .First())
            .ToList();
    }

    async Task<bool> ValidateGenericSeasonAlbum(
        VideoAlbum album,
        string searchTitle,
        string searchOriginalTitle,
        short year)
    {
        if (!IsGenericSeasonAlbum(album))
            return false;

        var videos = await GetAlbumVideos(album.owner_id, album.id);
        if (videos == null || videos.Count == 0)
            return false;

        int checkedCount = 0;
        int identityHits = 0;

        foreach (var video in videos.Take(12))
        {
            if (video == null)
                continue;

            checkedCount++;

            if (SeriesVideoScore(video, searchTitle, searchOriginalTitle, year) >= 900)
                identityHits++;

            if (identityHits >= 2)
                return true;
        }

        // Small playlists can still establish identity with one strong matching video.
        return identityHits == 1 && checkedCount <= 2;
    }

    async Task<List<VideoAlbum>> GetDiscoveredOwnerAlbums(long ownerId)
    {
        return await InvokeCache<List<VideoAlbum>>(ipkey($"vkseries:v20:owner:{ownerId}:albums"), 60, async () =>
        {
            const int pageSize = 100;
            var albums = new List<VideoAlbum>();
            int offset = 0;
            int total = int.MaxValue;

            while (offset < total && offset < 5000)
            {
                string url = $"{init.host}/method/video.getAlbums?v=5.264&client_id={client_id}";
                string data =
                    $"owner_id={ownerId}&count={pageSize}&offset={offset}&extended=1&need_system=0&access_token={access_token}";

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

    async Task<List<Video>> SearchGlobalVideos(string title, string originalTitle, short year, short season)
    {
        string keyTitle = SearchNameTo.Convert(title);
        string keyOriginal = SearchNameTo.Convert(originalTitle);

        return await InvokeCache<List<Video>>(ipkey($"vkseries:v20:search:videos:{keyTitle}:{keyOriginal}:{year}:{season}"), 20, async () =>
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

        string normalized = SearchNameTo.Convert(query);
        if (string.IsNullOrWhiteSpace(normalized))
            normalized = query.Trim().ToLowerInvariant();

        // One catalog response contains both response.albums and video results.
        // Cache it at the query level so album discovery and direct fallback do not
        // send the same VK search request twice.
        return await InvokeCache<Root>(ipkey($"vkseries:v20:catalog:{normalized}"), 5, async () =>
        {
            string url = $"{init.host}/method/catalog.getVideoSearchWeb2?v=5.264&client_id={client_id}";
            string data =
                $"screen_ref=search_video_service&input_method=keyboard_search_button&extended=1&count=50&q={HttpUtility.UrlEncode(query)}&access_token={access_token}";

            var root = await httpHydra.Post<Root>(url, data, textJson: true);
            return root?.error == null ? root : null;
        });
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

        IEnumerable<string> NameVariants(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                yield break;

            string original = Regex.Replace(value.Trim(), @"\s+", " ");
            yield return original;

            string noYo = original
                .Replace('ё', 'е')
                .Replace('Ё', 'Е');

            if (!string.Equals(noYo, original, StringComparison.Ordinal))
                yield return noYo;

            string noDash = Regex.Replace(noYo, @"[-–—]+", " ");
            noDash = Regex.Replace(noDash, @"\s+", " ").Trim();

            if (!string.Equals(noDash, original, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(noDash, noYo, StringComparison.OrdinalIgnoreCase))
            {
                yield return noDash;
            }
        }

        foreach (string rawName in new[] { title, originalTitle })
        {
            foreach (string name in NameVariants(rawName))
            {
                bool cyrillic = Regex.IsMatch(name, @"[А-Яа-яЁё]");

                if (season > 0)
                {
                    if (cyrillic)
                    {
                        Add($"{name} {season} сезон");
                        Add($"{name} сезон {season}");
                    }
                    else
                    {
                        Add($"{name} season {season}");
                        Add($"{name} S{season:00}");
                    }

                    if (year > 0)
                        Add($"{name} {year} {(cyrillic ? $"{season} сезон" : $"season {season}")}");
                }
                else
                {
                    Add(name);

                    if (year > 0)
                        Add($"{name} {year}");

                    if (albums)
                    {
                        Add(cyrillic ? $"{name} сезон" : $"{name} season");
                        Add(cyrillic ? $"{name} сериал" : $"{name} series");
                    }
                }
            }
        }

        return queries.Take(10).ToList();
    }

    async Task<VideoAlbum> GetAlbumById(long ownerId, long albumId)
    {
        return await InvokeCache<VideoAlbum>(ipkey($"vkseries:v20:albuminfo:{ownerId}:{albumId}"), 20, async () =>
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
        return await InvokeCache<List<Video>>(ipkey($"vkseries:v20:album:{ownerId}:{albumId}"), 20, async () =>
        {
            const int pageSize = 200;

            // getFromAlbum is the native VK Video playlist endpoint and works for
            // ordinary public albums as well as nested series seasons.
            var fromAlbum = new List<Video>();
            int offset = 0;
            int total = int.MaxValue;

            while (offset < total && offset < 5000)
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

            // Compatibility fallback for albums that do not support getFromAlbum.
            var videos = new List<Video>();
            int legacyOffset = 0;
            int legacyTotal = int.MaxValue;

            while (legacyOffset < legacyTotal && legacyOffset < 5000)
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

        var candidates = (videos ?? Enumerable.Empty<Video>())
            .Where(video =>
                video != null &&
                !IsNoise(video.title) &&
                !IsNoise(video.description) &&
                !IsMomentVideo(video) &&
                !IsCompilationVideo(video, albumSeasonHint) &&
                QualityScore(video.files) > 0)
            .ToList();

        // playlist_position is useful for season playlists with generic filenames,
        // but a one-file playlist is ambiguous and is very often the whole season
        // concatenated into one video. Never turn that into a fake "episode 1".
        bool allowPlaylistPositionFallback = candidates.Count >= 2;

        foreach (var video in candidates)
        {
            if (!TryParseEpisode(
                video,
                albumSeasonHint,
                allowPlaylistPositionFallback,
                out short season,
                out short episode))
            {
                continue;
            }

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
        if (value == null)
            return 0;

        int score = Math.Max(
            Math.Max(
                SeriesIdentityScore(value, searchTitle),
                SeriesIdentityScore(value, searchOriginalTitle)
            ),
            SeriesPairIdentityScore(value, searchTitle, searchOriginalTitle)
        );

        if (score == 0)
            return 0;

        string raw = $"{video.title} {video.description}";
        var years = Regex.Matches(raw, @"\b(?:19|20)\d{2}\b")
            .Cast<Match>()
            .Select(i => i.Value)
            .Distinct()
            .ToList();

        if (year > 0 && years.Count > 0)
        {
            int season = ParseSeason(raw);

            if (season <= 1)
            {
                if (!years.Contains(year.ToString()))
                    return 0;

                score += 50;
            }
            else if (years.Contains(year.ToString()))
            {
                score += 20;
            }
        }

        return score;
    }

    static int AlbumScore(VideoAlbum album, string searchTitle, string searchOriginalTitle, short year)
    {
        string value = SearchNameTo.Convert(album?.title);
        if (value == null)
            return 0;

        int score = Math.Max(
            Math.Max(
                SeriesIdentityScore(value, searchTitle),
                SeriesIdentityScore(value, searchOriginalTitle)
            ),
            SeriesPairIdentityScore(value, searchTitle, searchOriginalTitle)
        );

        if (score == 0)
            return 0;

        string rawTitle = album?.title ?? string.Empty;
        var years = Regex.Matches(rawTitle, @"\b(?:19|20)\d{2}\b")
            .Cast<Match>()
            .Select(i => i.Value)
            .Distinct()
            .ToList();

        if (year > 0 && years.Count > 0)
        {
            int season = ParseSeason(rawTitle);

            // The request year is the show's premiere year. Later VK season playlists
            // often carry their own air year, so a mismatch is only disqualifying when
            // the album is season 1 or does not identify a later season.
            if (season <= 1)
            {
                if (!years.Contains(year.ToString()))
                    return 0;

                score += 50;
            }
            else if (years.Contains(year.ToString()))
            {
                score += 20;
            }
        }

        // Count is only a weak tie-breaker. Large unrelated playlists must never
        // outrank an exact series identity merely because they contain more videos.
        score += Math.Min(album.count, 30);
        return score;
    }

    static int SeriesIdentityScore(string value, string query)
    {
        if (string.IsNullOrWhiteSpace(value) || string.IsNullOrWhiteSpace(query))
            return 0;

        if (value == query)
            return 1000;

        if (!value.StartsWith(query))
            return 0;

        string suffix = value.Substring(query.Length);
        if (string.IsNullOrEmpty(suffix))
            return 1000;

        // Accept only structural suffixes. This keeps "Кухня 6 сезон" while
        // rejecting lookalikes such as "Пекельна кухня", "Кухня Вайта" and
        // "Триггер дорама".
        if (Regex.IsMatch(suffix, @"^(?:(?:19|20)\d{2}|\d{1,2}(?:сезон|season)|(?:сезон|season)\d{1,2}|сериал|serial|series)"))
            return 900;

        return 0;
    }

    static int SeriesPairIdentityScore(string value, string first, string second)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            string.IsNullOrWhiteSpace(first) ||
            string.IsNullOrWhiteSpace(second) ||
            first == second)
        {
            return 0;
        }

        foreach (string prefix in new[] { first + second, second + first })
        {
            if (!value.StartsWith(prefix))
                continue;

            string suffix = value.Substring(prefix.Length);
            if (string.IsNullOrEmpty(suffix))
                return 950;

            if (Regex.IsMatch(
                suffix,
                @"^(?:(?:19|20)\d{2}|\d{1,2}(?:сезон|season)|(?:сезон|season)\d{1,2}|сериал|serial|series)"))
            {
                return 950;
            }
        }

        return 0;
    }

    static bool IsMultiSeasonAlbumTitle(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        return Regex.IsMatch(
                   value,
                   @"(?i)\b\d{1,2}\s*[-–—]\s*\d{1,2}\s*(?:сезон|сезоны|сезонов|seasons?)\b") ||
               Regex.IsMatch(
                   value,
                   @"(?i)\b(?:сезон|сезоны|сезонов|seasons?)\s*[:№#]?\s*\d{1,2}\s*[-–—]\s*\d{1,2}\b") ||
               Regex.IsMatch(
                   value,
                   @"(?i)\b\d{1,2}(?:\s+\d{1,2}){2,}\s*(?:сезон|сезоны|сезонов|seasons?)\b");
    }

    static bool IsGenericSeasonAlbum(VideoAlbum album)
    {
        if (album == null || string.IsNullOrWhiteSpace(album.title))
            return false;

        string value = album.title.Trim();

        return Regex.IsMatch(
            value,
            @"(?i)^(?:\d{1,2}\s*(?:сезон|cезон|season)|(?:сезон|cезон|season)\s*\d{1,2})\s*[.!_-]*$");
    }

    static int ParseSeason(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return 0;

        foreach (string pattern in new[]
        {
            @"(?i)\b(?<s>\d{1,2})\s*(?:-?й\s*)?(?:сезон|cезон|season)\b",
            @"(?i)\b(?:сезон|cезон|season)\s*[№#]?\s*(?<s>\d{1,2})\b",
            @"(?i)\bS(?<s>\d{1,2})\b"
        })
        {
            var match = Regex.Match(value, pattern);
            if (match.Success && int.TryParse(match.Groups["s"].Value, out int season) && season > 0)
                return season;
        }

        return 0;
    }

    static bool TryParseEpisode(Video video, short albumSeasonHint, bool allowPlaylistPositionFallback, out short season, out short episode)
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

            if (allowPlaylistPositionFallback &&
                albumSeasonHint > 0 &&
                explicitSeason == albumSeasonHint &&
                video != null &&
                video.playlist_position > 0)
            {
                season = (short)explicitSeason;
                episode = (short)Math.Min(video.playlist_position, short.MaxValue);
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

        // Season playlists often use raw filenames such as
        // "07 Pinkeye.mkv". Prefer that explicit leading number over
        // playlist_position, because VK playlists can be reverse-sorted
        // or contain extra clips that shift positions.
        if (TryLeadingEpisodeNumber(video?.title, out episode))
        {
            season = albumSeasonHint;
            return true;
        }

        if (allowPlaylistPositionFallback &&
            video != null &&
            video.playlist_position > 0)
        {
            season = albumSeasonHint;
            episode = (short)Math.Min(video.playlist_position, short.MaxValue);
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

    static bool TryLeadingEpisodeNumber(string value, out short episode)
    {
        episode = 0;

        if (string.IsNullOrWhiteSpace(value))
            return false;

        // 1-3 digits only: years such as 2019 are intentionally excluded.
        var match = Regex.Match(
            value,
            @"^\s*[\[(]?(?<e>\d{1,3})[\])]?\s*(?:[._-]+|\s+)"
        );

        if (!match.Success ||
            !short.TryParse(match.Groups["e"].Value, out episode) ||
            episode <= 0)
        {
            episode = 0;
            return false;
        }

        return true;
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

    static bool IsCompilationVideo(Video video, short albumSeasonHint = 0)
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
                   value.Contains("всеэпизоды") ||
                   value.Contains("полныйсезон") ||
                   value.Contains("сезонполностью") ||
                   value.Contains("нонстоп") ||
                   value.Contains("сборниксерий") ||
                   value.Contains("allepisodes") ||
                   value.Contains("fullseason") ||
                   value.Contains("completeseason") ||
                   value.Contains("wholeseason") ||
                   value.Contains("nonstop");
        }

        string rawTitle = video.title ?? string.Empty;
        string rawDescription = video.description ?? string.Empty;
        string raw = $"{rawTitle} {rawDescription}";

        bool hasExplicitEpisode =
            TrySeasonEpisode(rawTitle, out _, out _) ||
            TryGenericEpisode(rawTitle, out _) ||
            TrySeasonEpisode(rawDescription, out _, out _) ||
            TryGenericEpisode(rawDescription, out _);

        if (HasMarker(title))
            return true;

        // Descriptions often contain promotional "watch all episodes" text even on
        // a normal episode. Treat description-only markers as compilation evidence
        // only when the video itself does not identify a concrete episode.
        if (HasMarker(description) && !hasExplicitEpisode)
            return true;

        // "1-7 серия", "1–10 серии", "episodes 1-8".
        if (Regex.IsMatch(
            raw,
            @"(?i)(?:\b\d{1,3}\s*[-–—]\s*\d{1,3}\s*(?:серия|серии|серий|episodes?|ep)\b|\b(?:серия|серии|серий|episodes?|ep)\s*[№#]?\s*\d{1,3}\s*[-–—]\s*\d{1,3}\b)"))
        {
            return true;
        }

        // "1, 2, 3 серии" / "1 и 2 серия".
        if (Regex.IsMatch(
            raw,
            @"(?i)\b\d{1,3}(?:\s*[,/&]\s*\d{1,3}|\s+и\s+\d{1,3})+\s*(?:серия|серии|серий|episodes?)\b"))
        {
            return true;
        }

        // Multi-season bundles: "1-3 сезоны", "сезон 1-4", "1 - 13 season".
        if (Regex.IsMatch(
            raw,
            @"(?i)(?:\b\d{1,2}\s*[-–—]\s*\d{1,2}\s*(?:сезон|сезоны|сезонов|seasons?)\b|\b(?:сезон|сезоны|сезонов|seasons?)\s*[:№#]?\s*\d{1,2}\s*[-–—]\s*\d{1,2}\b)"))
        {
            return true;
        }

        bool hasSeasonMarker =
            Regex.IsMatch(raw, @"(?i)\b(?:сезон|сезоны|сезонов|season|seasons)\b") ||
            Regex.IsMatch(raw, @"(?i)\bS\d{1,2}\b");

        // Phrases like "1 season 8 episodes" are counts, not episode #8.
        if (video.duration >= 60 * 60 &&
            Regex.IsMatch(
                raw,
                @"(?i)\b\d{1,2}\s*(?:сезон|season)\D{0,24}\d{1,3}\s*(?:серии|серий|episodes?)\b"))
        {
            return true;
        }

        // Even if the title syntactically resembles one episode, a three-hour serial
        // video is overwhelmingly a concatenation on VK and must not become E08/E20.
        if (hasExplicitEpisode && video.duration >= 3 * 60 * 60)
            return true;

        // VK frequently exposes an entire season as one playable file without saying
        // "all episodes" in the title: e.g. just "Show - 5 season".
        if (!hasExplicitEpisode && hasSeasonMarker && video.duration >= 150 * 60)
            return true;

        // Inside a known season playlist, playlist_position must not turn one giant
        // concatenated file into a fake episode merely because its title is generic.
        if (!hasExplicitEpisode && albumSeasonHint > 0 && video.duration >= 150 * 60)
            return true;

        // Also reject extremely long serial videos even when the uploader omitted
        // a season marker completely. This covers whole-series/season concatenations
        // with generic titles such as just the show name.
        if (!hasExplicitEpisode && video.duration >= 6 * 60 * 60)
            return true;

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

        // Short-format series exist too. Do not reject a short video solely by
        // duration when VK/title clearly identifies it as an episode or when it comes
        // from an ordered season playlist.
        if (video.duration > 0 && video.duration < 10 * 60)
        {
            bool explicitEpisode =
                TrySeasonEpisode(video.title, out _, out _) ||
                TryGenericEpisode(video.title, out _) ||
                TrySeasonEpisode(video.description, out _, out _) ||
                TryGenericEpisode(video.description, out _);

            if (!explicitEpisode && video.playlist_position <= 0)
                return true;
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
               name.Contains("тизер") ||
               name.Contains("teaser") ||
               name.Contains("анонс") ||
               name.Contains("promo") ||
               name.Contains("промо") ||
               name.Contains("preview") ||
               name.Contains("превью") ||
               name.Contains("премьера") ||
               name.Contains("обзор");
    }

    static List<ParsedEpisode> ParseTrustedDirectVideos(
        IEnumerable<Video> videos,
        string searchTitle,
        string searchOriginalTitle,
        short year,
        short seasonHint)
    {
        var parsed = ParseVideos(
                (videos ?? Enumerable.Empty<Video>())
                    .Where(i => SeriesVideoScore(i, searchTitle, searchOriginalTitle, year) >= 150),
                seasonHint)
            .ToList();

        return parsed
            .GroupBy(i => i.season)
            .Where(g => g.Key > 0 &&
                        IsConfidentEpisodeSet(g, minEpisodes: 3, minMedianSeconds: 8 * 60))
            .SelectMany(g => g)
            .ToList();
    }

    static bool IsConfidentEpisodeSet(
        IEnumerable<ParsedEpisode> episodes,
        int minEpisodes,
        int minMedianSeconds)
    {
        var unique = (episodes ?? Enumerable.Empty<ParsedEpisode>())
            .Where(i => i != null && i.episode > 0 && i.video != null)
            .GroupBy(i => i.episode)
            .Select(g => g
                .OrderByDescending(i => i.video.duration)
                .First())
            .OrderBy(i => i.episode)
            .ToList();

        if (unique.Count < minEpisodes)
            return false;

        int first = unique.First().episode;
        int last = unique.Last().episode;
        int span = last - first + 1;

        // Reject sparse search noise such as E2/E4/E5/E13 from an unrelated show.
        if (span > unique.Count * 2)
            return false;

        var durations = unique
            .Where(i => i.video.duration > 0)
            .Select(i => i.video.duration)
            .OrderBy(i => i)
            .ToList();

        if (durations.Count < minEpisodes)
            return false;

        long median = durations[durations.Count / 2];
        return median >= minMedianSeconds;
    }

    static int EpisodeDurationScore(IEnumerable<ParsedEpisode> episodes)
    {
        var durations = episodes?
            .Where(i => i?.video != null && i.video.duration > 0)
            .Select(i => i.video.duration)
            .OrderBy(i => i)
            .ToList();

        if (durations == null || durations.Count == 0)
            return 0;

        long median = durations[durations.Count / 2];

        // Weak tie-breaker only: prefer complete-looking copies of the same show,
        // but cap the effect so episode length never dominates identity/completeness.
        return (int)Math.Min(median / 60, 60);
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

    async Task<bool> EnsureAnonymToken(BaseSettings init)
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

            // VK Video exposes its own anonymous-token method. This removes the
            // legacy login.vk.com flow and the embedded client_secret entirely.
            string url = $"{init.host}/method/auth.getAnonymToken?v=5.264&client_id={client_id}";

            JObject root = null;

            try
            {
                root = await httpHydra.Post<JObject>(url, string.Empty);
            }
            catch { }

            var response = root?["response"];
            string token = response?["token"]?.ToString();

            if (string.IsNullOrEmpty(token))
                return false;

            access_token = token;

            long? expiredAt = response?["expired_at"]?.ToObject<long?>();

            token_expires = expiredAt > 0
                ? DateTimeOffset.FromUnixTimeSeconds(expiredAt.Value).UtcDateTime.AddMinutes(-10)
                : DateTime.UtcNow.AddHours(6);

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
