#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false
#:property PublishTrimmed=false
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:project ../../Modules/OnlineRUS/Kinobase/Kinobase.csproj

// Default: synthetic fixtures, including real loopback HTTP. Optional direct metadata observation.
using Kinobase;
using System.Net;
using System.Net.Sockets;
using System.Net.Http;
using Shared.Models.Base;
using Shared.Services;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

if (args.Contains("--observe-direct"))
    return await ObserveDirect(args.Contains("--hydra"));

int failed = 0;
int total = 0;
const string movie = "[720p]fixture_720.mp4";
const string episodes = """[{"title":"1 серия","file":"[1080p]fixture_1080.mp4","subtitle":"[Русский]fixture.vtt"}]""";
const string seasons = """[{"title":"1 сезон","folder":[{"title":"1 серия","file":"[2160p]fixture_2160.mp4"}]}]""";

Console.WriteLine($"JSON reflection enabled: {JsonSerializer.IsReflectionEnabledByDefault}");
await Check("JSON environment and episode fixture", () =>
{
    Require(JsonSerializer.IsReflectionEnabledByDefault, "reflection serialization disabled");
    var decoded = JsonSerializer.Deserialize<Season[]>(episodes, new JsonSerializerOptions { AllowTrailingCommas = true });
    Require(decoded?.Length == 1, "JSON episode count");
    Require(decoded[0].file == "[1080p]fixture_1080.mp4", "JSON file field");
    return Task.CompletedTask;
});
await Check("native movie", () =>
{
    var result = KinobaseInvoke.ParsePlayerJsPayload(movie);
    Require(result?.content == movie && result.serial == null, "movie payload changed");
    return Task.CompletedTask;
});
await Check("native episodes and subtitles", () =>
{
    var result = KinobaseInvoke.ParsePlayerJsPayload(episodes);
    Require(result?.quality == "1080p" && result.serial?.Length == 1, $"episode quality={result?.quality ?? "<null>"}, count={result?.serial?.Length}");
    Require(result.serial[0].subtitle == "[Русский]fixture.vtt", "subtitle changed");
    return Task.CompletedTask;
});
await Check("native nested seasons", () =>
{
    var result = KinobaseInvoke.ParsePlayerJsPayload(seasons);
    Require(result?.quality == "2160p" && result.serial?.Length == 1, $"season quality={result?.quality ?? "<null>"}, count={result?.serial?.Length}");
    Require(result.serial[0].folder?.Length == 1, "nested episode missing");
    return Task.CompletedTask;
});
await Check("native empty and malformed payload", () =>
{
    foreach (var invalid in new[] { null, "", "[]", "[bad]" })
        Require(KinobaseInvoke.ParsePlayerJsPayload(invalid) == null, "invalid payload accepted");
    return Task.CompletedTask;
});
await Check("existing browser-marker path: movie", async () =>
{
    var result = await Embed("<div id=\"playerjsfile\">" + movie + "</div>", true);
    Require(result?.content == movie, "movie marker contract changed");
});
await Check("existing browser-marker path: series", async () =>
{
    var result = await Embed("<div id=\"playerjsfile\">" + episodes + "</div>", true);
    Require(result?.serial?.Length == 1 && result.quality == "1080p", $"series marker quality={result?.quality ?? "<null>"}, count={result?.serial?.Length}");
});
await Check("existing alert path", async () =>
{
    var result = await Embed("<div class=\"alert\"><h3>Test unavailable</h3></div>", true);
    Require(result?.IsEmpty == true && result.errormsg == "Test unavailable", "alert contract changed");
});
await Check("missing marker", async () =>
{
    Require(await Embed("<html><body>No player</body></html>", true) == null, "missing marker accepted");
});
await Check("existing Uppod playlist", async () =>
{
    var result = await Embed("<div id=\"playlists\">" + episodes + "</div>", false);
    Require(result?.serial?.Length == 1 && result.quality == "1080p", $"Uppod quality={result?.quality ?? "<null>"}, count={result?.serial?.Length}");
});
await Check("HTTP-first disabled by default", async () =>
{
    var result = await HttpFirst(false, true, Marker(movie), Marker(episodes), 0, 1);
    Require(result?.content == movie, "default browser result changed");
});
await Check("HTTP-first valid supplied marker", async () =>
{
    var result = await HttpFirst(true, true, Marker(movie), Marker(episodes), 1, 0);
    Require(result?.serial?.Length == 1 && result.quality == "1080p", "direct data not used");
});
await Check("HTTP-first fallback on missing marker", async () =>
{
    var result = await HttpFirst(true, true, Marker(movie), "<html>No player</html>", 1, 1);
    Require(result?.content == movie, "fallback failed");
});
await Check("HTTP-first fallback on malformed JSON", async () =>
{
    var result = await HttpFirst(true, true, Marker(movie), Marker("[bad]"), 1, 1);
    Require(result?.content == movie, "fallback failed");
});
await Check("HTTP-first fallback on ambiguous or non-element markers", async () =>
{
    foreach (string html in new[] { "<!--" + Marker(episodes) + "-->", Marker(episodes) + Marker(episodes), "<div id=\"playerjsfile\"><b>data</b></div>", "<div id=\"playerjsfile\"> </div>" })
    {
        var result = await HttpFirst(true, true, Marker(movie), html, 1, 1);
        Require(result?.content == movie, "ambiguous marker accepted");
    }
});
await Check("HTTP-first preserves existing notice path", async () =>
{
    var alert = "<div class=\"alert\"><h3>Test unavailable</h3></div>";
    var result = await HttpFirst(true, true, alert, alert + Marker(episodes), 1, 1);
    Require(result?.IsEmpty == true && result.errormsg == "Test unavailable", "notice changed");
});
await Check("HTTP-first fallback on transport exception", async () =>
{
    var result = await HttpFirst(true, true, Marker(movie), null, 1, 1, failHttp: true);
    Require(result?.content == movie, "fallback failed");
});
await Check("HTTP-first leaves Uppod unchanged", async () =>
{
    var result = await HttpFirst(true, false, "<div id=\"playlists\">" + episodes + "</div>", Marker(movie), 0, 1);
    Require(result?.serial?.Length == 1 && result.quality == "1080p", "Uppod changed");
});
await Check("loopback HTTP: actual transport and fallback", async () =>
{
    var builder = WebApplication.CreateSlimBuilder(Array.Empty<string>());
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));
    await using var app = builder.Build();
    int requests = 0;
    app.MapGet("/valid", () =>
    {
        Interlocked.Increment(ref requests);
        return Results.Text(Marker(episodes), "text/html; charset=utf-8");
    });
    app.MapGet("/missing", () =>
    {
        Interlocked.Increment(ref requests);
        return Results.Text("<html>No player</html>", "text/html; charset=utf-8");
    });
    app.MapGet("/unavailable", () =>
    {
        Interlocked.Increment(ref requests);
        return Results.StatusCode(503);
    });
    await app.StartAsync();
    try
    {
        string origin = app.Urls.Single().TrimEnd('/');
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromSeconds(5)
        };
        int fallbackCalls = 0;
        var conf = new ModuleConf("Kinobase", origin, true, hdr: true) { nativehttp = true };
        var invoke = new KinobaseInvoke(null, conf, _ =>
        {
            fallbackCalls++;
            return Task.FromResult(Marker(movie));
        }, value => value);

        var valid = await invoke.Embed("valid", true, uri => client.GetStringAsync(uri));
        Require(valid?.serial?.Length == 1 && valid.quality == "1080p", "loopback result");
        Require(requests == 1 && fallbackCalls == 0, "unexpected fallback on 200");
        foreach (string route in new[] { "missing", "unavailable" })
        {
            var result = await invoke.Embed(route, true, uri => client.GetStringAsync(uri));
            Require(result?.content == movie, "fallback after " + route);
        }
        Require(requests == 3 && fallbackCalls == 2, "unexpected transport/fallback counts");
        conf.nativehttp = false;
        var disabled = await invoke.Embed("valid", true, uri => client.GetStringAsync(uri));
        Require(disabled?.content == movie && requests == 3 && fallbackCalls == 3, "disabled path made HTTP request");
    }
    finally { await app.StopAsync(); }
});
Console.WriteLine($"Kinobase offline self-check: {total - failed}/{total} passed");
return failed == 0 ? 0 : 1;

