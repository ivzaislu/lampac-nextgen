#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false
#:property PublishTrimmed=false
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:project ../../Modules/OnlineRUS/Kinobase/Kinobase.csproj

// Offline contract check; all data are synthetic, no provider or media requests.
using Kinobase;
using System.Text.Json;

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
Console.WriteLine($"Kinobase offline self-check: {total - failed}/{total} passed");
return failed == 0 ? 0 : 1;

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
