using Newtonsoft.Json;
using Shared.Models.Base;
using Shared.Services;
using Shared.Services.Utilities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using TranslationSub.Models;
using TranslationSub.Services;

namespace TranslationSub.Providers;

public class ZetflixDbVoiceProvider : IVoiceProvider
{
    public string Source => "zetflixdb";
    public string Path => "/lite/zetflixdb";

    public async Task<List<TranslationVariant>> GetVariants(VoiceProviderQuery query)
    {
        var result = new List<TranslationVariant>();

        if (ModInit.conf?.zetflixdb != true || query.KpId <= 0)
            return result;

        try
        {
            string encodedKp = EncodeKp(query.KpId);
            if (string.IsNullOrWhiteSpace(encodedKp))
                return result;

            string host = ModInit.conf.zetflixdb_apihost.TrimEnd('/');
            string url = $"{host}/embed/AO/kinopoisk/{encodedKp}/";

            string html = await Http.Get(url,
                referer: host + "/",
                timeoutSeconds: 15,
                headers: HeadersModel.Init(Http.defaultFullHeaders,
                    ("sec-fetch-dest", "iframe"),
                    ("sec-fetch-mode", "navigate"),
                    ("sec-fetch-site", "cross-site")
                ),
                httpversion: 2);

            if (string.IsNullOrWhiteSpace(html))
                return result;

            string json = DecodePlayer(html);
            if (string.IsNullOrWhiteSpace(json))
                return result;

            var root = JsonConvert.DeserializeObject<RootNode>(json);
            if (root?.file == null || root.file.Length == 0)
                return result;

            bool isMovie = !json.Contains("\"folder\":", StringComparison.Ordinal);
            string quality = DetectQuality(json);

            if (isMovie)
            {
                foreach (var item in root.file)
                {
                    if (string.IsNullOrWhiteSpace(item?.title))
                        continue;

                    result.Add(Create(item.title, 0, 1, quality));
                }

                return Distinct(result);
            }

            foreach (var seasonNode in root.file)
            {
                int season = ParseLeadingNumber(seasonNode?.title);
                if (season <= 0 || (query.Season > 0 && season != query.Season))
                    continue;

                if (seasonNode?.folder == null)
                    continue;

                foreach (var episodeNode in seasonNode.folder)
                {
                    int episode = ParseLeadingNumber(episodeNode?.title);
                    if (episode <= 0 || episodeNode?.folder == null)
                        continue;

                    foreach (var voiceNode in episodeNode.folder)
                    {
                        string voice = NormalizeVoiceTitle(voiceNode?.title);
                        if (string.IsNullOrWhiteSpace(voice))
                            continue;

                        result.Add(Create(voice, season, episode, quality));
                    }
                }
            }
        }
        catch { }

        return Distinct(result);
    }

    TranslationVariant Create(string voice, int season, int episode, string quality)
    {
        return new TranslationVariant
        {
            source = Source,
            path = Path,
            translation = voice,
            translation_id = VoiceNormalize.Normalize(voice),
            season = season,
            episode = episode,
            quality = quality
        };
    }

    static List<TranslationVariant> Distinct(List<TranslationVariant> values)
        => values
            .Where(x => !string.IsNullOrWhiteSpace(x.translation))
            .GroupBy(x => $"{x.season}:{VoiceNormalize.Normalize(x.translation)}")
            .Select(g => g.OrderByDescending(x => x.episode).First())
            .OrderBy(x => x.season)
            .ThenBy(x => x.translation)
            .ToList();

    static string EncodeKp(long kp)
    {
        string base64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(kp.ToString())).TrimEnd('=');
        return new string(base64.Reverse().ToArray());
    }

    static string DecodePlayer(string html)
    {
        const string startMarker = "new Player(\"";
        const string endMarker = "\");";

        int start = html.IndexOf(startMarker, StringComparison.Ordinal);
        if (start < 0)
            return null;

        start += startMarker.Length;
        int end = html.IndexOf(endMarker, start, StringComparison.Ordinal);
        if (end <= start)
            return null;

        string payload = html.Substring(start, end - start);
        if (payload.Length <= 73)
            return null;

        string base64 = payload.Substring(73);
        if (Regex.IsMatch(base64, "//[^=]+="))
            base64 = Regex.Replace(base64, "//[^=]+=", "");

        return CrypTo.DecodeBase64(base64);
    }

    static string NormalizeVoiceTitle(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        return Regex.Replace(value, "^[a-zA-Z]{3} \\| ", "").Trim();
    }

    static int ParseLeadingNumber(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return 0;

        return int.TryParse(Regex.Match(value, "^([0-9]+)").Groups[1].Value, out int n) ? n : 0;
    }

    static string DetectQuality(string json)
    {
        if (json.Contains("2160p", StringComparison.OrdinalIgnoreCase)) return "2160p";
        if (json.Contains("1080p", StringComparison.OrdinalIgnoreCase)) return "1080p";
        if (json.Contains("720p", StringComparison.OrdinalIgnoreCase)) return "720p";
        return "480p";
    }

    class RootNode
    {
        public Node[] file { get; set; }
    }

    class Node
    {
        public string title { get; set; }
        public string file { get; set; }
        public Node[] folder { get; set; }
    }
}