// Direct public metadata only. No proxies, scripts, cookies, media or player values logged.
static async Task<int> ObserveDirect(bool useHydra)
{
    const string origin = "https://kinobase.org";
    Console.WriteLine("Direct transport=" + (useHydra ? "HttpHydra" : "HttpClient"));
    var previousFactory = Shared.Services.Http.httpClientFactory;
    try
    {
        using var client = new HttpClient(new ObservationHandler(new HttpClientHandler
        {
            UseProxy = false,
            UseCookies = false,
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.All
        }))
        {
            Timeout = TimeSpan.FromSeconds(25),
            MaxResponseContentBufferSize = 4 * 1024 * 1024
        };
        var conf = new ModuleConf("Kinobase", origin, true, hdr: true)
        {
            nativehttp = true, httpversion = 2, httptimeout = 25, useproxy = false
        };
        HttpHydra hydra = null;
        if (useHydra)
        {
            // The factory must be non-null for FriendlyHttp to honor RegisterHttp.
            // Keep TLS validation and direct-only transport in this isolated probe.
            Shared.Services.Http.httpClientFactory = new ObservationFactory(client);
            hydra = new HttpHydra(conf, null, new RequestModel(), null, null);
            hydra.RegisterHttp(client);
        }
        async Task<string> Fetch(string url)
        {
            if (hydra != null)
                return await hydra.Get(url, addheaders: HeadersModel.Init("referer", origin));
            using var response = await client.GetAsync(url);
            return response.StatusCode == HttpStatusCode.OK
                ? await response.Content.ReadAsStringAsync() : null;
        }

        string search = await Fetch(origin + "/search?query=" + Uri.EscapeDataString("Ночь живых мертвецов"));
        if (string.IsNullOrEmpty(search))
        {
            Console.WriteLine("Direct observation: search returned no usable HTML");
            return 1;
        }
        Console.WriteLine("Direct search chars=" + search.Length);
        var document = new HtmlAgilityPack.HtmlDocument();
        document.LoadHtml(search);
        var href = document.DocumentNode.SelectNodes("//a[@href]")?
            .Select(node => node.GetAttributeValue("href", ""))
            .FirstOrDefault(value => value.StartsWith("/film/") || value.StartsWith("/serial/"));
        if (href == null || !Uri.TryCreate(new Uri(origin), href, out var target) ||
            target.Scheme != "https" || target.Host != "kinobase.org" || !target.IsDefaultPort)
        {
            Console.WriteLine("Direct observation: no recognized public detail link");
            return 1;
        }
        bool detailOk = false;
        int fallbackCalls = 0;
        var invoke = new KinobaseInvoke(null, conf, _ =>
        {
            fallbackCalls++;
            return Task.FromResult<string>(null);
        }, value => value);
        var result = await invoke.Embed(target.PathAndQuery.TrimStart('/'), true, async uri =>
        {
            if (uri != target.AbsoluteUri)
                throw new InvalidOperationException("Unexpected detail URI");
            string html = await Fetch(uri);
            detailOk = !string.IsNullOrEmpty(html);
            Console.WriteLine("Direct detail chars=" + (html?.Length ?? 0));
            return html;
        });
        Console.WriteLine($"Direct observation: detail_ok={detailOk} native_result={result != null} fallback_required={fallbackCalls > 0}");
        Console.WriteLine("Public HTML observation only; playback and full provider compatibility not validated.");
        return detailOk ? 0 : 1;
    }
    catch (Exception ex)
    {
        ObservationHandler.LogFailure("Direct observation", ex);
        return 1;
    }
    finally
    {
        Shared.Services.Http.httpClientFactory = previousFactory;
    }
}

