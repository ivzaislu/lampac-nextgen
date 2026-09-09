using System.Collections.Generic;

namespace TranslationSub.Models;

public class TranslationVariant
{
    public string source { get; set; }
    public string path { get; set; }
    public string translation { get; set; }
    public string translation_id { get; set; }
    public int season { get; set; }
    public int episode { get; set; }

    // Metadata-only availability. `episode` remains the latest episode for
    // backward compatibility with the current API/JS and subscription logic.
    public List<int> Episodes { get; set; } = new();

    // Kept for wire compatibility with older clients. Native metadata polling
    // does not resolve video files/qualities and leaves these fields empty.
    public string quality { get; set; }
    public long file_id { get; set; }

    public string Id
    {
        get => translation_id;
        set => translation_id = value;
    }

    public string Name
    {
        get => translation;
        set => translation = value;
    }

    public string KpId { get; set; }
    public string ImdbId { get; set; }

    public List<TranslationVariantSource> Sources { get; set; } = new();
}

public class TranslationVariantSource
{
    public string Source { get; set; }
    public string Path { get; set; }
    public string TranslationId { get; set; }
    public string TranslationName { get; set; }
    public int Season { get; set; }
    public int Episode { get; set; }
    public List<int> Episodes { get; set; } = new();
    public string Quality { get; set; }
}

public class TranslationSourceBlock
{
    public string Source { get; set; }
    public string Path { get; set; }
    public List<TranslationVariant> Translations { get; set; } = new();
}

public class TranslationVariantsResponse
{
    public string Source { get; set; } = "multi";
    public List<int> Seasons { get; set; } = new();
    public List<TranslationVariant> Translations { get; set; } = new();
    public List<TranslationSourceBlock> Items { get; set; } = new();
}
