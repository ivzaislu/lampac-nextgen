using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Shared;
using System;
using System.Collections.Generic;
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
        SyncTimeCodeProgress(userKey);

        var list = SubscriptionStore.Load();
        if (!string.IsNullOrWhiteSpace(userKey))
            list = list.Where(x => x.UserKey == userKey).ToList();

        return ContentTo(JsonConvert.SerializeObject(list));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/updates")]
    [Route("transsubscribe/updates")]
    async public Task<ActionResult> Updates(string userKey = null, bool force = false, string sources = null)
    {
        // Lampac TimeCode is authoritative for watched progress. Reconcile it before
        // both the balancer check and the notification projection.
        SyncTimeCodeProgress(userKey);

        if (force)
            await TranslationSubscriptionService.Tick(userKey, ParseSources(sources), force: true);

        var list = SubscriptionStore.Load();
        if (!string.IsNullOrWhiteSpace(userKey))
            list = list.Where(x => x.UserKey == userKey).ToList();

        var updates = list
            .Where(x => !x.Notified && x.LastEpisode.GetValueOrDefault(0) > x.CurrentEpisode.GetValueOrDefault(0))
            .Select(x =>
            {
                int watched = x.CurrentEpisode.GetValueOrDefault(0);
                int available = x.LastEpisode.GetValueOrDefault(0);

                return new
                {
                    id = x.Id,
                    userKey = x.UserKey,
                    contentId = x.ContentId,
                    title = x.Title,
                    originalTitle = x.OriginalTitle,
                    kpId = x.KpId,
                    imdbId = x.ImdbId,
                    tmdbId = x.TmdbId,
                    poster = x.Poster,
                    season = x.LastSeason ?? x.CurrentSeason ?? 1,
                    episode = available,
                    currentSeason = x.CurrentSeason,
                    currentEpisode = watched,
                    watchedEpisode = watched,
                    availableEpisode = available,
                    fromEpisode = watched + 1,
                    toEpisode = available,
                    newCount = Math.Max(0, available - watched),
                    source = x.Source,
                    sources = x.Sources,
                    translationId = x.TranslationId,
                    translationName = x.TranslationName,
                    lastCheckedAt = x.LastCheckedAt
                };
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
        int synced = SyncTimeCodeProgress(userKey);

        var list = SubscriptionStore.Load();
        if (!string.IsNullOrWhiteSpace(userKey))
            list = list.Where(x => x.UserKey == userKey).ToList();

        return ContentTo(JsonConvert.SerializeObject(new
        {
            success = true,
            count = list.Count,
            synced,
            source = "lampac-timecode"
        }));
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
        string sources,
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
            Uid = ResolveRequestUid(uid),
            ImdbId = imdbId,
            KpId = kp,
            Title = title,
            OriginalTitle = originalTitle,
            Year = contentYear,
            IsSerial = isTv,
            Season = targetSeason,
            Sources = ParseSources(sources)
        });

        return ContentTo(JsonConvert.SerializeObject(response));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/check")]
    [Route("transsubscribe/check")]
    async public Task<ActionResult> Check(string userKey = null, string sources = null)
    {
        SyncTimeCodeProgress(userKey);
        await TranslationSubscriptionService.Tick(userKey, ParseSources(sources), force: true);
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

        bool subscribed = SubscriptionStore.MutateResult(list =>
        {
            var exists = list.FirstOrDefault(x =>
                x.UserKey == sub.UserKey &&
                x.ContentId == sub.ContentId &&
                x.TranslationId == sub.TranslationId &&
                (x.CurrentSeason ?? 1) == (sub.CurrentSeason ?? 1));

            if (exists != null)
            {
                list.Remove(exists);
                return false;
            }

            sub.Id = Guid.NewGuid().ToString("N");
            sub.CreatedAt = DateTime.Now;
            list.Add(sub);
            return true;
        });

        if (subscribed)
            SyncTimeCodeProgress(sub.UserKey);

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
        if (string.IsNullOrWhiteSpace(sub.UserKey))
            sub.UserKey = "local";

        SubscriptionStore.Mutate(list =>
        {
            if (list.Any(x => x.UserKey == sub.UserKey && x.ContentId == sub.ContentId && x.TranslationId == sub.TranslationId && (x.CurrentSeason ?? 1) == (sub.CurrentSeason ?? 1)))
                return;

            sub.Id = Guid.NewGuid().ToString("N");
            sub.CreatedAt = DateTime.Now;
            list.Add(sub);
        });

        SyncTimeCodeProgress(sub.UserKey);
        return ContentTo("{\"success\":true}");
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/watched")]
    [Route("transsubscribe/watched")]
    async public Task<ActionResult> Watched()
    {
        var body = await ReadBody();
        if (body == null)
            return ContentTo("{\"success\":false,\"error\":\"empty body\"}");

        string userKey = body.Value<string>("userKey") ?? "local";
        string contentId = body.Value<string>("contentId");
        int season = body.Value<int?>("season") ?? 0;
        int episode = Math.Max(0, body.Value<int?>("episode") ?? 0);

        if (string.IsNullOrWhiteSpace(contentId) || season <= 0)
            return ContentTo("{\"success\":false,\"error\":\"invalid progress\"}");

        int updated = 0;
        int available = 0;

        // Compatibility path for older clients. New clients only use Timeline as a
        // trigger and let TimeCodeProgressService read the Lampac database directly.
        SubscriptionStore.Mutate(list =>
        {
            var matches = list.Where(x =>
                x.IsSerial &&
                x.UserKey == userKey &&
                x.ContentId == contentId &&
                x.CurrentSeason.GetValueOrDefault(1) == season
            ).ToList();

            updated = matches.Count;
            foreach (var item in matches)
            {
                item.CurrentSeason = season;
                item.CurrentEpisode = episode;

                int itemAvailable = item.LastEpisode.GetValueOrDefault(0);
                available = Math.Max(available, itemAvailable);
                item.Notified = itemAvailable <= episode;
            }
        });

        return ContentTo(JsonConvert.SerializeObject(new
        {
            success = true,
            updated,
            season,
            watchedEpisode = episode,
            availableEpisode = available,
            fromEpisode = available > episode ? episode + 1 : 0,
            toEpisode = available,
            newCount = Math.Max(0, available - episode),
            source = "legacy-client-hint"
        }));
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/remove")]
    [Route("transsubscribe/remove")]
    public ActionResult Remove(string id)
    {
        SubscriptionStore.Mutate(list =>
        {
            list.RemoveAll(x => x.Id == id);
        });
        return ContentTo("{\"success\":true}");
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/notified")]
    [Route("transsubscribe/notified")]
    public ActionResult Notified(string id)
    {
        SubscriptionStore.Mutate(list =>
        {
            var item = list.FirstOrDefault(x => x.Id == id);
            if (item != null)
                item.Notified = true;
        });
        return ContentTo("{\"success\":true}");
    }

    string ResolveRequestUid(string explicitUid = null)
    {
        if (!string.IsNullOrWhiteSpace(explicitUid))
            return explicitUid.Trim();

        string requestUid = requestInfo?.user_uid;
        if (!string.IsNullOrWhiteSpace(requestUid))
            return requestUid.Trim();

        if (Request.Query.TryGetValue("uid", out var uidQuery) && !string.IsNullOrWhiteSpace(uidQuery.ToString()))
            return uidQuery.ToString().Trim();

        if (Request.Query.TryGetValue("account_email", out var accountQuery) && !string.IsNullOrWhiteSpace(accountQuery.ToString()))
            return accountQuery.ToString().Trim();

        return null;
    }

    int SyncTimeCodeProgress(string userKey)
    {
        if (string.IsNullOrWhiteSpace(userKey))
            return 0;

        string requestUserUid = ResolveRequestUid();

        string profileId = null;
        if (Request.Query.TryGetValue("profile_id", out var profileQuery))
            profileId = profileQuery.ToString();

        return TimeCodeProgressService.SyncUser(userKey, requestUserUid, profileId);
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
        int.TryParse(j.Value<string>("currentEpisode"), out int legacyAvailableEpisode);
        int.TryParse(j.Value<string>("availableEpisode"), out int availableEpisode);
        int.TryParse(j.Value<string>("watchedEpisode"), out int watchedEpisode);
        int.TryParse(j.Value<string>("year"), out int year);
        bool.TryParse(j.Value<string>("isSerial"), out bool isSerialBool);

        int latestEpisode = availableEpisode > 0 ? availableEpisode : legacyAvailableEpisode;
        int watched = Math.Max(0, watchedEpisode);

        var sub = new TranslationSubscription
        {
            UserKey = j.Value<string>("userKey") ?? "local",
            Uid = j.Value<string>("uid") ?? j.Value<string>("account_email") ?? ResolveRequestUid(),
            ContentId = j.Value<string>("contentId"),
            Title = j.Value<string>("title"),
            OriginalTitle = j.Value<string>("originalTitle"),
            KpId = j.Value<string>("kpId"),
            ImdbId = j.Value<string>("imdbId"),
            TmdbId = j.Value<string>("tmdbId"),
            Poster = j.Value<string>("poster"),
            Year = year > 0 ? year : null,
            IsSerial = j["isSerial"]?.Type == JTokenType.Boolean ? j.Value<bool>("isSerial") : isSerialBool,
            Source = j.Value<string>("source") ?? "multi",
            TranslationId = j.Value<string>("translationId"),
            TranslationName = j.Value<string>("translationName"),
            CurrentSeason = currentSeason > 0 ? currentSeason : 1,
            CurrentEpisode = watched,
            LastSeason = currentSeason > 0 ? currentSeason : 1,
            LastEpisode = latestEpisode > 0 ? latestEpisode : 0,
            Notified = latestEpisode <= watched
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

    static HashSet<string> ParseSources(string sources)
    {
        if (sources == null)
            return null;

        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (sources.Equals("none", StringComparison.OrdinalIgnoreCase))
            return result;

        foreach (string source in sources.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            string value = source.Trim();
            if (value is "flixcdn" or "phantom" or "zetflixdb" or "cdnvideohub")
                result.Add(value);
        }

        return result;
    }
}
