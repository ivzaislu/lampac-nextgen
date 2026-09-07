using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using TranslationSub.Models;
using TranslationSub.Services;

namespace TranslationSub.Providers;

public static class TranslationProviderHub
{
    static readonly IVoiceProvider[] providers =
    {
        new FlixCdnVoiceProvider(),
        new PhantomVoiceProvider(),
        new ZetflixDbVoiceProvider(),
        new CdnVideoHubVoiceProvider()
    };

    public static async Task<TranslationVariantsResponse> GetVariants(VoiceProviderQuery query)
    {
        if (ModInit.conf?.enable != true)
            return new TranslationVariantsResponse();

        var tasks = providers.Select(async provider =>
        {
            List<TranslationVariant> values;

            try
            {
                values = await provider.GetVariants(query).ConfigureAwait(false) ?? new List<TranslationVariant>();
            }
            catch
            {
                values = new List<TranslationVariant>();
            }

            foreach (var value in values)
            {
                value.source ??= provider.Source;
                value.path ??= provider.Path;
                value.KpId = query.KpId > 0 ? query.KpId.ToString() : null;
                value.ImdbId = query.ImdbId;
            }

            return new TranslationSourceBlock
            {
                Source = provider.Source,
                Path = provider.Path,
                Translations = values
            };
        });

        var blocks = (await Task.WhenAll(tasks).ConfigureAwait(false)).ToList();
        var raw = blocks.SelectMany(x => x.Translations).ToList();

        var combined = raw
            .Where(x => !string.IsNullOrWhiteSpace(x.translation))
            .GroupBy(x => new
            {
                x.season,
                voice = StableVoiceId(x.translation, x.source, x.translation_id)
            })
            .Select(group =>
            {
                var best = group
                    .OrderByDescending(x => x.episode)
                    .ThenByDescending(x => QualityNumber(x.quality))
                    .First();

                var sources = group
                    .GroupBy(x => x.source ?? string.Empty, StringComparer.OrdinalIgnoreCase)
                    .Select(g => g
                        .OrderByDescending(x => x.episode)
                        .ThenByDescending(x => QualityNumber(x.quality))
                        .First())
                    .Select(x => new TranslationVariantSource
                    {
                        Source = x.source,
                        Path = x.path,
                        TranslationId = x.translation_id,
                        TranslationName = x.translation,
                        Season = x.season,
                        Episode = x.episode,
                        Quality = x.quality
                    })
                    .OrderBy(x => x.Source)
                    .ToList();

                return new TranslationVariant
                {
                    source = sources.Count > 1 ? "multi" : best.source,
                    path = best.path,
                    translation = best.translation,
                    translation_id = group.Key.voice,
                    season = group.Key.season,
                    episode = group.Max(x => x.episode),
                    quality = BestQuality(group.Select(x => x.quality)),
                    KpId = best.KpId,
                    ImdbId = best.ImdbId,
                    Sources = sources
                };
            })
            .OrderBy(x => x.season)
            .ThenBy(x => x.translation)
            .ToList();

        return new TranslationVariantsResponse
        {
            Source = "multi",
            Seasons = combined
                .Where(x => x.season > 0)
                .Select(x => x.season)
                .Distinct()
                .OrderBy(x => x)
                .ToList(),
            Translations = combined,
            Items = blocks
        };
    }

    static string StableVoiceId(string voice, string source, string sourceId)
    {
        string normalized = VoiceNormalize.Normalize(voice);
        if (!string.IsNullOrWhiteSpace(normalized))
            return normalized;

        return $"{source}:{sourceId}";
    }

    static string BestQuality(IEnumerable<string> qualities)
    {
        return qualities
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .OrderByDescending(QualityNumber)
            .FirstOrDefault();
    }

    static int QualityNumber(string quality)
    {
        if (string.IsNullOrWhiteSpace(quality))
            return 0;

        return int.TryParse(Regex.Match(quality, "([0-9]{3,4})").Groups[1].Value, out int q) ? q : 0;
    }
}
