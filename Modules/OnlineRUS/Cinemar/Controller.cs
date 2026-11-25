using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared;
using Shared.Attributes;
using Shared.Models;
using Shared.Models.Base;
using Shared.Models.Online.Settings;
using Shared.Models.Templates;
using Shared.Services;
using Shared.Services.HTTP;
using Shared.Services.RxEnumerate;
using Shared.Services.Utilities;
using Shared.PlaywrightCore;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;

namespace Cinemar;

public class CinemarController : BaseOnlineController
{
    public CinemarController() : base(ModInit.conf) { }

    [HttpGet, Staticache(manually: true)]
    [Route("lite/cinemar")]
    async public Task<ActionResult> Index(string title, string original_title, short year, bool rjson, string href, bool similar, short s = -1, int t = -1, string voice = null)
    {
        if (await IsRequestBlocked(rch: true))
            return badInitMsg;

        #region search
        if (string.IsNullOrEmpty(href))
        {
            if (string.IsNullOrEmpty(title))
                return OnError("search params");

            string searchUrl = $"{init.host}/search/{Uri.EscapeDataString(title)}";
        reset_search:
            bool searchFactoryRan = false;
            var search = await InvokeCacheResult<SearchModel>($"cinemar:search:v2:{title}:{year}", TimeSpan.FromHours(4), async e =>
            {
                searchFactoryRan = true;
                SearchModel result = null;
                bool callbackRan = false;
                string transport = rch?.enable == true ? "RCH" : "PlaywrightHttp";
                SearchDiagnostic($"transport={transport} start");

                if (rch?.enable == true)
                {
                    await rch.GetSpan(searchUrl, html =>
                    {
                        callbackRan = true;
                        LogSearchHtml(html);
                        result = SearchResult(html, title, year);
                    });
                }
                else
                {
                    await PlaywrightHttp.GetSpan(init.plugin, searchUrl, html =>
                    {
                        callbackRan = true;
                        LogSearchHtml(html);
                        result = SearchResult(html, title, year);
                    }, proxy: proxy_data);
                }

                SearchDiagnostic($"transport={transport} callback={callbackRan} parsed={result != null} exact={result?.link != null}");

                if (result == null)
                {
                    if (transport == "PlaywrightHttp" && !callbackRan)
                        await DiagnoseSearchTransport(searchUrl);

                    return e.Fail("search-result", refresh_proxy: true);
                }

                return e.Success(result);
            });

            SearchDiagnostic($"factory={(searchFactoryRan ? "executed" : "not-executed")} success={search.IsSuccess}");

            if (similar || string.IsNullOrEmpty(search.Value?.link))
                return ContentTpl(search, () => search.Value.similar);

            if (string.IsNullOrEmpty(search.Value?.link))
            {
                if (IsRhubFallback(search))
                    goto reset_search;

                return OnError();
            }

            href = search.Value?.link;
        }
        #endregion

        if (string.IsNullOrEmpty(href))
            return OnError("href");

        var embed = await GetEmbed(href);
        if (!embed.IsSuccess)
            return OnError(embed.ErrorMsg);

        var cache = await GetPlaylist(href, embed.Value);
        return ContentTpl(cache,
            () => BuildResult(cache.Value, title, original_title, year, s, t, rjson, href, voice)
        );
    }

    async Task<CacheResult<string>> GetEmbed(string href)
    {
        #region embed
    reset_embed:

        var embed = await InvokeCacheResult<string>($"cinemar:{href}", TimeSpan.FromHours(4), async e =>
        {
            string iframeUri = null;
            string targetHref = $"{init.host}/{href}";

            if (rch?.enable == true)
            {
                await rch.GetSpan(init.cors(targetHref), html =>
                {
                    iframeUri = Rx.Match(html, "<iframe [^>]+data-src=\"([^\"]+)\"");
                });
            }
            else
            {
                await PlaywrightHttp.GetSpan(init.plugin, init.cors(targetHref), html =>
                {
                    iframeUri = Rx.Match(html, "<iframe [^>]+data-src=\"([^\"]+)\"");
                }, proxy: proxy_data);
            }

            if (iframeUri == null)
                return e.Fail("iframeUri", refresh_proxy: true);

            string embedUrl = iframeUri.StartsWith("//") ? $"https:{iframeUri}" : iframeUri;

            if (string.IsNullOrEmpty(embedUrl))
                return e.Fail("embedUrl", refresh_proxy: true);

            return e.Success(embedUrl);
        });

        if (IsRhubFallback(embed))
            goto reset_embed;

        return embed;
        #endregion
    }

