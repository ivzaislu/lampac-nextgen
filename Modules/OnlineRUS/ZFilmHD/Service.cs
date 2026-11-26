using System;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace ZFilmHD;

public sealed class Playlist
{
    public bool ok { get; set; }
    public long kp { get; set; }
    public string type { get; set; }
    public Voice[] voices { get; set; }
}

public sealed class Voice
{
    public int? i { get; set; }
    public string title { get; set; }
    public int rank { get; set; }
    public Season[] seasons { get; set; }
}

public sealed class Season
{
    public int s { get; set; }
    public int[] episodes { get; set; }
}

public static class ZFilmHDInvoke
{
    // Only the serial catalogue shape is established by the supplied capture.
    public static Playlist ParsePlaylist(string json, long expectedKp)
    {
        if (expectedKp <= 0 || string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            var result = JsonSerializer.Deserialize<Playlist>(json);
            if (result?.ok != true || result.kp != expectedKp ||
                result.type != "serial" || result.voices == null || result.voices.Length == 0)
                return null;

            if (result.voices.Any(v => v == null || v.i == null || v.i < 0 ||
                string.IsNullOrWhiteSpace(v.title) || v.seasons == null ||
                v.seasons.Length == 0 || v.seasons.Any(s => s == null || s.s <= 0 ||
                    s.episodes == null || s.episodes.Length == 0 ||
                    s.episodes.Any(e => e <= 0) ||
                    s.episodes.Distinct().Count() != s.episodes.Length) ||
                v.seasons.Select(s => s.s).Distinct().Count() != v.seasons.Length) ||
                result.voices.Select(v => v.i).Distinct().Count() != result.voices.Length)
                return null;

            return result;
        }
        catch (JsonException) { return null; }
    }

    public static async Task<Playlist> GetPlaylist(string origin, long kp, Func<string, Task<string>> get)
    {
        if (kp <= 0 || get == null || !Uri.TryCreate(origin, UriKind.Absolute, out var host) ||
            host.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(host.UserInfo) ||
            host.AbsolutePath != "/" || !string.IsNullOrEmpty(host.Query) ||
            !string.IsNullOrEmpty(host.Fragment))
            return null;

        var url = new Uri(host, "/7c2b.php?api=playlist&kp=" + kp.ToString(CultureInfo.InvariantCulture));
        try { return ParsePlaylist(await get(url.AbsoluteUri), kp); }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
    }
}
