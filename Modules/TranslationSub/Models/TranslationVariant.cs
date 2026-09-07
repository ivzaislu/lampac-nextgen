using System.Collections.Generic;

namespace TranslationSub.Models;

public class TranslationVariant
{
    public string translation { get; set; }
    public int translation_id { get; set; }
    public int season { get; set; }
    public int episode { get; set; }
    public string quality { get; set; }
    public long file_id { get; set; }

    public string Id
    {
        get => translation_id.ToString();
        set { if (int.TryParse(value, out int v)) translation_id = v; }
    }

    public string Name
    {
        get => translation;
        set => translation = value;
    }

    public string KpId { get; set; }
    public string ImdbId { get; set; }
}

public class TranslationSourceBlock
{
    public string Source { get; set; }
    public string Path { get; set; }
    public List<TranslationVariant> Translations { get; set; } = new();
}

public class TranslationVariantsResponse
{
    public string Source { get; set; }
    public List<TranslationVariant> Translations { get; set; } = new();
    public List<TranslationSourceBlock> Items { get; set; } = new();
}