    async Task<CacheResult<List<PlaylistItem>>> GetPlaylist(string href, string embedUrl)
    {
        #region iframe
    reset_iframe:

        // v2 keeps old cached entries without id/data out of the playback path.
        var cache = await InvokeCacheResult<List<PlaylistItem>>(ipkey($"cinemar:playlist:v2:{embedUrl}"), 20, async e =>
        {
            string fileEncode = null;
            var embedHeaders = httpHeaders(init, HeadersModel.Init("referer", $"{init.host}/{href}"));

            if (rch?.enable == true)
            {
                await rch.GetSpan(init.cors(embedUrl), html =>
                {
                    fileEncode = Rx.Match(html, "\"file\":\"([^\"]+)\"");
                }, embedHeaders);
            }
            else
            {
                await PlaywrightHttp.GetSpan(init.plugin, init.cors(embedUrl), html =>
                {
                    fileEncode = Rx.Match(html, "\"file\":\"([^\"]+)\"");
                }, headers: embedHeaders, proxy_data);
            }

            if (string.IsNullOrEmpty(fileEncode))
                return e.Fail("fileEncode", refresh_proxy: true);

            string playlistJson = DecodeFile(fileEncode);
            if (string.IsNullOrEmpty(playlistJson))
                return e.Fail("playlistJson");

            try
            {
                var playlist = JsonConvert.DeserializeObject<List<PlaylistItem>>(playlistJson);
                if (playlist == null || playlist.Count == 0)
                    return e.Fail("playlist");

                return e.Success(playlist);
            }
            catch
            {
                return e.Fail("DeserializeObject");
            }
        });

        if (IsRhubFallback(cache))
            goto reset_iframe;
        #endregion

        return cache;
    }

    #region Video
    [HttpGet, Staticache(manually: true)]
    [Route("lite/cinemar/video")]
    [Route("lite/cinemar/video.m3u8")]
    async public Task<ActionResult> Video(string href, string id, string title, bool play = false)
    {
        if (await IsRequestBlocked(rch: true, rch_check: !play))
            return badInitMsg;

        if (string.IsNullOrEmpty(href) || string.IsNullOrEmpty(id))
            return OnError("video params");

        var embed = await GetEmbed(href);
        if (!embed.IsSuccess)
            return OnError(embed.ErrorMsg);

        var playlist = await GetPlaylist(href, embed.Value);
        if (!playlist.IsSuccess)
            return OnError(playlist.ErrorMsg);

        var item = FindItem(playlist.Value, id);
        if (string.IsNullOrEmpty(item?.data))
            return OnError("playlist item");

        if (!Uri.TryCreate(embed.Value, UriKind.Absolute, out var embedUri)
            || (embedUri.Scheme != "https" && embedUri.Scheme != "http"))
            return OnError("embed uri");

        string origin = embedUri.GetLeftPart(UriPartial.Authority);
        var streamHeaders = HeadersModel.Init(("referer", embed.Value), ("origin", origin));

        var cache = await InvokeCacheResult<PlaylistItem>(ipkey($"cinemar:video:v2:{embed.Value}:{id}"), 5, async e =>
        {
            // The provider expects the opaque data value as a JSON string.
            var apiHeaders = httpHeaders(init, HeadersModel.Init(("referer", embed.Value), ("origin", origin), ("content-type", "application/json")));
            string apiUrl = init.cors($"{origin}/api/playlist/load", apiHeaders, requestInfo);
            string body = JsonConvert.SerializeObject(item.data);
            JObject response;

            if (rch?.enable == true)
                response = await rch.Post<JObject>(apiUrl, body, apiHeaders);
            else
            {
                using var content = new StringContent(body, Encoding.UTF8, "application/json");
                response = await Http.Post<JObject>(apiUrl, content,
                    timeoutSeconds: init.httptimeout,
                    headers: apiHeaders.Where(h => !h.name.Equals("content-type", StringComparison.OrdinalIgnoreCase)).ToList(),
                    proxy: init.useproxy ? proxy : null, httpversion: init.httpversion);
            }

            var success = response?["success"];
            if (response == null || (success != null && success.Type != JTokenType.Null
                && (success.Type != JTokenType.Boolean || !success.Value<bool>())))
                return e.Fail("playlist-load");

            var payload = response["file"] != null ? response : response["data"] as JObject;
            if (payload == null || payload["file"]?.Type != JTokenType.String)
                return e.Fail("playlist-load-file");

            PlaylistItem media;
            try { media = payload.ToObject<PlaylistItem>(); }
            catch (JsonException) { return e.Fail("playlist-load-file"); }
            if (!IsMediaFile(media?.file))
                return e.Fail("playlist-load-file");

            return e.Success(media);
        });

        if (!cache.IsSuccess)
            return OnError(cache.ErrorMsg);

        var streams = BuildStreams(cache.Value.file, streamHeaders);
        if (streams.IsEmpty)
            return OnError("streams");

        string stream = streams.Firts().link;
        if (play)
            return RedirectToPlay(stream);

        return ContentTo(VideoTpl.ToJson(
            "play", stream, title ?? item.title,
            streamquality: streams,
            subtitles: BuildSubtitles(string.IsNullOrEmpty(cache.Value.subtitle) ? item.subtitle : cache.Value.subtitle, streamHeaders),
            vast: init.vast,
            headers: stream.Contains("/proxy/") ? null : streamHeaders,
            httpContext: HttpContext
        ));
    }

