using System.Collections.Generic;

namespace TranslationSub.Models;

public class TranslationVariant
{
    public string source { get; set; }
    public string translation { get; set; }
    public string translation_id { get; set; }
    public int season { get; set; }
    public int episode { get; set; }
    public List<int> Episodes { get; set; } = new();

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
    public string TranslationId { get; set; }
    public string TranslationName { get; set; }
    public int Season { get; set; }
    public int Episode { get; set; }
    public List<int> Episodes { get; set; } = new();
}

public class TranslationSourceBlock
{
    public string Source { get; set; }
    public string Name { get; set; }
    public List<TranslationVariant> Translations { get; set; } = new();
}

public class TranslationVariantsResponse
{
    public string Source { get; set; } = "lampac";
    public List<int> Seasons { get; set; } = new();
    public List<TranslationVariant> Translations { get; set; } = new();
    public List<TranslationSourceBlock> Items { get; set; } = new();
}
