using System;
using System.Collections.Generic;
using System.Linq;
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
        if (ModInit.conf?.enable != true || query == null)
            return new TranslationVariantsResponse();

        IEnumerable<IVoiceProvider> activeProviders = providers
            .Where(p => LampacMetadataClient.IsSourceAvailable(p.Source));

        if (query.Sources != null)
            activeProviders = activeProviders.Where(p => query.Sources.Contains(p.Source));

        var tasks = activeProviders.Select(async provider =>
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

            if (query.IsSerial && query.Season > 0)
                values = values.Where(x => x != null && x.season == query.Season).ToList();

            foreach (var value in values.Where(x => x != null))
            {
                value.source ??= provider.Source;
                value.path ??= provider.Path;
                value.KpId = query.KpId > 0 ? query.KpId.ToString() : null;
                value.ImdbId = query.ImdbId;
                value.Episodes = EpisodeList(value);
                value.episode = value.Episodes.DefaultIfEmpty(value.episode).Max();
            }

            return new TranslationSourceBlock
            {
                Source = provider.Source,
                Path = provider.Path,
                Translations = values
            };
        });

        var blocks = (await Task.WhenAll(tasks).ConfigureAwait(false)).ToList();
        var raw = blocks.SelectMany(x => x.Translations).Where(x => x != null).ToList();

        var combined = raw
            .Where(x => !string.IsNullOrWhiteSpace(x.translation))
            .Where(x => !query.IsSerial || query.Season <= 0 || x.season == query.Season)
            .GroupBy(x => new
            {
                x.season,
                voice = StableVoiceId(x.translation, x.source, x.translation_id)
            })
            .Select(group =>
            {
                var best = group
                    .OrderByDescending(x => x.episode)
                    .First();

                var episodes = group
                    .SelectMany(EpisodeList)
                    .Where(e => e > 0)
                    .Distinct()
                    .OrderBy(e => e)
                    .ToList();

                var sources = group
                    .GroupBy(x => x.source ?? string.Empty, StringComparer.OrdinalIgnoreCase)
                    .Select(g => g.OrderByDescending(x => x.episode).First())
                    .Select(x => new TranslationVariantSource
                    {
                        Source = x.source,
                        Path = x.path,
                        TranslationId = x.translation_id,
                        TranslationName = x.translation,
                        Season = x.season,
                        Episode = x.episode,
                        Episodes = EpisodeList(x)
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
                    episode = episodes.DefaultIfEmpty(group.Max(x => x.episode)).Max(),
                    Episodes = episodes,
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

    public static IReadOnlyList<string> AvailableSources()
        => LampacMetadataClient.AvailableSources();

    static List<int> EpisodeList(TranslationVariant value)
    {
        var episodes = value?.Episodes?
            .Where(e => e > 0)
            .Distinct()
            .OrderBy(e => e)
            .ToList() ?? new List<int>();

        if (episodes.Count == 0 && value?.episode > 0)
            episodes.Add(value.episode);

        return episodes;
    }

    static string StableVoiceId(string voice, string source, string sourceId)
    {
        string normalized = VoiceNormalize.Normalize(voice);
        if (!string.IsNullOrWhiteSpace(normalized))
            return normalized;

        return $"{source}:{sourceId}";
    }
}
