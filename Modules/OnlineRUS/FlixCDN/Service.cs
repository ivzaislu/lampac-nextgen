using Shared.Models.Base;
using Shared.Models.Online.Settings;
using Shared.Models.Templates;
using Shared.Services;
using Shared.Services.Utilities;
using System;
using System.Collections.Generic;
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

    #region PlayerMovie
    public string BuildPlayerUrl(long kinopoisk_id)
    {
        return $"{init.host}/show/kinopoisk/{kinopoisk_id}?extrans=1&extepi=1&unfseason=1";
    }

    async Task<SearchItem> GetPlayerMovie(long kinopoisk_id, string title, string original_title)
    {
        if (kinopoisk_id <= 0)
            return null;

        string playerUrl = BuildPlayerUrl(kinopoisk_id);
        string html = await httpHydra.Get(playerUrl, safety: true);
        if (string.IsNullOrWhiteSpace(html))
            return null;

        const string marker = "window.__PLAYER_PAYLOAD__ = ";
        int start = html.IndexOf(marker, StringComparison.Ordinal);
        if (start < 0)
            return null;

        start += marker.Length;
        int end = html.IndexOf(';', start);
        if (end < 0)
            return null;

        string json = html.Substring(start, end - start).Trim();
        if (string.IsNullOrWhiteSpace(json))
            return null;

        PlayerPayload payload;

        try
        {
            payload = JsonSerializer.Deserialize<PlayerPayload>(json, jsonOptions);
        }
        catch
        {
            return null;
        }

        if (payload == null || payload.id <= 0 || payload.is_serial)
            return null;

        var translations = new List<Voice>();
        var ids = new HashSet<int>();

        if (payload.translations != null)
        {
            foreach (var translation in payload.translations)
            {
                if (translation == null || translation.id <= 0 || !ids.Add(translation.id))
                    continue;

                translations.Add(new Voice
                {
                    id = translation.id,
                    title = string.IsNullOrWhiteSpace(translation.title) ? "Перевод" : translation.title
                });
            }
        }

        if (payload.translate > 0 && ids.Add(payload.translate))
        {
            translations.Insert(0, new Voice
            {
                id = payload.translate,
                title = string.IsNullOrWhiteSpace(payload.translateTitle) ? "Перевод" : payload.translateTitle
            });
        }

        if (translations.Count == 0)
            return null;

        return new SearchItem
        {
            iframe_url = playerUrl,
            type = "movie",
            title_rus = title,
            title_orig = original_title,
            translations = translations
        };
    }
    #endregion

    #region SearchByTitle
    async public Task<SearchItem> SearchByTitle(string imdb_id, long kinopoisk_id, string title, string original_title, bool forceSimilar)
    {
        var directMovie = await GetPlayerMovie(kinopoisk_id, title, original_title);
        if (directMovie != null)
            return directMovie;

        if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(original_title))
            return null;

        var root = await ApiSearch($"title={HttpUtility.UrlEncode(title ?? original_title)}");
        if (root == null || root.Length == 0)
            return null;

        var stpl = new SimilarTpl(root.Length);
        string enc_title = HttpUtility.UrlEncode(title);
        string enc_original_title = HttpUtility.UrlEncode(original_title);

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