    static PlaylistItem FindItem(List<PlaylistItem> playlist, string id)
    {
        if (playlist == null)
            return null;

        foreach (var item in playlist)
        {
            if (item == null)
                continue;
            if (item.id == id && item.folder == null)
                return item;

            var found = FindItem(item.folder, id);
            if (found != null)
                return found;
        }

        return null;
    }

    static string NormalizeFile(string file)
    {
        file = file?.Trim();
        return file?.StartsWith("//") == true ? "https:" + file : file;
    }

    static bool IsMediaFile(string file)
    {
        file = NormalizeFile(file);
        return !string.IsNullOrWhiteSpace(file) && (file.StartsWith("https://") || file.StartsWith("http://")
            || Regex.IsMatch(file, "^\\[[^\\]]+\\]\\s*(?:https?:)?//"));
    }

    StreamQualityTpl BuildStreams(string file, IReadOnlyList<HeadersModel> headers = null)
    {
        var streams = new StreamQualityTpl();
        file = NormalizeFile(file);
        if (!IsMediaFile(file))
            return streams;

        foreach (Match match in Regex.Matches(file, "\\[([^\\]]+)\\]\\s*((?:https?:)?//[^,\\[\\s]+)"))
            streams.Append(HostStreamProxy(NormalizeFile(match.Groups[2].Value), headers: headers), match.Groups[1].Value.Trim());

        if (!file.StartsWith("["))
            streams.Append(HostStreamProxy(file, headers: headers), "auto");

        return streams;
    }

    static bool NeedsLoad(PlaylistItem item)
        => !string.IsNullOrEmpty(item?.id) && !string.IsNullOrEmpty(item.data);

    string VideoLink(PlaylistItem item, string href, string title)
        => $"{host}/lite/cinemar/video?href={HttpUtility.UrlEncode(href)}&id={HttpUtility.UrlEncode(item.id)}&title={HttpUtility.UrlEncode(title)}";

    SubtitleTpl BuildSubtitles(string subtitle, IReadOnlyList<HeadersModel> headers = null)
    {
        var subtitles = new SubtitleTpl();
        if (!string.IsNullOrEmpty(subtitle))
        {
            foreach (Match match in Regex.Matches(subtitle, "\\[([^\\]]+)\\]([^\\[\\,]+)"))
            {
                string file = NormalizeFile(match.Groups[2].Value);
                if (IsMediaFile(file))
                    subtitles.Append(match.Groups[1].Value, HostStreamProxy(file, headers: headers));
            }
        }
        return subtitles;
    }

    static string VoiceName(PlaylistItem item)
        => HttpUtility.HtmlDecode(Regex.Replace(item?.title ?? string.Empty, "<[^>]+>", "")).Trim();
    #endregion

