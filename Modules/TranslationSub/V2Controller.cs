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

/// <summary>
/// Canonical backend-first TranslationSub API consumed by thin Lampa clients.
/// Content identity, progress, source selection, voice matching and mutations
/// are resolved server-side; the browser sends intent and renders read models.
/// </summary>
public class TranslationSubV2Controller : BaseController
{
    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/v2/snapshot")]
    public ActionResult Snapshot(string uid = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
            return Error("uid_required");

        string profileId = ResolveProfileId();

        // Server-side safety reconciliation covers restarts or missed NWS
        // invalidations. The client never owns watched-progress synchronization.
        TimeCodeProgressService.SyncUser(uid, profileId);

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
        TimeCodeProgressService.SyncUser(uid, profileId);

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
    async public Task<ActionResult> Subscribe(string uid = null)
    {
        var body = await ReadBody();
        if (body == null)
        {
            return ContentTo(JsonConvert.SerializeObject(new TranslationSubCommandResult
            {
                Success = false,
                Error = "empty_body"
            }));
        }

        uid = ResolveUid(uid ?? body.Value<string>("uid"));
        var intent = body.ToObject<TranslationSubSubscribeIntent>();
        var result = await TranslationSubCommandService.SubscribeAsync(uid, intent, HttpContext);

        if (result.Success)
            TimeCodeProgressService.SyncUser(uid, ResolveProfileId());

        return ContentTo(JsonConvert.SerializeObject(result));
    }

    // Dynamic Lampac modules use GET/POST routing. Treat unsubscribe as a
    // command endpoint so the thin client does not rely on an unsupported verb.
    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/v2/subscriptions/{id}/remove")]
    public ActionResult Unsubscribe(string id, string uid = null)
    {
        uid = ResolveUid(uid);
        return ContentTo(JsonConvert.SerializeObject(
            TranslationSubCommandService.Unsubscribe(uid, id)));
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/v2/check")]
    async public Task<ActionResult> Check(string uid = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
            return Error("uid_required");

        string profileId = ResolveProfileId();
        TimeCodeProgressService.SyncUser(uid, profileId);

        var selectedSources = (TranslationSettingsStore.Get(uid).Sources ?? new List<string>())
            .Select(TranslationSettingsStore.NormalizeSourceId)
            .Where(x => x != null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        await TranslationSubscriptionService.Tick(uid, selectedSources, force: true);

        TimeCodeProgressService.SyncUser(uid, profileId);
        var snapshot = TranslationSubSnapshotService.Build(uid, profileId);

        return ContentTo(JsonConvert.SerializeObject(new
        {
            success = true,
            snapshot
        }));
    }

    ActionResult Error(string error)
        => ContentTo(JsonConvert.SerializeObject(new
        {
            success = false,
            error
        }));

    string ResolveUid(string explicitUid = null)
    {
        string requestUid = requestInfo?.user_uid;
        if (!string.IsNullOrWhiteSpace(requestUid))
            return requestUid.Trim();

        if (!string.IsNullOrWhiteSpace(explicitUid))
            return explicitUid.Trim();

        if (Request.Query.TryGetValue("uid", out var uidQuery)
            && !string.IsNullOrWhiteSpace(uidQuery.ToString()))
            return uidQuery.ToString().Trim();

        return null;
    }

    string ResolveProfileId()
    {
        if (Request.Query.TryGetValue("profile_id", out var profileQuery))
            return ProfileProgressStore.NormalizeProfileId(profileQuery.ToString());

        return "0";
    }

    async Task<JObject> ReadBody()
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        string raw = await reader.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        try
        {
            return JsonConvert.DeserializeObject<JObject>(raw);
        }
        catch
        {
            return null;
        }
    }
}