static string Marker(string value) => "<div id=\"playerjsfile\">" + value + "</div>";

async Task<EmbedModel> HttpFirst(bool enabled, bool playerjs, string browserHtml, string httpHtml, int expectedHttp, int expectedBrowser, bool failHttp = false)
{
    int httpCalls = 0, browserCalls = 0;
    var conf = new ModuleConf("Kinobase", "https://example.invalid", playerjs, hdr: true) { nativehttp = enabled };
    var invoke = new KinobaseInvoke(null, conf, url =>
    {
        Require(url == "https://example.invalid/fixture", "unexpected browser URL");
        browserCalls++;
        return Task.FromResult(browserHtml);
    }, value => value);
    var result = await invoke.Embed("fixture", playerjs, url =>
    {
        Require(url == "https://example.invalid/fixture", "unexpected HTTP URL");
        httpCalls++;
        if (failHttp) throw new InvalidOperationException("synthetic transport failure");
        return Task.FromResult(httpHtml);
    });
    Require(httpCalls == expectedHttp && browserCalls == expectedBrowser, $"HTTP={httpCalls}, browser={browserCalls}");
    return result;
}

async Task<EmbedModel> Embed(string html, bool playerjs)
{
    int calls = 0;
    var conf = new ModuleConf("Kinobase", "https://example.invalid", playerjs, hdr: true);
    var invoke = new KinobaseInvoke(null, conf, url =>
    {
        Require(url == "https://example.invalid/fixture", "unexpected URL");
        calls++;
        return Task.FromResult(html);
    }, value => value);
    var result = await invoke.Embed("fixture", playerjs);
    Require(calls == 1, "unexpected callback count");
    return result;
}