    #region BuildResult
    ITplResult BuildResult(List<PlaylistItem> playlist, string title, string original_title, short year, short s, int t, bool rjson, string href, string selectedVoice = null)
    {
        playlist = playlist?.Where(i => i != null).ToList() ?? new List<PlaylistItem>();
        if (playlist.FirstOrDefault()?.folder == null)
        {
            var mtpl = new MovieTpl(title, original_title);

            foreach (var source in playlist)
            {
                string voice = VoiceName(source);
                string file = source.file;

                if (string.IsNullOrEmpty(voice) || (!NeedsLoad(source) && !IsMediaFile(file)))
                    continue;

                if (NeedsLoad(source))
                {
                    string link = VideoLink(source, href, $"{title ?? original_title} ({voice})");
                    mtpl.Append(
                        voice, link, "call",
                        accsArgs($"{link.Replace("/video?", "/video.m3u8?")}&play=true"),
                        vast: init.vast
                    );
                    continue;
                }

                var streams = BuildStreams(file);
                if (streams.IsEmpty)
                    continue;

                mtpl.Append(
                    voice,
                    streams.Firts().link,
                    streamquality: streams,
                    subtitles: BuildSubtitles(source.subtitle),
                    vast: init.vast
                );
            }

            return mtpl;
        }
        else
        {
            string enc_title = HttpUtility.UrlEncode(title);
            string enc_original_title = HttpUtility.UrlEncode(original_title);
            string enc_href = HttpUtility.UrlEncode(href);

            if (s == -1)
            {
                var tpl = new SeasonTpl(playlist.Count);
                foreach (var season in playlist)
                {
                    string _s = Regex.Match(season.title ?? string.Empty, " ([0-9]+)$").Groups[1].Value;
                    if (!string.IsNullOrEmpty(_s))
                    {
                        tpl.Append(
                            $"{_s} сезон",
                            $"{host}/lite/cinemar?rjson={rjson}&title={enc_title}&original_title={enc_original_title}&year={year}&href={enc_href}&s={_s}" + (string.IsNullOrEmpty(selectedVoice) ? "" : $"&voice={HttpUtility.UrlEncode(selectedVoice)}"),
                            _s
                        );
                    }
                }

                return tpl;
            }
            else
            {
                var episodes = playlist.FirstOrDefault(i => (i.title ?? string.Empty).EndsWith($" {s}"))?.folder?.Where(i => i != null).ToList();
                if (episodes == null)
                    return new EpisodeTpl();

                #region Перевод
                var vtpl = new VoiceTpl();
                var hashSet = new HashSet<int>();
                var voiceIds = new Dictionary<string, int>(StringComparer.Ordinal);
                var reservedIds = new HashSet<int>(episodes
                    .Where(i => i.folder != null)
                    .SelectMany(i => i.folder)
                    .Where(i => i != null)
                    .Select(i => i.voice_id));
                int nextVoiceId = 0;

                foreach (var episode in episodes)
                {
                    if (episode.folder == null)
                        continue;

                    foreach (var voice in episode.folder)
                    {
                        string voiceName = VoiceName(voice);
                        if (string.IsNullOrEmpty(voiceName) || voiceIds.ContainsKey(voiceName)
                            || (!NeedsLoad(voice) && !IsMediaFile(voice?.file)))
                            continue;

                        int voice_id = voice.voice_id;
                        // New playlists omit voice_id. Keep legacy ids and distinguish
                        // missing or duplicated ids by the label, consistently across episodes.
                        if (voice_id < 0 || hashSet.Contains(voice_id))
                        {
                            while (reservedIds.Contains(nextVoiceId) || hashSet.Contains(nextVoiceId))
                                nextVoiceId++;
                            voice_id = nextVoiceId++;
                        }

                        voiceIds.Add(voiceName, voice_id);
                        hashSet.Add(voice_id);
                    }
                }

                // Store the name in links as well: omitted ids are generated locally,
                // and a provider playlist refresh can change their order.
                if (selectedVoice != null && voiceIds.TryGetValue(selectedVoice, out int selectedId))
                    t = selectedId;
                else if (t == -1 && voiceIds.Count > 0)
                    t = voiceIds.First().Value;

                foreach (var voice in voiceIds)
                {
                    vtpl.Append(
                        voice.Key,
                        t == voice.Value,
                        $"{host}/lite/cinemar?rjson={rjson}&title={enc_title}&original_title={enc_original_title}&year={year}&href={enc_href}&s={s}&t={voice.Value}&voice={HttpUtility.UrlEncode(voice.Key)}"
                    );
                }
                #endregion

                var etpl = new EpisodeTpl(vtpl, episodes.Count);

                foreach (var episode in episodes)
                {
                    string name = episode.title;
                    var source = episode.folder?.FirstOrDefault(i =>
                        voiceIds.TryGetValue(VoiceName(i), out int voice_id) && voice_id == t
                        && (NeedsLoad(i) || IsMediaFile(i?.file)));
                    string file = source?.file;

                    if (!NeedsLoad(source) && !IsMediaFile(file))
                        continue;

                    if (NeedsLoad(source))
                    {
                        string link = VideoLink(source, href, $"{title ?? original_title} ({name}, {source.title})");
                        etpl.Append(
                            name, title ?? original_title, s,
                            Regex.Match(name, " ([0-9]+)$").Groups[1].Value,
                            link, "call",
                            streamlink: accsArgs($"{link.Replace("/video?", "/video.m3u8?")}&play=true"),
                            voice_name: VoiceName(source),
                            vast: init.vast
                        );
                        continue;
                    }

                    var streams = BuildStreams(file);
                    if (streams.IsEmpty)
                        continue;

                    etpl.Append(
                        name,
                        title ?? original_title,
                        s,
                        Regex.Match(name, " ([0-9]+)$").Groups[1].Value,
                        streams.Firts().link,
                        streamquality: streams,
                        subtitles: BuildSubtitles(string.IsNullOrEmpty(source.subtitle) ? episode.subtitle : source.subtitle),
                        voice_name: VoiceName(source),
                        vast: init.vast
                    );
                }

                return etpl;
            }
        }
    }
    #endregion

