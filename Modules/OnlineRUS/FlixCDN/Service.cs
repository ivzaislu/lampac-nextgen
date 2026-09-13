using Shared.Models.Base;
using Shared.Models.Online.Settings;
using Shared.Models.Templates;
using Shared.Services;
using Shared.Services.Utilities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;

namespace FlixCDN;

public struct FlixCDNInvoke
{
    #region FlixCDNInvoke
    string host;
    OnlinesSettings init;
    HttpHydra httpHydra;
    Func<string, string> onstreamfile;

    static readonly JsonSerializerOptions jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public FlixCDNInvoke(string host, OnlinesSettings init, HttpHydra httpHydra, Func<string, string> onstreamfile)
    {
        this.host = host;
        this.init = init;
        this.httpHydra = httpHydra;
        this.onstreamfile = onstreamfile;
    }
    #endregion

    #region StreamQuality
    public StreamQualityTpl GetStreamQualityTpl(string file)
    {
        var streamquality = new StreamQualityTpl();

        foreach (Match m in Regex.Matches(file, "\\[(?<q>\\d{3,4})\\](?<url>https?://[^,\"\\[\\s]+)"))
        {
            string q = m.Groups["q"].Value;
            string link = m.Groups["url"].Value;

            if (string.IsNullOrEmpty(link) || string.IsNullOrEmpty(q))
                continue;

            streamquality.Insert(onstreamfile.Invoke(link), $"{q}p");
        }

        if (!streamquality.IsEmpty)
            return streamquality;

        foreach (Match m in Regex.Matches(file, "(https?://[^,\"\\[\\s]+\\.(m3u8|mp4)(:hls:manifest\\.m3u8)?)"))
        {
            string link = m.Groups[1].Value;
            if (string.IsNullOrEmpty(link))
                continue;

            streamquality.Append(onstreamfile.Invoke(link), "auto");
            break;
        }

        return streamquality;
    }
    #endregion

    #region BuildIframeUrl
    public string BuildIframeUrl(string iframe, int t, int s, int e)
    {
        var args = new List<string>(3);

        if (t > 0)
            args.Add("translation=" + t);

        if (s > 0)
            args.Add("season=" + s);

        if (e > 0)
            args.Add("episode=" + e);

        if (args.Count == 0)
            return iframe;

        return iframe + (iframe.Contains("?") ? "&" : "?") + string.Join("&", args);
    }
    #endregion

    #region PlayerSearch
    public string BuildPlayerUrl(long kinopoisk_id)
    {
        return $"{init.host}/show/kinopoisk/{kinopoisk_id}?extrans=1&extepi=1&unfseason=1";
    }

    async public Task<SearchItem> SearchByPlayer(long kinopoisk_id, string title, string original_title)
    {
        var payload = await GetPlayerPayload(kinopoisk_id);
        if (payload == null || payload.id <= 0)
            return null;

        string playerUrl = BuildPlayerUrl(kinopoisk_id);
        var voices = GetPlayerVoices(payload);
        if (voices.Count == 0)
            return null;

        var translations = new List<Voice>();

        if (!payload.is_serial)
        {
            foreach (var voice in voices)
            {
                translations.Add(new Voice
                {
                    id = voice.id,
                    title = string.IsNullOrWhiteSpace(voice.title) ? "Перевод" : voice.title
                });
            }
        }
        else
        {
            var seasons = GetSeasons(payload);
            if (seasons.Count == 0)
                return null;

            int totalEpisodes = TotalEpisodes(seasons);

            foreach (var voice in voices)
            {
                int remaining = voice.episodes_qty > 0 ? voice.episodes_qty : totalEpisodes;

                foreach (var season in seasons)
                {
                    int seasonLength = season.Value?.Length ?? 0;
                    if (seasonLength <= 0)
                        continue;

                    int available = Math.Min(Math.Max(remaining, 0), seasonLength);
                    if (available > 0)
                    {
                        translations.Add(new Voice
                        {
                            id = voice.id,
                            title = string.IsNullOrWhiteSpace(voice.title) ? "Перевод" : voice.title,
                            season = season.Key,
                            episode = (short)Math.Min(available, short.MaxValue)
                        });
                    }

                    remaining -= seasonLength;
                }
            }
        }

        if (translations.Count == 0)
            return null;

        return new SearchItem
        {
            iframe_url = playerUrl,
            type = payload.is_serial ? "serial" : (string.IsNullOrWhiteSpace(payload.type) ? "movie" : payload.type),
            title_rus = title,
            title_orig = original_title,
            translations = translations
        };
    }

