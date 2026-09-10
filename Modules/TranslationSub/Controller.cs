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
using TranslationSub.Services;

namespace TranslationSub;

public class TranslationSubController : BaseController
{
    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/list")]
    [Route("transsubscribe/list")]
    public ActionResult List(string uid = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
            return ContentTo("[]");

        string profileId = ResolveProfileId();
        SyncTimeCodeProgress(uid, profileId);

        var list = TranslationSubProjectionService.ForProfile(uid, profileId);
        return ContentTo(JsonConvert.SerializeObject(list));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/updates")]
    [Route("transsubscribe/updates")]
    async public Task<ActionResult> Updates(string uid = null, bool force = false, string sources = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
            return ContentTo("[]");

        string profileId = ResolveProfileId();
        SyncTimeCodeProgress(uid, profileId);

        if (force)
            await TranslationSubscriptionService.Tick(uid, ResolveSources(uid, sources), force: true);

        var list = TranslationSubProjectionService.ForProfile(uid, profileId);

        var updates = list
            .Where(x => !x.Notified && x.LastEpisode.GetValueOrDefault(0) > x.CurrentEpisode.GetValueOrDefault(0))
            .Select(x =>
            {
                int watched = x.CurrentEpisode.GetValueOrDefault(0);
                int available = x.LastEpisode.GetValueOrDefault(0);

                return new
                {
                    id = x.Id,
                    uid = x.Uid,
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
    public ActionResult Progress(string uid = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
        {
            return ContentTo(JsonConvert.SerializeObject(new
            {
                success = false,
                error = "uid required",
                count = 0,
                synced = 0,
                source = "lampac-timecode"
            }));
        }

        string profileId = ResolveProfileId();
        int synced = SyncTimeCodeProgress(uid, profileId);
        int count = SubscriptionStore.Load()
            .Count(x => string.Equals(x.Uid, uid, StringComparison.Ordinal));

        return ContentTo(JsonConvert.SerializeObject(new
        {
            success = true,
            count,
            synced,
            profileId,
            source = "lampac-timecode"
        }));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/v2/snapshot")]
    public ActionResult Snapshot(string uid = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
        {
            return ContentTo(JsonConvert.SerializeObject(new
            {
                success = false,
                error = "uid required"
            }));
        }

        string profileId = ResolveProfileId();

        // Transitional compatibility: keep the new durable profile projection warm
        // on reads until the TimeCode writer audit proves every write is observed by
        // the server hook. The v2 client itself never owns progress reconciliation.
        SyncTimeCodeProgress(uid, profileId);

        return ContentTo(JsonConvert.SerializeObject(
            TranslationSubSnapshotService.Build(uid, profileId)));
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/v2/content-state")]
    async public Task<ActionResult> ContentState(string uid = null)
    {
        var body = await ReadBody();
        if (body == null)
            return ContentTo("{\"eligible\":false,\"reason\":\"empty_body\"}");

        uid = ResolveUid(uid ?? body.Value<string>("uid"));
        if (string.IsNullOrWhiteSpace(uid))
            return ContentTo("{\"eligible\":false,\"reason\":\"uid_required\"}");

        string profileId = ResolveProfileId();
        SyncTimeCodeProgress(uid, profileId);

        var state = await TranslationSubContentStateService.BuildAsync(
            uid,
            profileId,
            body,
            HttpContext);

        return ContentTo(JsonConvert.SerializeObject(state));
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/v2/subscriptions")]
    async public Task<ActionResult> SubscribeV2(string uid = null)
    {
        var body = await ReadBody();
        if (body == null)
            return ContentTo(JsonConvert.SerializeObject(new TranslationSubCommandResult
            {
                Success = false,
                Error = "empty_body"
            }));

        uid = ResolveUid(uid ?? body.Value<string>("uid"));
        var intent = body.ToObject<TranslationSubSubscribeIntent>();
        var result = await TranslationSubCommandService.SubscribeAsync(uid, intent, HttpContext);

        if (result.Success)
            SyncTimeCodeProgress(uid, ResolveProfileId());

        return ContentTo(JsonConvert.SerializeObject(result));
    }

    [HttpDelete]
    [AllowAnonymous]
    [Route("translationsub/v2/subscriptions/{id}")]
    public ActionResult UnsubscribeV2(string id, string uid = null)
    {
        uid = ResolveUid(uid);
        return ContentTo(JsonConvert.SerializeObject(
            TranslationSubCommandService.Unsubscribe(uid, id)));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/variants")]
    [Route("transsubscribe/variants")]
    async public Task<ActionResult> Variants(
        string uid,
        string contentId,
        string title,
        string originalTitle,
        string kpId,
        string imdbId,
        string tmdbId,
        string year,
        string isSerial,
        string sources,
        int? season,
        long kinopoisk_id = 0,
        bool serial = true)
    {
        uid = ResolveUid(uid);

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

        var response = await LampacMetadataService.GetVariants(new TranslationMetadataQuery
        {
            Uid = uid,
            ContentId = contentId,
            TmdbId = tmdbId,
            ImdbId = imdbId,
            KpId = kp,
            Title = title,
            OriginalTitle = originalTitle,
            Year = contentYear,
            IsSerial = isTv,
            Season = targetSeason,
            Sources = ResolveSources(uid, sources)
        }, HttpContext);

        return ContentTo(JsonConvert.SerializeObject(response));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/check")]
    [Route("transsubscribe/check")]
    async public Task<ActionResult> Check(string uid = null, string sources = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
            return ContentTo("{\"success\":false,\"error\":\"uid required\"}");

        string profileId = ResolveProfileId();
        SyncTimeCodeProgress(uid, profileId);
        await TranslationSubscriptionService.Tick(uid, ResolveSources(uid, sources), force: true);
        return ContentTo("{\"success\":true}");
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

        string uid = ResolveUid(body.Value<string>("uid"));
        if (string.IsNullOrWhiteSpace(uid))
            return ContentTo("{\"success\":false,\"error\":\"uid required\"}");

        var sub = FromJson(body, uid);

        SubscriptionStore.Mutate(list =>
        {
            if (list.Any(x =>
                string.Equals(x.Uid, uid, StringComparison.Ordinal) &&
                x.ContentId == sub.ContentId &&
                x.TranslationId == sub.TranslationId &&
                (x.CurrentSeason ?? 1) == (sub.CurrentSeason ?? 1)))
                return;

            sub.Id = Guid.NewGuid().ToString("N");
            sub.CreatedAt = DateTime.Now;
            list.Add(sub);
        });

        SyncTimeCodeProgress(uid, ResolveProfileId());
        return ContentTo("{\"success\":true}");
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/remove")]
    [Route("transsubscribe/remove")]
    public ActionResult Remove(string id, string uid = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
            return ContentTo("{\"success\":false,\"error\":\"uid required\"}");

        SubscriptionStore.Mutate(list => list.RemoveAll(x =>
            x.Id == id && string.Equals(x.Uid, uid, StringComparison.Ordinal)));
        ProfileProgressStore.RemoveSubscription(uid, id);
        return ContentTo("{\"success\":true}");
    }

    string ResolveUid(string explicitUid = null)
    {
        string requestUid = requestInfo?.user_uid;
        if (!string.IsNullOrWhiteSpace(requestUid))
            return requestUid.Trim();

        if (!string.IsNullOrWhiteSpace(explicitUid))
            return explicitUid.Trim();

        if (Request.Query.TryGetValue("uid", out var uidQuery) && !string.IsNullOrWhiteSpace(uidQuery.ToString()))
            return uidQuery.ToString().Trim();

        return null;
    }

    string ResolveProfileId()
    {
        if (Request.Query.TryGetValue("profile_id", out var profileQuery))
            return ProfileProgressStore.NormalizeProfileId(profileQuery.ToString());

        return "0";
    }

    int SyncTimeCodeProgress(string uid, string profileId = null)
    {
        if (string.IsNullOrWhiteSpace(uid))
            return 0;

        profileId ??= ResolveProfileId();
        return TimeCodeProgressService.SyncUser(uid, profileId);
    }

    async Task<JObject> ReadBody()
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        string raw = await reader.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(raw))
            return null;
        return JsonConvert.DeserializeObject<JObject>(raw);
    }

    TranslationSubscription FromJson(JObject j, string uid)
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
            Uid = uid,
            ContentId = j.Value<string>("contentId"),
            Title = j.Value<string>("title"),
            OriginalTitle = j.Value<string>("originalTitle"),
            KpId = j.Value<string>("kpId"),
            ImdbId = j.Value<string>("imdbId"),
            TmdbId = j.Value<string>("tmdbId"),
            Poster = j.Value<string>("poster"),
            Year = year > 0 ? year : null,
            IsSerial = j["isSerial"]?.Type == JTokenType.Boolean ? j.Value<bool>("isSerial") : isSerialBool,
            Source = j.Value<string>("source") ?? "lampac",
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
                string source = TranslationSettingsStore.NormalizeSourceId(x.Value<string>("source"));
                if (source == null)
                    continue;

                sub.Sources.Add(new TranslationSubscriptionSource
                {
                    Source = source,
                    TranslationId = x.Value<string>("translationId"),
                    TranslationName = x.Value<string>("translationName")
                });
            }
        }

        return sub;
    }

    static HashSet<string> ResolveSources(string uid, string sources)
    {
        var explicitSources = ParseSources(sources);
        if (explicitSources != null)
            return explicitSources;

        return (TranslationSettingsStore.Get(uid).Sources ?? new List<string>())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
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
            string value = TranslationSettingsStore.NormalizeSourceId(source);
            if (value != null)
                result.Add(value);
        }
        return result;
    }
}
