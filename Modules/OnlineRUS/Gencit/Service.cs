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
        if (playlistId <= 0)
            return null;

        string uri = BuildPageUrl(playlistId, season, episode, voiceId);
        string html = await httpHydra.Get(uri, addheaders: pageHeaders).ConfigureAwait(false);

        if (string.IsNullOrWhiteSpace(html) || GencitIndex.IsBlockedPage(html))
            return null;

        string playerJson = ExtractAssignedJson(html, "window.playerData");
        if (string.IsNullOrWhiteSpace(playerJson))
            return null;

        try
        {
            var player = JsonConvert.DeserializeObject<GencitPlayerData>(playerJson);
            if (player?.config == null)
                return null;

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
        catch
        {
            return null;
        }
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

        int markerIndex = html.IndexOf(marker, StringComparison.Ordinal);
        if (markerIndex < 0)
            return null;

        int equals = html.IndexOf('=', markerIndex + marker.Length);
        if (equals < 0)
            return null;

        int start = html.IndexOf('{', equals + 1);
        if (start < 0)
            return null;

        int depth = 0;
        bool inString = false;
        bool escaped = false;

        for (int i = start; i < html.Length; i++)
        {
            char ch = html[i];

            if (inString)
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

                if (ch == '"')
                    inString = false;

                continue;
            }

            if (ch == '"')
            {
                inString = true;
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
}