    #region SearchResult
    void SearchDiagnostic(string message)
        => Console.WriteLine($"[Cinemar SEARCH] request={HttpContext?.TraceIdentifier} {message}");

    // Temporary diagnostic probe only: never use its response for search results.
    async Task DiagnoseSearchTransport(string url)
    {
        var timer = Stopwatch.StartNew();
        string stage = "NewPageAsync";

        try
        {
            using (var browser = new PlaywrightBrowser())
            {
                SearchDiagnostic($"probe=start browser={(browser.chromium != null ? "chromium" : browser.firefox != null ? "firefox" : "none")} status={PlaywrightBrowser.Status}");
                var page = await browser.NewPageAsync(init.plugin, proxy: proxy_data);
                SearchDiagnostic($"probe=page created={page != null} elapsed_ms={timer.ElapsedMilliseconds}");

                if (page == null)
                    return;

                stage = "GotoAsync";
                var response = await page.GotoAsync(url, new Microsoft.Playwright.PageGotoOptions
                {
                    Timeout = 10_000,
                    WaitUntil = Microsoft.Playwright.WaitUntilState.Commit
                });

                if (response == null)
                {
                    SearchDiagnostic($"probe=response missing elapsed_ms={timer.ElapsedMilliseconds}");
                    return;
                }

                response.Headers.TryGetValue("server", out string server);
                response.Headers.TryGetValue("cf-mitigated", out string cfMitigated);
                SearchDiagnostic($"probe=response http_status={response.Status} server={SafeSearchDiagnosticValue(server)} cf_mitigated={SafeSearchDiagnosticValue(cfMitigated)} elapsed_ms={timer.ElapsedMilliseconds}");

                stage = "TextAsync";
                string html = await response.TextAsync().WaitAsync(TimeSpan.FromSeconds(10));
                SearchDiagnostic($"probe=body elapsed_ms={timer.ElapsedMilliseconds}");
                LogSearchHtml(html.AsSpan());
            }
        }
        catch (Exception ex)
        {
            SearchDiagnostic($"probe=error stage={stage} type={ex.GetType().Name} message={SafeSearchDiagnosticValue(ex.Message)} elapsed_ms={timer.ElapsedMilliseconds}");
        }
        finally
        {
            SearchDiagnostic($"probe=end elapsed_ms={timer.ElapsedMilliseconds}");
        }
    }

