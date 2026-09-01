using Newtonsoft.Json;
using Shared.Models.Base;
using Shared.Services;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Gencit;

public class GencitService
{
    public const string Referer = "https://kinomix.web.app/";

    private readonly ModuleConf init;
    private readonly HttpHydra httpHydra;
    private readonly IReadOnlyList<HeadersModel> pageHeaders;

    public string LastError { get; private set; }

    public GencitService(ModuleConf init, HttpHydra httpHydra)
    {
        this.init = init;
        this.httpHydra = httpHydra;
        pageHeaders = HeadersModel.Init(
            ("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
            ("referer", Referer)
        );
    }

    public async Task<GencitPageData> GetPage(int playlistId, short season = 0, short episode = 0, int voiceId = 0)
    {
        LastError = null;

        if (playlistId <= 0)
        {
            LastError = "playlist";
            return null;
        }

        string uri = BuildPageUrl(playlistId, season, episode, voiceId);
        string html;

        try
        {
            html = await httpHydra.Get(uri, addheaders: pageHeaders).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            LastError = $"http:{ex.GetType().Name}";
            return null;
        }

        if (string.IsNullOrWhiteSpace(html))
        {
            LastError = "html:empty";
            return null;
        }

        if (GencitIndex.IsBlockedPage(html))
        {
            LastError = $"html:blocked:{html.Length}";
            return null;
        }

        string playerJson = ExtractAssignedJson(html, "window.playerData");
        if (string.IsNullOrWhiteSpace(playerJson))
        {
            LastError = $"playerData:marker:{html.Length}";
            return null;
        }

        GencitPlayerData player;
        try
        {
            player = JsonConvert.DeserializeObject<GencitPlayerData>(playerJson);
        }
        catch (Exception ex)
        {
            LastError = $"playerData:json:{ex.GetType().Name}";
            return null;
        }

        if (player == null)
        {
            LastError = "playerData:null";
            return null;
        }

        if (player.config == null)
        {
            LastError = "playerData:config";
            return null;
        }

        GencitAdsConfig ads = null;
        string adsJson = ExtractAssignedJson(html, "window.adsConfig");
        if (!string.IsNullOrWhiteSpace(adsJson))
        {
            try { ads = JsonConvert.DeserializeObject<GencitAdsConfig>(adsJson); }
            catch { }
        }

        return new GencitPageData
        {
            player = player,
            ads = ads
        };
    }

    public string GetHls(GencitPageData page)
    {
        string hls = page?.player?.config?.video;
        if (string.IsNullOrWhiteSpace(hls))
            hls = page?.player?.config?.video_new;

        if (string.IsNullOrWhiteSpace(hls))
            return null;

        if (hls.StartsWith("//", StringComparison.Ordinal))
            hls = "https:" + hls;

        return hls;
    }

    private string BuildPageUrl(int playlistId, short season, short episode, int voiceId)
    {
        string uri = $"{init.host.TrimEnd('/')}/lat/{playlistId}";
        if (season > 0 && episode != 0 && voiceId > 0)
        {
            uri += $"?season={season}&episode={episode}&voice={voiceId}";
        }

        return uri;
    }

    public static string ExtractAssignedJson(string html, string marker)
    {
        if (string.IsNullOrEmpty(html) || string.IsNullOrEmpty(marker))
            return null;

        int searchFrom = 0;
        while (searchFrom < html.Length)
        {
            int markerIndex = html.IndexOf(marker, searchFrom, StringComparison.Ordinal);
            if (markerIndex < 0)
                return null;

            int cursor = markerIndex + marker.Length;
            while (cursor < html.Length && char.IsWhiteSpace(html[cursor]))
                cursor++;

            if (cursor >= html.Length || html[cursor] != '=')
            {
                searchFrom = markerIndex + marker.Length;
                continue;
            }

            cursor++;
            while (cursor < html.Length && char.IsWhiteSpace(html[cursor]))
                cursor++;

            int start = html.IndexOf('{', cursor);
            if (start < 0)
                return null;

            int depth = 0;
            char quote = '\0';
            bool escaped = false;

            for (int i = start; i < html.Length; i++)
            {
                char ch = html[i];

                if (quote != '\0')
                {
                    if (escaped)
                    {
                        escaped = false;
                        continue;
                    }

                    if (ch == '\\')
                    {
                        escaped = true;
                        continue;
                    }

                    if (ch == quote)
                        quote = '\0';

                    continue;
                }

                if (ch == '"' || ch == '\'')
                {
                    quote = ch;
                    continue;
                }

                if (ch == '{')
                {
                    depth++;
                    continue;
                }

                if (ch != '}')
                    continue;

                depth--;
                if (depth == 0)
                    return html.Substring(start, i - start + 1);
            }

            return null;
        }

        return null;
    }
}
