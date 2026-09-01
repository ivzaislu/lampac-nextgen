using Newtonsoft.Json;
using Shared.Services;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
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
    private const int CacheVersion = 2;
    private const int ReadLimit = 128 * 1024;
    private const int SaveStep = 250;
    private const int InitialHealthWindow = 1024;

    private static readonly ConcurrentDictionary<long, int> kpToPlaylist = new();
    private static readonly SemaphoreSlim scanLock = new(1, 1);
    private static readonly object stateLock = new();
    private static readonly object saveLock = new();
    private static readonly Regex dataFilmRegex = new("data-film='(?<json>\\{[^']+\\})'", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex kpRegex = new("\\\"kp_id\\\"\\s*:\\s*(?<id>[0-9]+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static ModuleConf conf;
    private static readonly string cachePath = Path.Combine("database", "gencit_index.json");
    private static int maxScan;
    private static bool loaded;
    private static Task scanTask = Task.CompletedTask;

    public static void Configure(ModuleConf init)
    {
        ModuleConf current;

        lock (stateLock)
        {
            conf = init?.Clone();

            if (!loaded)
            {
                Load();
                loaded = true;
            }

            current = conf?.Clone();
        }

        if (current?.index_enable == true)
            EnsureScanStarted();
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
        {
            kpToPlaylist.TryRemove(kpId, out _);
            Save();
        }
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

        if (current?.index_enable != true)
            return 0;

        EnsureScanStarted();

        int wait = Math.Clamp(current.index_wait_ms, 250, 15000);
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(wait);

        while (DateTime.UtcNow < deadline)
        {
            if (kpToPlaylist.TryGetValue(kpId, out known))
                return known;

            Task currentScan;
            lock (stateLock)
                currentScan = scanTask;

            if (currentScan == null || currentScan.IsCompleted)
                break;

            await Task.Delay(100).ConfigureAwait(false);
        }

        return kpToPlaylist.TryGetValue(kpId, out known) ? known : 0;
    }

    private static void EnsureScanStarted()
    {
        lock (stateLock)
        {
            if (conf?.index_enable != true)
                return;

            int max = Math.Clamp(conf.index_max, 1, 100000);
            if (Volatile.Read(ref maxScan) >= max)
                return;

            if (scanTask != null && !scanTask.IsCompleted)
                return;

            scanTask = Task.Run(ScanAsync);
        }
    }

    private static async Task ScanAsync()
    {
        await scanLock.WaitAsync().ConfigureAwait(false);

        try
        {
            ModuleConf current;
            lock (stateLock)
                current = conf?.Clone();

            if (current?.index_enable != true)
                return;

            int max = Math.Clamp(current.index_max, 1, 100000);
            int workers = Math.Clamp(current.index_workers, 1, 64);
            int next = Math.Max(1, Volatile.Read(ref maxScan) + 1);

            if (next > max)
                return;

            using var handler = new HttpClientHandler
            {
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli
            };

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
            bool sourceVerified = Volatile.Read(ref maxScan) > 0;

            Serilog.Log.Information(
                "Gencit index scan started: {Start}-{Max}, workers={Workers}",
                next,
                max,
                workers
            );

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

                bool foundInBatch = false;
                foreach (var result in results)
                {
                    if (result.kpId <= 0)
                        continue;

                    kpToPlaylist[result.kpId] = result.playlistId;
                    foundInBatch = true;
                }

                int scannedTo = next + count - 1;
                next += count;

                if (!sourceVerified)
                {
                    if (foundInBatch)
                    {
                        sourceVerified = true;
                    }
                    else if (scannedTo >= Math.Min(max, InitialHealthWindow))
                    {
                        Serilog.Log.Warning(
                            "Gencit index found no parsable kp_id in first {Count} ids; check proxy or page parser",
                            InitialHealthWindow
                        );
                        return;
                    }
                }

                if (sourceVerified)
                {
                    Volatile.Write(ref maxScan, scannedTo);
                    sinceSave += count;

                    if (sinceSave >= SaveStep)
                    {
                        Save();
                        sinceSave = 0;
                    }
                }
            }

            Save();
            Serilog.Log.Information(
                "Gencit index scan complete: entries={Entries}, max={Max}",
                kpToPlaylist.Count,
                Volatile.Read(ref maxScan)
            );
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning(ex, "Gencit index scan failed");
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
            request.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
            request.Headers.TryAddWithoutValidation("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8");

            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            if (response.StatusCode != HttpStatusCode.OK)
                return new ProbeResult(playlistId, 0);

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

            // The same framed 404 is used for missing playlist ids and for blocked direct server IPs.
            // During an indexed scan it is therefore only a miss; health is verified by finding real kp_id values.
            if (IsBlockedPage(html))
                return new ProbeResult(playlistId, 0);

            return new ProbeResult(playlistId, ExtractKpId(html));
        }
        catch
        {
            return new ProbeResult(playlistId, 0);
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

            if (cache?.version == CacheVersion)
            {
                maxScan = Math.Max(0, cache.max_scan);
            }
            else
            {
                // Keep known mappings learned from real playback, but rebuild scan progress with the new parser.
                maxScan = 0;
                Serilog.Log.Information(
                    "Gencit index cache version changed ({OldVersion}->{NewVersion}); rebuilding scan progress",
                    cache?.version ?? 0,
                    CacheVersion
                );
            }
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning(ex, "Gencit index cache load failed");
        }
    }

    private static void Save()
    {
        lock (saveLock)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(cachePath) ?? "database");
                var cache = new GencitIndexCache
                {
                    version = CacheVersion,
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
    }

    private readonly record struct ProbeResult(int playlistId, long kpId);
}