    static string SafeSearchDiagnosticValue(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "-";

        // Retain the error description, not URLs, query strings or multiline call logs.
        value = value.Split(new[] { '\r', '\n' }, 2)[0];
        value = Regex.Replace(value, @"https?://[^\s]+", "[url]", RegexOptions.IgnoreCase);
        value = Regex.Replace(value, @"[\p{Cc}\p{Cf}]", "");
        return value.Length > 240 ? value.Substring(0, 240) : value;
    }

    void LogSearchHtml(ReadOnlySpan<char> html)
    {
        try
        {
            string text = html.ToString();
            string pageTitle = HttpUtility.HtmlDecode(Regex.Match(text, @"<title\b[^>]*>(.*?)</title\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline).Groups[1].Value);
            pageTitle = Regex.Replace(pageTitle ?? string.Empty, @"\s+", " ").Trim();
            pageTitle = Regex.Replace(pageTitle, @"[\p{Cc}\p{Cf}]", "");
            if (pageTitle.Length > 160)
                pageTitle = pageTitle.Substring(0, 160);

            bool Has(string marker) => text.IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0;

            SearchDiagnostic($"html_chars={html.Length} page_title={pageTitle} " +
                $"shortstory={Has("shortstory")} shortstory_meta={Has("shortstory__meta")} " +
                $"dle_content={Has("dle-content")} cloudflare_challenge={Has("cf-chl-") || Has("/cdn-cgi/challenge-platform/") || Has("Just a moment...")} " +
                $"access_denied={Has("Access denied")} browser_error={Has("ERR_") || Has("about:neterror")}");
        }
        catch (Exception ex)
        {
            SearchDiagnostic($"html_diagnostic_error={ex.GetType().Name}");
        }
    }

    SearchModel SearchResult(ReadOnlySpan<char> html, string title, int year)
    {
        if (html.IsEmpty)
            return null;

        var rx = Rx.Matches("<div id=\"[0-9]+\" class=\"shortstory\">(.*?)<div class=\"shortstory__meta\">", html, 0, RegexOptions.Singleline);
        SearchDiagnostic($"matched_rows={rx.Count}");
        if (rx.Count == 0)
            return null;

        string link = null;
        int bestMatch = 0;
        string stitle = SearchNameTo.Convert(title);

        var similar = new SimilarTpl(rx.Count);

        foreach (var row in rx.Rows())
        {
            string href = row.Match("<a href=\"https?://[^/]+/([^\"#]+)");
            if (string.IsNullOrEmpty(href))
                continue;

            string name = row.Match("<h2>([^<]+)</h2>");
            if (string.IsNullOrEmpty(name))
                continue;
            name = HttpUtility.HtmlDecode(name);

            string blockYear = row.Match("Год выпуска:</b><a[^>]*>([0-9]{4})");

            string img = row.Match("<img\\s+data-src=\"([^\"]+)\"");
            if (!string.IsNullOrEmpty(img))
                img = ModInit.conf.host + img;

            string uri = $"{host}/lite/cinemar?href={HttpUtility.UrlEncode(href)}";
            similar.Append(name, blockYear, string.Empty, uri, PosterApi.Size(img));

            if (blockYear == year.ToString())
            {
                string cleanName = Regex.Replace(name, @"\s*\((?:\d{4}|\d+(?:\s*-\s*\d+)?\s+сезон(?:а|ы|ов)?)\)\s*$", "", RegexOptions.IgnoreCase);
                int match = SearchNameTo.Equals(cleanName, stitle) ? 2 : SearchNameTo.Contains(name, stitle) ? 1 : 0;
                if (match > bestMatch)
                {
                    bestMatch = match;
                    link = href;
                }
            }
        }

        if (string.IsNullOrEmpty(link) && similar.IsEmpty)
            return null;

        return new SearchModel()
        {
            link = link,
            similar = similar
        };
    }
    #endregion

    #region DecodeFile
    string DecodeFile(string fileEncode)
    {
        return PlayerFileDecoder.Decode(fileEncode);
    }
    #endregion
}
