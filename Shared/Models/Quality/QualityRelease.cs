namespace Shared.Models.Quality;

// Stable contract shared by two separately compiled/dynamically loaded modules.
// Null search result means the provider is unavailable; an empty list means no releases.
public sealed class QualitySearchQuery
{
    public string Title { get; set; }
    public string OriginalTitle { get; set; }
    public int Year { get; set; }
    public bool IsSerial { get; set; }
    public string Host { get; set; }
}

public sealed class QualityRelease
{
    public string Title { get; set; }
    public string[] Types { get; set; }
    public int Year { get; set; }
    public int Quality { get; set; }
    public string VideoType { get; set; }
    public int Seeders { get; set; }
    public int Peers { get; set; }
}
