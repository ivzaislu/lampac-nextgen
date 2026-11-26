#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false
#:property PublishTrimmed=false
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:project ../../Modules/OnlineRUS/ZFilmHD/ZFilmHD.csproj

using ZFilmHD;

if (args.Contains("--observe"))
{
    using var client = new HttpClient(new HttpClientHandler
    {
        AllowAutoRedirect = false, UseProxy = false, UseCookies = false
    }) { Timeout = TimeSpan.FromSeconds(20), MaxResponseContentBufferSize = 1024 * 1024 };
    var catalogue = await ZFilmHDInvoke.GetPlaylist("https://tv.zfilm-hd.com", 6058297, async url =>
    {
        using var response = await client.GetAsync(url);
        Console.WriteLine($"Catalogue HTTP={(int)response.StatusCode}");
        return response.IsSuccessStatusCode ? await response.Content.ReadAsStringAsync() : null;
    });
    if (catalogue == null)
    {
        Console.WriteLine("Catalogue contract not confirmed");
        return 1;
    }
    Console.WriteLine($"Catalogue confirmed: voices={catalogue.voices.Length}, seasons={catalogue.voices.SelectMany(v => v.seasons).Select(s => s.s).Distinct().Count()}");
    return 0;
}

const string sample = """
{"ok":true,"kp":123,"type":"serial","voices":[{"i":0,"title":"Test A","rank":3,"seasons":[{"s":1,"episodes":[1,2]},{"s":2,"episodes":[1]}]},{"i":1,"title":"Test B","rank":5,"seasons":[{"s":2,"episodes":[1,3]}]}]}
""";
int checks = 0;
void Require(bool condition, string name)
{
    if (!condition) throw new Exception("FAIL " + name);
    checks++;
    Console.WriteLine("PASS " + name);
}

var result = ZFilmHDInvoke.ParsePlaylist(sample, 123);
Require(result?.voices?.Length == 2, "voice count");
Require(result.voices[0].i == 0 && result.voices[0].rank == 3, "zero index and rank");
Require(result.voices[0].seasons.Length == 2, "seasons");
Require(result.voices[1].seasons[0].episodes.SequenceEqual(new[] { 1, 3 }), "non-contiguous episodes");
Require(ZFilmHDInvoke.ParsePlaylist(sample, 999) == null, "wrong KP");
Require(ZFilmHDInvoke.ParsePlaylist(sample.Replace("\"ok\":true", "\"ok\":false"), 123) == null, "rejected result");
Require(ZFilmHDInvoke.ParsePlaylist(sample.Replace("\"serial\"", "\"movie\""), 123) == null, "unknown movie contract");
Require(ZFilmHDInvoke.ParsePlaylist(sample.Replace("\"i\":1", "\"i\":0"), 123) == null, "duplicate voice");
Require(ZFilmHDInvoke.ParsePlaylist(sample.Replace("\"i\":0,", ""), 123) == null, "missing voice index");
Require(ZFilmHDInvoke.ParsePlaylist(sample.Replace("[1,2]", "[1,1]"), 123) == null, "duplicate episode");
Require(ZFilmHDInvoke.ParsePlaylist(sample.Replace("[1,2]", "[0,2]"), 123) == null, "invalid episode");
Require(ZFilmHDInvoke.ParsePlaylist("[bad]", 123) == null, "malformed response");
int calls = 0;
var fetched = await ZFilmHDInvoke.GetPlaylist("https://example.invalid", 123, url =>
{
    calls++;
    Require(url == "https://example.invalid/7c2b.php?api=playlist&kp=123", "catalogue request");
    return Task.FromResult(sample);
});
Require(fetched?.voices?.Length == 2 && calls == 1, "native callback");
Require(await ZFilmHDInvoke.GetPlaylist("https://example.invalid", -1, _ => throw new Exception()) == null, "invalid KP no request");
Require(await ZFilmHDInvoke.GetPlaylist("http://example.invalid", 123, _ => throw new Exception()) == null, "non-HTTPS no request");
Require(await ZFilmHDInvoke.GetPlaylist("https://example.invalid", 123, _ => throw new HttpRequestException()) == null, "transport failure");
Console.WriteLine($"ZFilmHD self-check: {checks} passed");
return 0;