async Task Check(string name, Func<Task> action)
{
    total++;
    try { await action(); Console.WriteLine("PASS " + name); }
    catch (Exception ex) { failed++; Console.WriteLine("FAIL " + name + ": " + ex.Message); }
}
static void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

sealed class ObservationFactory(HttpClient client) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => client;
}

sealed class ObservationHandler(HttpMessageHandler inner) : DelegatingHandler(inner)
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var uri = request.RequestUri;
        if (uri == null || uri.Scheme != "https" || uri.Host != "kinobase.org" || !uri.IsDefaultPort)
            throw new InvalidOperationException("Unexpected diagnostic destination");
        string stage = uri.AbsolutePath == "/search" ? "search" : "detail";
        Console.WriteLine($"Direct {stage} request_version={request.Version}");
        try
        {
            var response = await base.SendAsync(request, cancellationToken);
            Console.WriteLine($"Direct {stage} HTTP={(int)response.StatusCode} version={response.Version}");
            try
            {
                if (response.StatusCode == HttpStatusCode.OK)
                    await response.Content.LoadIntoBufferAsync(4 * 1024 * 1024).WaitAsync(cancellationToken);
                return response;
            }
            catch
            {
                response.Dispose();
                throw;
            }
        }
        catch (Exception ex)
        {
            LogFailure("Direct " + stage, ex);
            throw;
        }
    }

    public static void LogFailure(string stage, Exception ex)
    {
        Console.WriteLine(stage + " error_type=" + ex.GetType().Name);
        for (Exception current = ex; current != null; current = current.InnerException)
        {
            if (current is HttpRequestException http)
                Console.WriteLine($"  http_error={http.HttpRequestError} status={(int?)http.StatusCode}");
            else if (current is SocketException socket)
                Console.WriteLine("  socket_error=" + socket.SocketErrorCode);
            else
                Console.WriteLine("  exception_type=" + current.GetType().Name);
        }
    }
}
