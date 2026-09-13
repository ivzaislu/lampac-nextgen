using Shared.Models.Templates;
using System.Collections.Generic;

namespace FlixCDN;

public class SearchItem
{
    public SimilarTpl similar { get; set; }

    public string iframe_url { get; set; }

    public string type { get; set; }

    public string title_rus { get; set; }

    public string title_orig { get; set; }

    public short? year { get; set; }

    public string poster { get; set; }

    public List<Voice> translations { get; set; }
}

public class SearchRoot
{
    public SearchItem[] result { get; set; }
}

public class Voice
{
    public int id { get; set; }

    public string title { get; set; }

    public short season { get; set; }

    public short episode { get; set; }
}

public class PlayerPayload
{
    public int id { get; set; }

    public bool is_serial { get; set; }

    public string type { get; set; }

    public int translate { get; set; }

    public string translateTitle { get; set; }

    public short? season { get; set; }

    public int[] episodes { get; set; }

    public Dictionary<string, int> seasons { get; set; }

    public Dictionary<string, int[]> seasons_episodes { get; set; }

    public List<PlayerTranslation> translations { get; set; }
}

public class PlayerTranslation
{
    public int id { get; set; }

    public string title { get; set; }

    public int episodes_qty { get; set; }
}
