using Shared;
using Shared.Models.Module;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

namespace TranslationSub.Providers;

internal sealed class LampacMetadataResponse
{
    public int StatusCode { get; set; }
    public string Body { get; set; }
    public string Location { get; set; }

    public bool IsSuccess => StatusCode >= 200 && StatusCode < 300;
    public bool IsRedirect => StatusCode >= 300 && StatusCode < 400 && !string.IsNullOrWhiteSpace(Location);
}

internal static class LampacMetadataClient
{
    static readonly object clientLocker = new();
    static HttpClient client;
    static string clientKey;

    static readonly Dictionary<string, string[]> sourceModules = new(StringComparer.OrdinalIgnoreCase)
    {
        ["flixcdn"] = new[] { "FlixCDN" },
        ["phantom"] = new[] { "Phantom" },
        ["zetflixdb"] = new[] { "ZetflixDB", "VideoDB" },
        ["cdnvideohub"] = new[] { "CDNvideohub" }
    };

    public static IReadOnlyList<string> AvailableSources()
    {
        return sourceModules.Keys
            .Where(IsSourceAvailable)
            .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static bool IsSourceAvailable(string source)
    {
        if (string.IsNullOrWhiteSpace(source) || !sourceModules.TryGetValue(source, out var modules))
            return false;

        return modules.All(ModuleLoadedAndEnabled);
    }

    static bool ModuleLoadedAndEnabled(string marker)
    {
        try
        {
            var modules = CoreInit.modules?.ToArray();
            if (modules == null || modules.Length == 0)
                return false;

            return modules.Any(module => module != null
                && module.enable
                && ModuleMatches(module, marker)
                && NativeConfigEnabled(module));
        }
        catch
        {
            return false;
        }
    }

    static bool ModuleMatches(RootModule module, string marker)
    {
        if (module == null || string.IsNullOrWhiteSpace(marker))
            return false;

        if (Contains(module.name, marker) || Contains(module.path, marker))
            return true;

        try
        {
            return Contains(module.assembly?.GetName()?.Name, marker);
        }
        catch
        {
            return false;
        }
    }

    static bool NativeConfigEnabled(RootModule module)
    {
        try
        {
            var assembly = module?.assembly;
            if (assembly == null)
                return true;

            var modInit = assembly.GetTypes().FirstOrDefault(t => t.Name == "ModInit");
            if (modInit == null)
                return true;

            object conf = modInit.GetField("conf", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)?.GetValue(null)
                ?? modInit.GetProperty("conf", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)?.GetValue(null);

            // A module with a native conf slot that has not been initialized yet
            // is not ready for metadata polling.
            if (conf == null)
            {
                bool hasConfMember = modInit.GetField("conf", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static) != null
                    || modInit.GetProperty("conf", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static) != null;
                return !hasConfMember;
            }

            bool? enabled = ReadBool(conf, "enable");
            bool? rip = ReadBool(conf, "rip");
            return enabled != false && rip != true;
        }
        catch
        {
            // The /lite endpoint remains the final authority. Do not hide a loaded
            // source only because a future module changes its config shape.
            return true;
        }
    }

    static bool? ReadBool(object value, string name)
    {
        if (value == null || string.IsNullOrWhiteSpace(name))
            return null;

        var type = value.GetType();
        object raw = type.GetProperty(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)?.GetValue(value)
            ?? type.GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)?.GetValue(value);

        return raw is bool flag ? flag : null;
    }

    static bool Contains(string value, string marker)
        => !string.IsNullOrWhiteSpace(value)
            && value.IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0;

