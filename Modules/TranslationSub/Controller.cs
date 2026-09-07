using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared;
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TranslationSub.Models;
using TranslationSub.Providers;
using TranslationSub.Services;

namespace TranslationSub;

public class TranslationSubController : BaseController
{
    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/list")]
    [Route("transsubscribe/list")]
    public ActionResult List(string userKey = null)
    {
        var list = SubscriptionStore.Load();
        if (!string.IsNullOrWhiteSpace(userKey))
            list = list.Where(x => x.UserKey == userKey).ToList();

        return ContentTo(JsonConvert.SerializeObject(list));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/updates")]
    [Route("transsubscribe/updates")]
    async public Task<ActionResult> Updates(string userKey = null, bool force = false)
    {
        if (force)
            await TranslationSubscriptionService.Tick();

        var list = SubscriptionStore.Load();
        if (!string.IsNullOrWhiteSpace(userKey))
            list = list.Where(x => x.UserKey == userKey).ToList();

        var updates = list
            .Where(x => !x.Notified && x.LastEpisode.GetValueOrDefault(0) > x.CurrentEpisode.GetValueOrDefault(0))
            .Select(x => new
            {
                id = x.Id,
                userKey = x.UserKey,
                contentId = x.ContentId,
                title = x.Title,
                originalTitle = x.OriginalTitle,
                kpId = x.KpId,
                imdbId = x.ImdbId,
                season = x.LastSeason ?? x.CurrentSeason ?? 1,
                episode = x.LastEpisode ?? 0,
                currentSeason = x.CurrentSeason,
                currentEpisode = x.CurrentEpisode,
                source = x.Source,
                sources = x.Sources,
                translationId = x.TranslationId,
                translationName = x.TranslationName,
                lastCheckedAt = x.LastCheckedAt
            })
            .ToList();

        return ContentTo(JsonConvert.SerializeObject(updates));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/progress")]
    [Route("transsubscribe/progress")]
    public ActionResult Progress(string userKey = null)
    {
        var list = SubscriptionStore.Load();
        if (!string.IsNullOrWhiteSpace(userKey))
            list = list.Where(x => x.UserKey == userKey).ToList();

        return ContentTo(JsonConvert.SerializeObject(new { success = true, count = list.Count }));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/variants")]
    [Route("transsubscribe/variants")]
    async public Task<ActionResult> Variants(
        string contentId,
        string title,
        string originalTitle,
        string kpId,
        string imdbId,
        string tmdbId,
        string year,
        string isSerial,
        string uid,
        int? season,
        long kinopoisk_id = 0,
        bool serial = true
    )
    {
        long kp = kinopoisk_id;
        if (kp <= 0)
            long.TryParse(kpId, out kp);

        bool isTv = serial;
        if (!string.IsNullOrWhiteSpace(isSerial))
            isTv = isSerial == "1" || isSerial.Equals("true", StringComparison.OrdinalIgnoreCase);

        int.TryParse(year, out int contentYear);

        int targetSeason = isTv ? season.GetValueOrDefault(0) : 0;
        if (targetSeason < 0)
            targetSeason = 0;

        var response = await TranslationProviderHub.GetVariants(new VoiceProviderQuery
        {
            ImdbId = imdbId,
            KpId = kp,
            Title = title,
            OriginalTitle = originalTitle,
            Year = contentYear,
            IsSerial = isTv,
            Season = targetSeason
        });

        return ContentTo(JsonConvert.SerializeObject(response));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/check")]
    [Route("transsubscribe/check")]
    async public Task<ActionResult> Check()
    {
        await TranslationSubscriptionService.Tick();
        return ContentTo("{\"success\":true}");
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/toggle")]
    [Route("transsubscribe/toggle")]
    async public Task<ActionResult> Toggle()
    {
        var body = await ReadBody();
        if (body == null)
            return ContentTo("{\"success\":false,\"error\":\"empty body\"}");

        var sub = FromJson(body);
        if (string.IsNullOrWhiteSpace(sub.UserKey))
            sub.UserKey = "local";

        var list = SubscriptionStore.Load();
        var exists = list.FirstOrDefault(x =>
            x.UserKey == sub.UserKey &&
            x.ContentId == sub.ContentId &&
            x.TranslationId == sub.TranslationId &&
            (x.CurrentSeason ?? 1) == (sub.CurrentSeason ?? 1));

        bool subscribed;
        if (exists != null)
        {
            list.Remove(exists);
            subscribed = false;
        }
        else
        {
            sub.Id = Guid.NewGuid().ToString("N");
            sub.CreatedAt = DateTime.Now;
            list.Add(sub);
            subscribed = true;
        }

        SubscriptionStore.Save(list);
        return ContentTo(JsonConvert.SerializeObject(new { success = true, subscribed }));
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/add")]
    [Route("transsubscribe/add")]
    async public Task<ActionResult> Add()
    {
        var body = await ReadBody();
        if (body == null)
            return ContentTo("{\"success\":false,\"error\":\"empty body\"}");

        var sub = FromJson(body);
        var list = SubscriptionStore.Load();

        if (!list.Any(x => x.UserKey == sub.UserKey && x.ContentId == sub.ContentId && x.TranslationId == sub.TranslationId && (x.CurrentSeason ?? 1) == (sub.CurrentSeason ?? 1)))
        {
            sub.Id = Guid.NewGuid().ToString("N");
            sub.CreatedAt = DateTime.Now;
            list.Add(sub);
            SubscriptionStore.Save(list);
        }

        return ContentTo("{\"success\":true}");
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/remove")]
    [Route("transsubscribe/remove")]
    public ActionResult Remove(string id)
    {
        var list = SubscriptionStore.Load();
        list.RemoveAll(x => x.Id == id);
        SubscriptionStore.Save(list);
        return ContentTo("{\"success\":true}");
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/notified")]
    [Route("transsubscribe/notified")]
    public ActionResult Notified(string id)
    {
        var list = SubscriptionStore.Load();
        var item = list.FirstOrDefault(x => x.Id == id);
        if (item != null)
        {
            item.Notified = true;
            SubscriptionStore.Save(list);
        }
        return ContentTo("{\"success\":true}");
    }

    async Task<JObject> ReadBody()
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        string raw = await reader.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(raw))
            return null;
        return JsonConvert.DeserializeObject<JObject>(raw);
    }

    TranslationSubscription FromJson(JObject j)
    {
        int.TryParse(j.Value<string>("currentSeason"), out int currentSeason);
        int.TryParse(j.Value<string>("currentEpisode"), out int currentEpisode);
        int.TryParse(j.Value<string>("year"), out int year);
        bool.TryParse(j.Value<string>("isSerial"), out bool isSerialBool);

        var sub = new TranslationSubscription
        {
            UserKey = j.Value<string>("userKey") ?? "local",
            ContentId = j.Value<string>("contentId"),
            Title = j.Value<string>("title"),
            OriginalTitle = j.Value<string>("originalTitle"),
            KpId = j.Value<string>("kpId"),
            ImdbId = j.Value<string>("imdbId"),
            TmdbId = j.Value<string>("tmdbId"),
            Year = year > 0 ? year : null,
            IsSerial = j["isSerial"]?.Type == JTokenType.Boolean ? j.Value<bool>("isSerial") : isSerialBool,
            Source = j.Value<string>("source") ?? "multi",
            TranslationId = j.Value<string>("translationId"),
            TranslationName = j.Value<string>("translationName"),
            CurrentSeason = currentSeason > 0 ? currentSeason : 1,
            CurrentEpisode = currentEpisode > 0 ? currentEpisode : 0,
            LastSeason = currentSeason > 0 ? currentSeason : 1,
            LastEpisode = currentEpisode > 0 ? currentEpisode : 0,
            Notified = true
        };

        if (j["sources"] is JArray arr)
        {
            foreach (var x in arr.OfType<JObject>())
            {
                sub.Sources.Add(new TranslationSubscriptionSource
                {
                    Source = x.Value<string>("source"),
                    Path = x.Value<string>("path"),
                    TranslationId = x.Value<string>("translationId"),
                    TranslationName = x.Value<string>("translationName")
                });
            }
        }

        return sub;
    }
}
