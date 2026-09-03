using System.Collections.Generic;

namespace Kbteam;

public class Root
{
    public List<Item> items { get; set; }
    public List<Page> pages { get; set; }
}

public class Page
{
    public List<Item> items { get; set; }
}

public class Item
{
    public string type { get; set; }
    public string action { get; set; }
    public string titleHeader { get; set; }
    public string label { get; set; }
}

public class VoiceGroup
{
    public string name { get; set; }
    public List<QualityLink> urls { get; set; } = new();
}

public class QualityLink
{
    public int quality { get; set; }
    public string url { get; set; }
}
