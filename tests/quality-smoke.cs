#:project ../Modules/Quality/Quality.csproj

using Quality;
using Shared.Models.JacRed;

static TorrentDetails Release(string title, int quality = 0, int year = 2025, string type = "movie", int seeds = 0, string videoType = null)
    => new() { title = title, quality = quality, relased = year, types = new[] { type }, sid = seeds, videotype = videoType };

static void EqualsLabel(string expected, TorrentDetails[] list, bool serial = false, int year = 2025)
{
    var found = QualityScorer.PickBest(list, serial, year)?.DisplayLabel ?? "";
    if (found != expected)
        throw new Exception($"Expected '{expected}', found '{found}' in '{string.Join(", ", list.Select(x => x.title))}'");
}

EqualsLabel("CAM", [Release("Film (2025) HDCAM 1080p", 1080)]);
EqualsLabel("TS", [Release("Film (2025) TELESiNC 720p", 720, videoType: "TS")]);
EqualsLabel("TC", [Release("Film (2025) Telecine 720p", 720)]);
EqualsLabel("SD", [Release("Film (2025) HDRip")]);
EqualsLabel("HD", [Release("Film (2025) 720p")]);
EqualsLabel("FHD", [Release("Film (2025) WEB-DL 1080p")]);
EqualsLabel("4K", [Release("Film (2025) UHD 2160p")]);
EqualsLabel("FHD", [Release("Film (2025) [звук с TS] WEB-DL 1080p")]);
EqualsLabel("FHD", [Release("Film (2025) [audio from TS] WEB-DL 1080p")]);
EqualsLabel("4K", [Release("Film (2025) CAM"), Release("Film (2025) FHD 1080p", 1080), Release("Film (2025) 2160p")]);
EqualsLabel("HD", [Release("Film (2025) Trailer 4K"), Release("Film (2025) 720p")]);
EqualsLabel("", [Release("Film (2010) 4K", 2160, 2010)]);
EqualsLabel("", [Release("Film (2025) 4K", 2160, 2025, "serial")]);
EqualsLabel("4K", [Release("Film S01 (2021) 4K", 2160, 2021, "serial")], serial: true, year: 2025);
EqualsLabel("", [Release("Film S01 (2010) 4K", 2160, 2010, "serial")], serial: true, year: 2025);
var top = QualityScorer.PickBest([
    Release("Film (2025) WEB-DL 1080p", 1080, seeds: 2),
    Release("Film (2025) BluRay 1080p", 1080, seeds: 10)
], false, 2025);
if (top?.FullLabel != "Film (2025) BluRay 1080p")
    throw new Exception("Seeders tie-break failed");
Console.WriteLine("Quality scorer smoke: 16 scenarios passed.");
