using Newtonsoft.Json;
using Shared.Models.Base;
using Shared.Services;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TranslationSub.Models;

namespace TranslationSub.Providers;

public class CdnVideoHubVoiceProvider : IVoiceProvider
{
    public string Source => "cdnvideohub";
    public string Path => "/lite/cdnvideohub";

    public async Task<List<TranslationVariant>> GetVariants(VoiceProviderQuery query)
    {
        var result = new List<TranslationVariant>();

        if (ModInit.conf?.videohub != true || query.KpId <= 0)
            return result;

        try
        {
            string url = $"{ModInit.conf.videohub_host.TrimEnd('/')}/api/v1/player/sv/playlist?pub=12&aggr=kp&id={query.KpId}";
            string json = await Http.Get(url,
                timeoutSeconds: 12,
                headers: HeadersModel.Init(Http.defaultFullHeaders,
                    ("referer", "http://lostfilm5.org"),
                    ("sec-fetch-dest", "empty"),
                    ("sec-fetch-mode", "cors"),
                    ("sec-fetch-site", "cross-site")
                ),
                httpversion: 2);

            if (string.IsNullOrWhiteSpace(json))
                return result;

            var root = JsonConvert.DeserializeObject<RootObject>(json);
            if (root?.items == null || root.items.Length == 0)
                return result;

            if (!root.isSerial)
            {
                foreach (var item in root.items)
                {
                    string voice = GetVoice(item);
                    if (string.IsNullOrWhiteSpace(voice))
                        continue;

                    result.Add(Create(voice, 0, 1));
                }

                return Distinct(result);
            }

            IEnumerable<Item> items = root.items;
            if (query.Season > 0)
                items = items.Where(x => x.season == query.Season);

            foreach (var group in items
                .Where(x => x.season > 0 && x.episode > 0)
                .GroupBy(x => new { x.season, voice = GetVoice(x) }))
            {
                if (string.IsNullOrWhiteSpace(group.Key.voice))
                    continue;

                int latestEpisode = group.Max(x => (int)x.episode);
                result.Add(Create(group.Key.voice, group.Key.season, latestEpisode));
            }
        }
        catch { }

        return Distinct(result);
    }

    static string GetVoice(Item item)
        => !string.IsNullOrWhiteSpace(item?.voiceStudio) ? item.voiceStudio : item?.voiceType;

    TranslationVariant Create(string voice, int season, int episode)
    {
        return new TranslationVariant
        {
            source = Source,
            path = Path,
            translation = voice,
            translation_id = voice,
            season = season,
            episode = episode,
            quality = "1080p"
        };
    }

    static List<TranslationVariant> Distinct(List<TranslationVariant> values)
        => values
            .GroupBy(x => $"{x.season}:{x.translation}", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderByDescending(x => x.episode).First())
            .ToList();

    class RootObject
    {
        public bool isSerial { get; set; }
        public Item[] items { get; set; }
    }

    class Item
    {
        public short season { get; set; }
        public short episode { get; set; }
        public string voiceStudio { get; set; }
        public string voiceType { get; set; }
        public string vkId { get; set; }
    }
}
