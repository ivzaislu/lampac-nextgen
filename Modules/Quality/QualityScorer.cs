using Shared.Models.JacRed;
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Quality;

// This is deliberately independent of the JacRed transport and of Lampa's DOM.
// It operates on the existing Shared TorrentDetails contract.
public static class QualityScorer
{
    static readonly Regex Trailer = new(@"\b(?:trailer|teaser|sample)\b|трейлер|тизер", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex TsAudio = new(@"(?:звук\s+с\s+ts|audio\s+from\s+ts|sound\s+from\s+ts)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Cam = new(@"\b(?:camrip|hdcam|hd-cam|камрип|cam|tsrip)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Ts = new(@"\b(?:telesync|tele[ -]?sync|ts)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Tc = new(@"\b(?:telecine|tele[ -]?cine|tc)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex UHD = new(@"2160p|\b4k\b|4к|\buhd\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex FullHD = new(@"1080p|\b1080\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex HD = new(@"720p|\b720\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex SD = new(@"480p|\b480\b|\b(?:web-dlrip|bdrip|hdrip)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Year = new(@"(?<!\d)(?:19|20)\d{2}(?!\d)", RegexOptions.Compiled);

    public static QualitySelection PickBest(IEnumerable<TorrentDetails> releases, bool isSerial, int year)
    {
        if (releases == null)
            return null;

        QualitySelection best = null;
        int bestRank = 0;
        int bestResolution = 0;
        int bestSeeds = -1;
        int bestPeers = -1;

        foreach (var release in releases)
        {
            if (release == null || string.IsNullOrWhiteSpace(release.title) || Trailer.IsMatch(release.title))
                continue;

            if (!MatchesType(release.types, isSerial) || !MatchesYear(release, year, isSerial))
                continue;

            string video = TsAudio.Replace($"{release.videotype} {release.title}", " ");
            int resolution = release.quality > 0 ? release.quality : ParseResolution(video);
            string label = DetectLabel(video, resolution);
            int rank = Rank(label);
            if (rank == 0)
                continue;

            int seeds = Math.Max(0, release.sid);
            int peers = Math.Max(0, release.pir);

            if (rank > bestRank
                || rank == bestRank && resolution > bestResolution
                || rank == bestRank && resolution == bestResolution && seeds > bestSeeds
                || rank == bestRank && resolution == bestResolution && seeds == bestSeeds && peers > bestPeers)
            {
                bestRank = rank;
                bestResolution = resolution;
                bestSeeds = seeds;
                bestPeers = peers;
                best = new QualitySelection(resolution, label, release.title);
            }
        }

        return best;
    }

    public static string DetectLabel(string video, int resolution)
    {
        video ??= string.Empty;
        // A bad video source is not upgraded by a numeric resolution marker.
        if (Cam.IsMatch(video)) return "CAM";
        if (Ts.IsMatch(video)) return "TS";
        if (Tc.IsMatch(video)) return "TC";
        if (resolution >= 2160) return "4K";
        if (resolution >= 1080) return "FHD";
        if (resolution >= 720) return "HD";
        if (resolution > 0) return "SD";
        return string.Empty;
    }

    static int ParseResolution(string title)
    {
        if (UHD.IsMatch(title)) return 2160;
        if (FullHD.IsMatch(title)) return 1080;
        if (HD.IsMatch(title)) return 720;
        if (SD.IsMatch(title)) return 480;
        return 0;
    }

    static int Rank(string label) => label switch
    {
        "4K" => 7,
        "FHD" => 6,
        "HD" => 5,
        "SD" => 4,
        "TC" => 3,
        "TS" => 2,
        "CAM" => 1,
        _ => 0
    };

    static bool MatchesType(string[] types, bool isSerial)
    {
        if (types == null || types.Length == 0) return true;
        foreach (string type in types)
        {
            if (isSerial && (type == "serial" || type == "docuserial" || type == "tvshow" || type == "anime"))
                return true;
            if (!isSerial && (type == "movie" || type == "documovie"))
                return true;
        }
        return false;
    }

    static bool MatchesYear(TorrentDetails release, int year, bool isSerial)
    {
        if (year <= 0) return true;
        int foundYear = release.relased;
        if (foundYear <= 0)
        {
            var match = Year.Match(release.title);
            if (match.Success)
                int.TryParse(match.Value, out foundYear);
        }
        return foundYear <= 0 || Math.Abs(foundYear - year) <= (isSerial ? 5 : 1);
    }
}

public sealed record QualitySelection(int QualityCode, string DisplayLabel, string FullLabel);