    public static async Task<LampacMetadataResponse> GetAsync(string pathOrUrl, string uid = null)
    {
        if (string.IsNullOrWhiteSpace(pathOrUrl))
            return null;

        try
        {
            if (!string.IsNullOrWhiteSpace(uid) && !HasQueryKey(pathOrUrl, "uid"))
                pathOrUrl = AppendQuery(pathOrUrl, "uid", uid.Trim());

            Uri uri = ResolveLocalUri(pathOrUrl);
            if (uri == null)
                return null;

            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.TryAddWithoutValidation("X-TranslationSub-Metadata", "1");

            using var response = await GetClient().SendAsync(request, HttpCompletionOption.ResponseContentRead).ConfigureAwait(false);
            string body = response.Content == null
                ? null
                : await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            return new LampacMetadataResponse
            {
                StatusCode = (int)response.StatusCode,
                Body = body,
                Location = response.Headers.Location?.ToString()
            };
        }
        catch
        {
            return null;
        }
    }

    public static string AppendQuery(string pathOrUrl, string key, string value)
    {
        if (string.IsNullOrWhiteSpace(pathOrUrl) || string.IsNullOrWhiteSpace(key))
            return pathOrUrl;

        if (HasQueryKey(pathOrUrl, key))
            return pathOrUrl;

        string separator = pathOrUrl.Contains('?') ? "&" : "?";
        return pathOrUrl + separator
            + Uri.EscapeDataString(key) + "=" + Uri.EscapeDataString(value ?? string.Empty);
    }

    static bool HasQueryKey(string pathOrUrl, string key)
    {
        if (string.IsNullOrWhiteSpace(pathOrUrl) || string.IsNullOrWhiteSpace(key))
            return false;

        int queryIndex = pathOrUrl.IndexOf('?');
        if (queryIndex < 0 || queryIndex >= pathOrUrl.Length - 1)
            return false;

        string query = pathOrUrl[(queryIndex + 1)..];
        foreach (string pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            string name = pair.Split('=', 2)[0];
            try { name = Uri.UnescapeDataString(name); } catch { }
            if (name.Equals(key, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    public static string Encode(string value)
        => Uri.EscapeDataString(value ?? string.Empty);

    static HttpClient GetClient()
    {
        var listen = CoreInit.conf?.listen;
        string key = string.Join("|", listen?.sock ?? string.Empty, listen?.ip ?? string.Empty, listen?.port ?? 0);

        lock (clientLocker)
        {
            if (client != null && string.Equals(clientKey, key, StringComparison.Ordinal))
                return client;

            client?.Dispose();
            client = CreateClient(listen?.sock);
            clientKey = key;
            return client;
        }
    }

    static HttpClient CreateClient(string socketName)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseProxy = false
        };

        if (!string.IsNullOrWhiteSpace(socketName))
        {
            string socketPath = $"/var/run/{socketName}.sock";
            handler.ConnectCallback = async (_, cancellationToken) =>
            {
                var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                try
                {
                    await socket.ConnectAsync(new UnixDomainSocketEndPoint(socketPath), cancellationToken).ConfigureAwait(false);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch
                {
                    socket.Dispose();
                    throw;
                }
            };
        }

        return new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(30)
        };
    }

    static Uri ResolveLocalUri(string pathOrUrl)
    {
        string path = pathOrUrl.Trim();
        if (Uri.TryCreate(path, UriKind.Absolute, out var absolute))
            path = absolute.PathAndQuery;

        if (!path.StartsWith('/'))
            path = "/" + path;

        var listen = CoreInit.conf?.listen;
        if (listen == null)
            return null;

        if (!string.IsNullOrWhiteSpace(listen.sock))
            return new Uri(new Uri("http://localhost/"), path.TrimStart('/'));

        if (listen.port <= 0)
            return null;

        string host = listen.ip;
        if (string.IsNullOrWhiteSpace(host)
            || host.Equals("any", StringComparison.OrdinalIgnoreCase)
            || host.Equals("broadcast", StringComparison.OrdinalIgnoreCase)
            || host == "0.0.0.0"
            || host == "::")
        {
            host = "127.0.0.1";
        }
        else if (IPAddress.TryParse(host, out var address) && address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            host = $"[{host}]";
        }

        return new Uri(new Uri($"http://{host}:{listen.port}/"), path.TrimStart('/'));
    }
}
