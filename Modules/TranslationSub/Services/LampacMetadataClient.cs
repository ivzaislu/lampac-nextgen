using Newtonsoft.Json.Linq;
using Shared;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using TranslationSub.Models;

namespace TranslationSub.Services;

internal sealed class LampacSourceDescriptor
{
    public string Id { get; init; }
    public string Name { get; init; }
    public string Url { get; init; }
}

internal sealed class LampacMetadataResponse
{
    public int StatusCode { get; init; }
    public string Body { get; init; }
    public string Location { get; init; }
    public bool IsSuccess => StatusCode >= 200 && StatusCode < 300;
    public bool IsRedirect => StatusCode >= 300 && StatusCode < 400 && !string.IsNullOrWhiteSpace(Location);
}

internal static class LampacMetadataClient
{
    const int MaxMetadataDepth = 4;
    const int MaxMetadataPages = 48;

    static readonly object clientLocker = new();
    static HttpClient localClient;
    static string localClientKey;

    // Generic HTML emitted by Shared.Models.Templates (SeasonTpl/VoiceTpl/EpisodeTpl/MovieTpl).
    // There are intentionally no branches for individual online modules here.
    static readonly Regex onlineElementRegex = new(
        @"<(?<tag>[a-zA-Z0-9]+)\b(?<attrs>[^>]*videos__(?:item|button)[^>]*)>(?<inner>.*?)</\k<tag>>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant);

    static readonly Regex attributeRegex = new(
        @"(?<name>[\w:-]+)\s*=\s*(?:""(?<dq>[^""]*)""|'(?<sq>[^']*)')",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    static readonly Regex tagRegex = new(
        @"<[^>]+>",
        RegexOptions.Compiled | RegexOptions.Singleline | RegexOptions.CultureInvariant);

    static readonly Regex seasonTextRegex = new(
        @"(?:season|сезон)\D{0,8}(?<n>\d{1,3})|(?<n2>\d{1,3})\D{0,8}(?:season|сезон)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    static readonly HttpClient externalClient = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseProxy = false
    })
    {
        Timeout = TimeSpan.FromSeconds(30)
    };

    public static async Task<IReadOnlyList<LampacVoiceMetadata>> ReadAsync(TranslationMetadataQuery query)
    {
        if (query == null || query.Sources?.Count == 0)
            return Array.Empty<LampacVoiceMetadata>();

        var discovered = await DiscoverSourcesAsync(query).ConfigureAwait(false);
        discovered = discovered
            .Where(x => query.Sources.Any(id => string.Equals(id, x.Id, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (discovered.Count == 0)
            return Array.Empty<LampacVoiceMetadata>();

        var values = await Task.WhenAll(discovered.Select(source => ReadSourceAsync(source, query))).ConfigureAwait(false);
        return values
            .SelectMany(x => x)
            .Where(x => x != null && !string.IsNullOrWhiteSpace(x.VoiceName))
            .OrderBy(x => x.Source, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.Season)
            .ThenBy(x => x.VoiceName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    static async Task<List<LampacSourceDescriptor>> DiscoverSourcesAsync(TranslationMetadataQuery query)
    {
        string url = "/lite/events";
        url = AppendQuery(url, "serial", query?.IsSerial == false ? "0" : "1");
        url = AppendQuery(url, "source", "tmdb");
        url = AppendQuery(url, "islite", "true");

        if (query != null)
        {
            if (!string.IsNullOrWhiteSpace(query.ContentId))
                url = AppendQuery(url, "id", query.ContentId);
            if (query.KpId > 0)
                url = AppendQuery(url, "kinopoisk_id", query.KpId.ToString());
            if (long.TryParse(query.TmdbId, out long tmdbId) && tmdbId > 0)
                url = AppendQuery(url, "tmdb_id", tmdbId.ToString());
            if (!string.IsNullOrWhiteSpace(query.ImdbId))
                url = AppendQuery(url, "imdb_id", query.ImdbId);
            if (!string.IsNullOrWhiteSpace(query.Title))
                url = AppendQuery(url, "title", query.Title);
            if (!string.IsNullOrWhiteSpace(query.OriginalTitle))
                url = AppendQuery(url, "original_title", query.OriginalTitle);
            if (query.Year > 0)
                url = AppendQuery(url, "year", query.Year.ToString());
        }

        var response = await GetAsync(url, query?.Uid).ConfigureAwait(false);
        if (response?.IsSuccess != true || string.IsNullOrWhiteSpace(response.Body))
            return new List<LampacSourceDescriptor>();

        JToken root;
        try { root = JToken.Parse(response.Body); }
        catch { return new List<LampacSourceDescriptor>(); }

        JArray array = root as JArray;
        if (array == null && root is JObject obj)
            array = obj["online"] as JArray ?? obj["items"] as JArray;
        if (array == null)
            return new List<LampacSourceDescriptor>();

        var result = new Dictionary<string, LampacSourceDescriptor>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in array.OfType<JObject>())
        {
            string route = item.Value<string>("url")?.Trim();
            string id = NormalizeSourceId(item.Value<string>("balanser")) ?? SourceIdFromUrl(route);
            if (id == null || string.IsNullOrWhiteSpace(route))
                continue;

            string name = item.Value<string>("name");
            if (string.IsNullOrWhiteSpace(name))
                name = id;

            result[id] = new LampacSourceDescriptor
            {
                Id = id,
                Name = name.Trim(),
                Url = route
            };
        }

        return result.Values
            .OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.Id, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    static string NormalizeSourceId(string value)
        => TranslationSettingsStore.NormalizeSourceId(value);

    static string SourceIdFromUrl(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        string path = value.Trim();
        if (Uri.TryCreate(path, UriKind.Absolute, out var absolute))
            path = absolute.AbsolutePath;
        else
        {
            int query = path.IndexOf('?');
            if (query >= 0)
                path = path[..query];
        }

        const string marker = "/lite/";
        int index = path.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0)
            return null;

        string id = path[(index + marker.Length)..].Trim('/');
        return NormalizeSourceId(id);
    }

    static async Task<List<LampacVoiceMetadata>> ReadSourceAsync(LampacSourceDescriptor source, TranslationMetadataQuery query)
    {
        var rows = new List<MetadataRow>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        await TraverseAsync(
            source,
            query,
            BuildSourceRequest(source.Url, query),
            null,
            null,
            query.Season,
            0,
            visited,
            rows).ConfigureAwait(false);

        return rows
            .Where(x => x.Episode > 0)
            .Where(x => !query.IsSerial || query.Season <= 0 || x.Season == query.Season)
            .GroupBy(x => new
            {
                season = x.Season,
                voice = string.IsNullOrWhiteSpace(x.VoiceId)
                    ? StableMetadataVoiceId(x.VoiceName, source.Id)
                    : x.VoiceId
            })
            .Select(group => new LampacVoiceMetadata
            {
                Source = source.Id,
                SourceName = source.Name,
                VoiceId = group.Key.voice,
                VoiceName = group.Select(x => x.VoiceName).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x)),
                Season = group.Key.season,
                Episodes = group.Select(x => x.Episode).Where(x => x > 0).Distinct().OrderBy(x => x).ToList()
            })
            .Where(x => !string.IsNullOrWhiteSpace(x.VoiceName) && x.Episodes.Count > 0)
            .ToList();
    }

    static string BuildSourceRequest(string sourceUrl, TranslationMetadataQuery query)
    {
        string url = sourceUrl;
        if (!string.IsNullOrWhiteSpace(query.ContentId))
            url = AppendQuery(url, "id", query.ContentId);
        if (query.KpId > 0)
            url = AppendQuery(url, "kinopoisk_id", query.KpId.ToString());
        if (long.TryParse(query.TmdbId, out long tmdbId) && tmdbId > 0)
            url = AppendQuery(url, "tmdb_id", tmdbId.ToString());
        if (!string.IsNullOrWhiteSpace(query.ImdbId))
            url = AppendQuery(url, "imdb_id", query.ImdbId);
        if (!string.IsNullOrWhiteSpace(query.Title))
            url = AppendQuery(url, "title", query.Title);
        if (!string.IsNullOrWhiteSpace(query.OriginalTitle))
            url = AppendQuery(url, "original_title", query.OriginalTitle);
        if (query.Year > 0)
            url = AppendQuery(url, "year", query.Year.ToString());

        url = AppendQuery(url, "serial", query.IsSerial ? "1" : "0");
        url = AppendQuery(url, "source", "tmdb");
        return url;
    }

    static async Task TraverseAsync(
        LampacSourceDescriptor source,
        TranslationMetadataQuery query,
        string url,
        string inheritedVoiceName,
        string inheritedVoiceId,
        int inheritedSeason,
        int depth,
        HashSet<string> visited,
        List<MetadataRow> rows)
    {
        if (depth > MaxMetadataDepth || visited.Count >= MaxMetadataPages || string.IsNullOrWhiteSpace(url))
            return;

        if (!visited.Add(url.Trim()))
            return;

        var response = await GetFollowingRedirectsAsync(url, query.Uid).ConfigureAwait(false);
        if (response?.IsSuccess != true || string.IsNullOrWhiteSpace(response.Body))
            return;

        var nodes = ParseMetadataNodes(response.Body);
        if (nodes.Count == 0)
            return;

        var voices = nodes.Where(x => x.Kind == "button" || x.Kind == "voice").ToList();
        var activeVoice = voices.FirstOrDefault(x => x.Active) ?? voices.FirstOrDefault();
        string pageVoiceName = inheritedVoiceName;
        string pageVoiceId = inheritedVoiceId;
        if (activeVoice != null)
        {
            pageVoiceName = activeVoice.VoiceName ?? activeVoice.Text ?? pageVoiceName;
            pageVoiceId = activeVoice.VoiceId;
            if (string.IsNullOrWhiteSpace(pageVoiceId))
                pageVoiceId = StableMetadataVoiceId(pageVoiceName, source.Id);
        }

        var follow = new List<FollowNode>();
        int terminalOrdinal = 0;

        foreach (var node in nodes)
        {
            string voiceName = !string.IsNullOrWhiteSpace(node.VoiceName) ? node.VoiceName : pageVoiceName;
            string voiceId = !string.IsNullOrWhiteSpace(node.VoiceId) ? node.VoiceId : pageVoiceId;
            int season = node.Season > 0 ? node.Season : inheritedSeason;

            if (node.Kind == "button" || node.Kind == "voice")
            {
                voiceName = node.VoiceName ?? node.Text ?? voiceName;
                if (string.IsNullOrWhiteSpace(voiceId))
                    voiceId = StableMetadataVoiceId(voiceName, source.Id);

                if (!string.IsNullOrWhiteSpace(node.Url))
                {
                    follow.Add(new FollowNode
                    {
                        Url = ResolveMetadataLink(url, node.Url),
                        VoiceName = voiceName,
                        VoiceId = voiceId,
                        Season = season
                    });
                }
                continue;
            }

            bool terminal = node.Episode > 0
                || node.Kind is "episode" or "movie"
                || string.Equals(node.Method, "play", StringComparison.OrdinalIgnoreCase)
                || string.Equals(node.Method, "call", StringComparison.OrdinalIgnoreCase);

            if (terminal)
            {
                terminalOrdinal++;
                int episode = query.IsSerial
                    ? (node.Episode > 0 ? node.Episode : terminalOrdinal)
                    : 1;

                if (!query.IsSerial)
                {
                    season = 0;
                    if (string.IsNullOrWhiteSpace(voiceName))
                        voiceName = node.VoiceName ?? node.Text;
                }
                else if (season <= 0 && query.Season > 0)
                {
                    season = query.Season;
                }

                if (string.IsNullOrWhiteSpace(voiceName))
                    voiceName = "Неизвестно";
                if (string.IsNullOrWhiteSpace(voiceId))
                    voiceId = StableMetadataVoiceId(voiceName, source.Id);

                rows.Add(new MetadataRow
                {
                    VoiceName = voiceName.Trim(),
                    VoiceId = voiceId,
                    Season = season,
                    Episode = episode
                });

                // Playback boundary: never follow play/call/episode/movie URLs.
                continue;
            }

            if (node.Similar || string.IsNullOrWhiteSpace(node.Url) || !IsMetadataNavigation(node))
                continue;

            int nextSeason = node.Season > 0 ? node.Season : SeasonFromText(node.Text);
            if (nextSeason <= 0)
                nextSeason = season;

            if (query.IsSerial && query.Season > 0 && nextSeason > 0 && nextSeason != query.Season)
                continue;

            follow.Add(new FollowNode
            {
                Url = ResolveMetadataLink(url, node.Url),
                VoiceName = voiceName,
                VoiceId = voiceId,
                Season = nextSeason
            });
        }

        foreach (var next in follow.Where(x => !string.IsNullOrWhiteSpace(x.Url)))
        {
            await TraverseAsync(
                source,
                query,
                next.Url,
                next.VoiceName,
                next.VoiceId,
                next.Season,
                depth + 1,
                visited,
                rows).ConfigureAwait(false);
        }
    }

    static bool IsMetadataNavigation(OnlineNode node)
    {
        if (node == null)
            return false;
        if (node.Kind is "season" or "voice" or "button")
            return true;
        return string.Equals(node.Method, "link", StringComparison.OrdinalIgnoreCase);
    }

    static List<OnlineNode> ParseMetadataNodes(string body)
    {
        var result = ParseHtmlNodes(body);
        if (result.Count > 0)
            return result;

        try
        {
            JToken root = JToken.Parse(body);
            AddJsonNodes(root, null, null, 0, null, result);
        }
        catch { }

        return result;
    }

    // Shared.Models.Templates JSON contract:
    // { type: "season|episode|movie", voice: VoiceDto[], data: *Dto[] }.
    // Child DTOs intentionally have no `type`, so their semantic kind comes from
    // the response type/property instead of provider-specific fields.
    static void AddJsonNodes(
        JToken token,
        string inheritedVoiceName,
        string inheritedVoiceId,
        int inheritedSeason,
        string contextualKind,
        List<OnlineNode> result)
    {
        if (token == null)
            return;

        if (token is JArray array)
        {
            foreach (var child in array)
                AddJsonNodes(child, inheritedVoiceName, inheritedVoiceId, inheritedSeason, contextualKind, result);
            return;
        }

        if (token is not JObject obj)
            return;

        string responseType = NormalizeNodeKind(ReadJsonString(obj, "type"));
        if (responseType != null && (obj["data"] is JArray || obj["voice"] is JArray))
        {
            AddJsonNodes(obj["voice"], inheritedVoiceName, inheritedVoiceId, inheritedSeason, "voice", result);
            AddJsonNodes(obj["data"], inheritedVoiceName, inheritedVoiceId, inheritedSeason, responseType, result);
            return;
        }

        string kind = NormalizeNodeKind(contextualKind) ?? responseType;
        if (kind == null)
        {
            foreach (var property in obj.Properties())
            {
                string childKind = property.Name.Equals("voice", StringComparison.OrdinalIgnoreCase)
                    ? "voice"
                    : null;
                AddJsonNodes(property.Value, inheritedVoiceName, inheritedVoiceId, inheritedSeason, childKind, result);
            }
            return;
        }

        string text = ReadJsonString(obj, "name", "title", "text", "translate");
        string voiceName = ReadJsonString(obj, "voice_name", "voiceName", "translation", "voice") ?? inheritedVoiceName;
        string voiceId = ReadJsonString(obj, "voice_id", "voiceId", "translation_id", "translationId") ?? inheritedVoiceId;
        int season = ReadJsonInt(obj, "season", "season_number", "s");
        int episode = ReadJsonInt(obj, "episode", "episode_number", "e");

        if (kind == "season" && season <= 0)
            season = ReadJsonInt(obj, "id");
        if (season <= 0)
            season = inheritedSeason;

        if (kind == "voice")
        {
            voiceName = text ?? voiceName;
            if (string.IsNullOrWhiteSpace(voiceId))
                voiceId = VoiceNormalize.Normalize(voiceName);
        }
        else if (kind == "movie" && string.IsNullOrWhiteSpace(voiceName))
        {
            voiceName = ReadJsonString(obj, "voice_name", "translate") ?? text;
        }

        result.Add(new OnlineNode
        {
            Kind = kind,
            Text = text,
            Url = ReadJsonString(obj, "url", "link"),
            Method = ReadJsonString(obj, "method"),
            Season = season,
            Episode = episode,
            VoiceName = voiceName,
            VoiceId = voiceId,
            Similar = ReadJsonBool(obj, "similar"),
            Active = ReadJsonBool(obj, "active")
        });
    }

    static string NormalizeNodeKind(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        string kind = value.Trim().ToLowerInvariant();
        return kind is "season" or "voice" or "episode" or "movie" ? kind : null;
    }

    static List<OnlineNode> ParseHtmlNodes(string html)
    {
        var result = new List<OnlineNode>();
        if (string.IsNullOrWhiteSpace(html))
            return result;

        foreach (Match match in onlineElementRegex.Matches(html))
        {
            var attrs = ParseAttributes(match.Groups["attrs"].Value);
            string classes = ReadAttribute(attrs, "class") ?? string.Empty;
            string kind = classes.IndexOf("videos__button", StringComparison.OrdinalIgnoreCase) >= 0
                ? "button"
                : "item";

            JObject data = null;
            string rawJson = ReadAttribute(attrs, "data-json");
            if (!string.IsNullOrWhiteSpace(rawJson))
            {
                try { data = JObject.Parse(WebUtility.HtmlDecode(rawJson)); }
                catch { }
            }

            string text = WebUtility.HtmlDecode(tagRegex.Replace(match.Groups["inner"].Value, " "));
            text = Regex.Replace(text ?? string.Empty, @"\s+", " ").Trim();

            int season = ReadInt(ReadAttribute(attrs, "s"));
            if (season <= 0)
                season = ReadJsonInt(data, "season", "season_number", "s");

            int episode = ReadInt(ReadAttribute(attrs, "e"));
            if (episode <= 0)
                episode = ReadJsonInt(data, "episode", "episode_number", "e");

            string voiceName = ReadJsonString(data, "voice_name", "voiceName", "translation", "voice");
            string voiceId = ReadJsonString(data, "voice_id", "voiceId", "translation_id", "translationId");
            if (kind == "button" && string.IsNullOrWhiteSpace(voiceName))
                voiceName = text;

            string semanticKind = kind;
            string jsonType = NormalizeNodeKind(ReadJsonString(data, "type"));
            if (jsonType != null)
                semanticKind = jsonType;

            result.Add(new OnlineNode
            {
                Kind = semanticKind,
                Text = text,
                Url = ReadJsonString(data, "url", "link") ?? ReadAttribute(attrs, "href"),
                Method = ReadJsonString(data, "method"),
                Season = season,
                Episode = episode,
                VoiceName = voiceName,
                VoiceId = voiceId,
                Similar = ReadJsonBool(data, "similar"),
                Active = HasCssClass(classes, "active") || ReadJsonBool(data, "active")
            });
        }

        return result;
    }

    static Dictionary<string, string> ParseAttributes(string raw)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in attributeRegex.Matches(raw ?? string.Empty))
        {
            string value = match.Groups["dq"].Success
                ? match.Groups["dq"].Value
                : match.Groups["sq"].Value;
            result[match.Groups["name"].Value] = value;
        }
        return result;
    }

    static bool HasCssClass(string classes, string name)
        => (classes ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Any(x => x.Equals(name, StringComparison.OrdinalIgnoreCase));

    static string ResolveMetadataLink(string currentUrl, string nextUrl)
    {
        if (string.IsNullOrWhiteSpace(nextUrl))
            return null;

        nextUrl = WebUtility.HtmlDecode(nextUrl.Trim());
        if (Uri.TryCreate(nextUrl, UriKind.Absolute, out _))
            return nextUrl;
        if (nextUrl.StartsWith('/'))
            return nextUrl;

        try
        {
            Uri current = Uri.TryCreate(currentUrl, UriKind.Absolute, out var absolute)
                ? absolute
                : new Uri(new Uri("http://lampac.local/"), currentUrl.TrimStart('/'));
            Uri resolved = new Uri(current, nextUrl);
            if (resolved.Host.Equals("lampac.local", StringComparison.OrdinalIgnoreCase))
                return resolved.PathAndQuery;
            return resolved.ToString();
        }
        catch
        {
            return nextUrl;
        }
    }

    static int SeasonFromText(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return 0;

        Match match = seasonTextRegex.Match(value);
        if (!match.Success)
            return 0;

        string raw = match.Groups["n"].Success ? match.Groups["n"].Value : match.Groups["n2"].Value;
        return int.TryParse(raw, out int season) && season > 0 ? season : 0;
    }

    static string StableMetadataVoiceId(string voiceName, string sourceId)
    {
        string normalized = VoiceNormalize.Normalize(voiceName);
        if (!string.IsNullOrWhiteSpace(normalized)
            && !string.Equals(voiceName, "Неизвестно", StringComparison.OrdinalIgnoreCase))
            return normalized;
        return (sourceId ?? "lampac") + ":default";
    }

    static string ReadAttribute(Dictionary<string, string> attrs, string name)
        => attrs != null && attrs.TryGetValue(name, out var value) ? value : null;

    static int ReadInt(string value)
        => int.TryParse(value, out int parsed) && parsed > 0 ? parsed : 0;

    static int ReadJsonInt(JObject value, params string[] names)
    {
        if (value == null)
            return 0;
        foreach (string name in names)
        {
            JToken token = value[name];
            if (token != null && int.TryParse(token.ToString(), out int parsed) && parsed > 0)
                return parsed;
        }
        return 0;
    }

    static string ReadJsonString(JObject value, params string[] names)
    {
        if (value == null)
            return null;
        foreach (string name in names)
        {
            string text = value.Value<string>(name);
            if (!string.IsNullOrWhiteSpace(text))
                return text.Trim();
        }
        return null;
    }

    static bool ReadJsonBool(JObject value, string name)
    {
        if (value == null || value[name] == null)
            return false;
        JToken token = value[name];
        if (token.Type == JTokenType.Boolean)
            return token.Value<bool>();
        return bool.TryParse(token.ToString(), out bool result) && result;
    }

    static async Task<LampacMetadataResponse> GetFollowingRedirectsAsync(string pathOrUrl, string uid)
    {
        string current = pathOrUrl;
        for (int i = 0; i < 4; i++)
        {
            var response = await GetAsync(current, uid).ConfigureAwait(false);
            if (response == null)
                return null;
            if (!response.IsRedirect)
                return response;
            current = ResolveMetadataLink(current, response.Location);
        }
        return null;
    }

    static async Task<LampacMetadataResponse> GetAsync(string pathOrUrl, string uid = null)
    {
        if (string.IsNullOrWhiteSpace(pathOrUrl))
            return null;

        try
        {
            if (!string.IsNullOrWhiteSpace(uid) && !HasQueryKey(pathOrUrl, "uid"))
                pathOrUrl = AppendQuery(pathOrUrl, "uid", uid.Trim());

            Uri uri = ResolveRequestUri(pathOrUrl, out bool localRoute);
            if (uri == null)
                return null;

            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.TryAddWithoutValidation("X-TranslationSub-Metadata", "1");

            using var response = await GetClient(localRoute)
                .SendAsync(request, HttpCompletionOption.ResponseContentRead)
                .ConfigureAwait(false);
            string body = response.Content == null
                ? null
                : await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            return new LampacMetadataResponse
            {
                StatusCode = (int)response.StatusCode,
                Body = body,
                Location = response.Headers.Location?.ToString()
            };
        }
        catch
        {
            return null;
        }
    }

    public static string AppendQuery(string pathOrUrl, string key, string value)
    {
        if (string.IsNullOrWhiteSpace(pathOrUrl) || string.IsNullOrWhiteSpace(key) || HasQueryKey(pathOrUrl, key))
            return pathOrUrl;

        string separator = pathOrUrl.Contains('?') ? "&" : "?";
        return pathOrUrl + separator + Uri.EscapeDataString(key) + "=" + Uri.EscapeDataString(value ?? string.Empty);
    }

    static bool HasQueryKey(string pathOrUrl, string key)
    {
        int queryIndex = pathOrUrl?.IndexOf('?') ?? -1;
        if (queryIndex < 0 || queryIndex >= pathOrUrl.Length - 1)
            return false;

        string query = pathOrUrl[(queryIndex + 1)..];
        foreach (string pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            string name = pair.Split('=', 2)[0];
            try { name = Uri.UnescapeDataString(name); } catch { }
            if (name.Equals(key, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    static HttpClient GetClient(bool localRoute)
    {
        if (!localRoute)
            return externalClient;

        var listen = CoreInit.conf?.listen;
        string key = string.Join("|", listen?.sock ?? string.Empty, listen?.ip ?? string.Empty, listen?.port ?? 0);

        lock (clientLocker)
        {
            if (localClient != null && string.Equals(localClientKey, key, StringComparison.Ordinal))
                return localClient;

            localClient?.Dispose();
            localClient = CreateLocalClient(listen?.sock);
            localClientKey = key;
            return localClient;
        }
    }

    static HttpClient CreateLocalClient(string socketName)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseProxy = false
        };

        if (!string.IsNullOrWhiteSpace(socketName))
        {
            string socketPath = $"/var/run/{socketName}.sock";
            handler.ConnectCallback = async (_, cancellationToken) =>
            {
                var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                try
                {
                    await socket.ConnectAsync(new UnixDomainSocketEndPoint(socketPath), cancellationToken).ConfigureAwait(false);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch
                {
                    socket.Dispose();
                    throw;
                }
            };
        }

        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
    }

    static Uri ResolveRequestUri(string pathOrUrl, out bool localRoute)
    {
        localRoute = true;
        string path = pathOrUrl?.Trim();
        if (string.IsNullOrWhiteSpace(path))
            return null;

        if (Uri.TryCreate(path, UriKind.Absolute, out var absolute) && !IsLocalAddress(absolute))
        {
            localRoute = false;
            return absolute;
        }

        if (Uri.TryCreate(path, UriKind.Absolute, out absolute))
            path = absolute.PathAndQuery;
        if (!path.StartsWith('/'))
            path = "/" + path;

        var listen = CoreInit.conf?.listen;
        if (listen == null)
            return null;

        if (!string.IsNullOrWhiteSpace(listen.sock))
            return new Uri(new Uri("http://localhost/"), path.TrimStart('/'));
        if (listen.port <= 0)
            return null;

        string host = listen.ip;
        if (string.IsNullOrWhiteSpace(host)
            || host.Equals("any", StringComparison.OrdinalIgnoreCase)
            || host.Equals("broadcast", StringComparison.OrdinalIgnoreCase)
            || host == "0.0.0.0"
            || host == "::")
            host = "127.0.0.1";
        else if (IPAddress.TryParse(host, out var address) && address.AddressFamily == AddressFamily.InterNetworkV6)
            host = $"[{host}]";

        return new Uri(new Uri($"http://{host}:{listen.port}/"), path.TrimStart('/'));
    }

    static bool IsLocalAddress(Uri uri)
    {
        if (uri == null)
            return false;
        if (uri.IsLoopback || uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            return true;

        string listenHost = CoreInit.conf?.listen?.ip;
        if (!string.IsNullOrWhiteSpace(listenHost)
            && !listenHost.Equals("any", StringComparison.OrdinalIgnoreCase)
            && !listenHost.Equals("broadcast", StringComparison.OrdinalIgnoreCase)
            && uri.Host.Equals(listenHost.Trim('[', ']'), StringComparison.OrdinalIgnoreCase))
            return true;

        return false;
    }

    sealed class OnlineNode
    {
        public string Kind { get; init; }
        public string Text { get; init; }
        public string Url { get; init; }
        public string Method { get; init; }
        public int Season { get; init; }
        public int Episode { get; init; }
        public string VoiceName { get; init; }
        public string VoiceId { get; init; }
        public bool Similar { get; init; }
        public bool Active { get; init; }
    }

    sealed class FollowNode
    {
        public string Url { get; init; }
        public string VoiceName { get; init; }
        public string VoiceId { get; init; }
        public int Season { get; init; }
    }

    sealed class MetadataRow
    {
        public string VoiceName { get; init; }
        public string VoiceId { get; init; }
        public int Season { get; init; }
        public int Episode { get; init; }
    }
}