    async Task<PlayerPayload> GetPlayerPayload(long kinopoisk_id)
    {
        if (kinopoisk_id <= 0)
            return null;

        string html = await httpHydra.Get(BuildPlayerUrl(kinopoisk_id), safety: true);
        if (string.IsNullOrWhiteSpace(html))
            return null;

        const string marker = "window.__PLAYER_PAYLOAD__";
        int markerStart = html.IndexOf(marker, StringComparison.Ordinal);
        if (markerStart < 0)
            return null;

        int equals = html.IndexOf('=', markerStart + marker.Length);
        if (equals < 0)
            return null;

        int start = equals + 1;
        int end = html.IndexOf(';', start);
        if (end < 0)
            return null;

        string json = html.Substring(start, end - start).Trim();
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            return JsonSerializer.Deserialize<PlayerPayload>(json, jsonOptions);
        }
        catch
        {
            return null;
        }
    }

    static List<PlayerTranslation> GetPlayerVoices(PlayerPayload payload)
    {
        var voices = payload?.translations?
            .Where(v => v != null && v.id > 0)
            .GroupBy(v => v.id)
            .Select(g => g.First())
            .ToList() ?? new List<PlayerTranslation>();

        if (payload?.translate > 0 && !voices.Any(v => v.id == payload.translate))
        {
            voices.Insert(0, new PlayerTranslation
            {
                id = payload.translate,
                title = string.IsNullOrWhiteSpace(payload.translateTitle) ? "Перевод" : payload.translateTitle,
                episodes_qty = TotalEpisodes(GetSeasons(payload))
            });
        }

        return voices;
    }

    static SortedDictionary<short, int[]> GetSeasons(PlayerPayload payload)
    {
        var seasons = new SortedDictionary<short, int[]>();

        if (payload?.seasons_episodes != null)
        {
            foreach (var item in payload.seasons_episodes)
            {
                if (!short.TryParse(item.Key, out short season) || season <= 0 || item.Value == null || item.Value.Length == 0)
                    continue;

                var episodes = item.Value.Where(e => e > 0).ToArray();
                if (episodes.Length > 0)
                    seasons[season] = episodes;
            }
        }

        if (seasons.Count == 0 && payload?.season > 0 && payload.episodes?.Length > 0)
        {
            var episodes = payload.episodes.Where(e => e > 0).ToArray();
            if (episodes.Length > 0)
                seasons[payload.season.Value] = episodes;
        }

        return seasons;
    }

    static int TotalEpisodes(SortedDictionary<short, int[]> seasons)
    {
        int total = 0;

        foreach (var season in seasons)
            total += season.Value?.Length ?? 0;

        return total;
    }
    #endregion

    #region Search
    async public Task<SearchItem> SearchById(string imdb_id, long kinopoisk_id)
    {
        var args = new List<string>(2);

        if (kinopoisk_id > 0)
            args.Add($"kinopoisk_id={kinopoisk_id}");

        if (!string.IsNullOrWhiteSpace(imdb_id))
            args.Add($"imdb_id={HttpUtility.UrlEncode(imdb_id)}");

        if (args.Count == 0)
            return null;

        var root = await ApiSearch(string.Join("&", args));
        if (root != null && root.Length > 0)
            return root[0];

        return null;
    }

    async public Task<SearchItem> SearchByTitle(string imdb_id, long kinopoisk_id, string title, string original_title, bool forceSimilar)
    {
        if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(original_title))
            return null;

        var root = await ApiSearch($"title={HttpUtility.UrlEncode(title ?? original_title)}");
        if (root == null || root.Length == 0)
            return null;

        var stpl = new SimilarTpl(root.Length);
        string stitle = SearchNameTo.Convert(title);
        string sorig = SearchNameTo.Convert(original_title);

        SearchItem exact = null;

        foreach (var item in root)
        {
            string name = item.title_rus ?? item.title_orig;
            if (string.IsNullOrEmpty(name))
                continue;

            string details = item.year > 0 ? item.year.ToString() : string.Empty;

            stpl.Append(
                name,
                details,
                string.Empty,
                $"{host}/lite/flixcdn?kinopoisk_id={kinopoisk_id}&imdb_id={imdb_id}&title={HttpUtility.UrlEncode(item.title_rus)}&original_title={HttpUtility.UrlEncode(item.title_orig)}&year={item.year}",
                PosterApi.Size(item.poster)
            );

            if (exact == null)
            {
                if (SearchNameTo.Contains(name, stitle) ||
                    SearchNameTo.Contains(name, sorig))
                    exact = item;
            }
        }

        if (forceSimilar)
            return new SearchItem() { similar = stpl };

        if (exact != null)
            return exact;

        if (root.Length == 1)
            return root[0];

        if (stpl.Length > 0)
            return new SearchItem() { similar = stpl };

        return null;
    }

    async Task<SearchItem[]> ApiSearch(string query)
    {
        if (string.IsNullOrWhiteSpace(init?.token))
            return null;

        string uri = $"{init.apihost}/search?token={init.token}&{query}";
        var root = await httpHydra.Get<SearchRoot>(uri, safety: true);

        return root?.result;
    }
    #endregion
}
