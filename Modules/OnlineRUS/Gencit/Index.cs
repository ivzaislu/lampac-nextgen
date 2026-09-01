using Newtonsoft.Json;
using Shared.Services;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Gencit;

public static class GencitIndex
{
    private const string Referer = "https://kinomix.web.app/";
    private const int ReadLimit = 128 * 1024;
    private const int SaveStep = 250;

    private static readonly ConcurrentDictionary<long, int> kpToPlaylist = new();
    private static readonly SemaphoreSlim scanLock = new(1, 1);
    private static readonly object stateLock = new();
    private static readonly Regex dataFilmRegex = new("data-film='(?<json>\\{[^']+\\})'", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex kpRegex = new("\\\"kp_id\\\"\\s*:\\s*(?<id>[0-9]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static ModuleConf conf;
    private static string cachePath = Path.Combine("database", "gencit_index.json");
    private static int maxScan;
    private static bool blocked;
    private static bool loaded;

    public static void Configure(ModuleConf init)
    {
        lock (stateLock)
        {
            conf = init?.Clone();
            blocked = false;

            if (!loaded)
            {
                Load();
                loaded = true;
            }
        }
    }

    public static void Remember(long kpId, int playlistId)
    {
        if (kpId <= 0 || playlistId <= 0)
            return;

        kpToPlaylist[kpId] = playlistId;
        Save();
    }

    public static void Forget(long kpId, int playlistId)
    {
        if (kpId <= 0 || playlistId <= 0)
            return;

        if (kpToPlaylist.TryGetValue(kpId, out int current) && current == playlistId)
            kpToPlaylist.TryRemove(kpId, out _);
    }

    public static async Task<int> LookupAsync(long kpId)
    {
        if (kpId <= 0)
            return 0;

        if (kpToPlaylist.TryGetValue(kpId, out int known))
            return known;

        ModuleConf current;
        lock (stateLock)
            current = conf?.Clone();

        if (current?.index_enable != true || blocked)
            return 0;

        Task<int> scan = ScanUntilAsync(kpId);
        int wait = Math.Clamp(current.index_wait_ms, 250, 15000);
        await Task.WhenAny(scan, Task.Delay(wait)).ConfigureAwait(false);

        return kpToPlaylist.TryGetValue(kpId, out known) ? known : 0;
    }

    private static async Task<int> ScanUntilAsync(long targetKpId)
    {
        await scanLock.WaitAsync().ConfigureAwait(false);

        try
        {
            if (kpToPlaylist.TryGetValue(targetKpId, out int known))
                return known;

            ModuleConf current;
            lock (stateLock)
                current = conf?.Clone();

            if (current?.index_enable != true || blocked)
                return 0;

            int max = Math.Clamp(current.index_max, 1, 100000);
            int workers = Math.Clamp(current.index_workers, 1, 16);
            int next = Math.Max(1, Volatile.Read(ref maxScan) + 1);

            if (next > max)
                return 0;

            using var handler = new HttpClientHandler();

            try
            {
                var proxy = new ProxyManager(current).Get();
                if (proxy != null)
                {
                    handler.Proxy = proxy;
                    handler.UseProxy = true;
                }
            }
            catch (Exception ex)
            {
                Serilog.Log.Warning(ex, "Gencit index proxy initialization failed");
            }

            using var client = new HttpClient(handler)
            {
                Timeout = TimeSpan.FromSeconds(Math.Clamp(current.httptimeout, 5, 30))
            };

            int sinceSave = 0;

            while (next <= max)
            {
                int count = Math.Min(workers, max - next + 1);
                var tasks = new Task<ProbeResult>[count];

                for (int i = 0; i < count; i++)
                {
                    int playlistId = next + i;
                    tasks[i] = ProbeAsync(client, current.host, playlistId);
                }

                ProbeResult[] results = await Task.WhenAll(tasks).ConfigureAwait(false);

                if (results.Any(i => i.blocked))
                {
                    blocked = true;
                    Serilog.Log.Warning("Gencit returned framed 404 for server IP; configure module proxy or use RCH/direct playlist");
                    return 0;
                }

                foreach (var result in results)
                {
                    if (result.kpId > 0)
                        kpToPlaylist[result.kpId] = result.playlistId;
                }

                next += count;
                Volatile.Write(ref maxScan, next - 1);
                sinceSave += count;

                if (kpToPlaylist.TryGetValue(targetKpId, out known))
                {
                    Save();
                    return known;
                }

                if (sinceSave >= SaveStep)
                {
                    Save();
                    sinceSave = 0;
                }
            }

            Save();
            return 0;
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning(ex, "Gencit index scan failed");
            return 0;
        }
        finally
        {
            scanLock.Release();
        }
    }

    private static async Task<ProbeResult> ProbeAsync(HttpClient client, string host, int playlistId)
    {
        if (string.IsNullOrWhiteSpace(host))
            return default;

        try
        {
            string uri = $"{host.TrimEnd('/')}/lat/{playlistId}";
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.Referrer = new Uri(Referer);
            request.Headers.UserAgent.ParseAdd("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36");

            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            if (response.StatusCode != HttpStatusCode.OK)
                return new ProbeResult(playlistId, 0, false);

            await using Stream stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
            byte[] buffer = new byte[ReadLimit];
            int total = 0;

            while (total < buffer.Length)
            {
                int read = await stream.ReadAsync(buffer.AsMemory(total, buffer.Length - total)).ConfigureAwait(false);
                if (read <= 0)
                    break;

                total += read;
            }

            string html = Encoding.UTF8.GetString(buffer, 0, total);
            if (IsBlockedPage(html))
                return new ProbeResult(playlistId, 0, true);

            long kpId = ExtractKpId(html);
            return new ProbeResult(playlistId, kpId, false);
        }
        catch
        {
            return new ProbeResult(playlistId, 0, false);
        }
    }

    private static long ExtractKpId(string html)
    {
        if (string.IsNullOrEmpty(html))
            return 0;

        Match dataFilm = dataFilmRegex.Match(html);
        if (dataFilm.Success)
        {
            try
            {
                var film = JsonConvert.DeserializeObject<GencitFilm>(dataFilm.Groups["json"].Value);
                if (film?.kp_id > 0)
                    return film.kp_id;
            }
            catch { }
        }

        Match kp = kpRegex.Match(html);
        return kp.Success && long.TryParse(kp.Groups["id"].Value, out long value) ? value : 0;
    }

    public static bool IsBlockedPage(string html)
        => !string.IsNullOrEmpty(html)
            && html.Length < 2048
            && html.Contains("404 Not Found", StringComparison.OrdinalIgnoreCase)
            && html.Contains("isFramed", StringComparison.OrdinalIgnoreCase);

    private static void Load()
    {
        try
        {
            if (!File.Exists(cachePath))
                return;

            var cache = JsonConvert.DeserializeObject<GencitIndexCache>(File.ReadAllText(cachePath));
            if (cache?.kp_to_playlist != null)
            {
                foreach (var item in cache.kp_to_playlist)
                {
                    if (item.Key > 0 && item.Value > 0)
                        kpToPlaylist[item.Key] = item.Value;
                }
            }

            maxScan = Math.Max(0, cache?.max_scan ?? 0);
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning(ex, "Gencit index cache load failed");
        }
    }

    private static void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(cachePath) ?? "database");
            var cache = new GencitIndexCache
            {
                kp_to_playlist = new Dictionary<long, int>(kpToPlaylist),
                max_scan = Volatile.Read(ref maxScan)
            };

            string temp = cachePath + ".tmp";
            File.WriteAllText(temp, JsonConvert.SerializeObject(cache));
            File.Move(temp, cachePath, true);
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning(ex, "Gencit index cache save failed");
        }
    }

    private readonly record struct ProbeResult(int playlistId, long kpId, bool blocked);
}
