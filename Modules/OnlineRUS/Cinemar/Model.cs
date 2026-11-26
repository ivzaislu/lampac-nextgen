using Shared.Models.Templates;
using Shared.Models.Online.Settings;
using System.Collections.Generic;

namespace Cinemar;

public class CinemarSettings : OnlinesSettings
{
    public CinemarSettings() : base("Cinemar", "https://kinogo.luxury") { }

    public bool useplaywright { get; set; } = true;
}

public class SearchModel
{
    public string link { get; set; }

    public SimilarTpl similar { get; set; }
}

public class PlaylistItem
{
    public string id { get; set; }

    public string data { get; set; }

    public string title { get; set; }

    public string file { get; set; }

    public string subtitle { get; set; }

    public List<PlaylistItem> folder { get; set; }

    public int voice_id { get; set; }
}
