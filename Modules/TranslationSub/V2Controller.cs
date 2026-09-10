using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using Shared;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TranslationSub.Services;

namespace TranslationSub;

/// <summary>
/// Backend-first TranslationSub commands/read endpoints used by thin clients.
/// Legacy routes remain in TranslationSubController only as a compatibility
/// surface while the migration is completed.
/// </summary>
public class TranslationSubV2Controller : BaseController
{
    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/v2/check")]
    async public Task<ActionResult> Check(string uid = null)
    {
        uid = ResolveUid(uid);
        if (string.IsNullOrWhiteSpace(uid))
        {
            return ContentTo(JsonConvert.SerializeObject(new
            {
                success = false,
                error = "uid_required"
            }));
        }

        string profileId = ResolveProfileId();

        // Progress is reconciled server-side. This keeps the read model correct
        // even if TranslationSub was disabled or restarted while TimeCode changed.
        TimeCodeProgressService.SyncUser(uid, profileId);

        var selectedSources = (TranslationSettingsStore.Get(uid).Sources ?? new List<string>())
            .Select(TranslationSettingsStore.NormalizeSourceId)
            .Where(x => x != null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        await TranslationSubscriptionService.Tick(uid, selectedSources, force: true);

        // Tick may change available episodes/schedule state. Return the canonical
        // profile-aware read model so the client never has to reconstruct it or
        // perform a second request after a manual check.
        TimeCodeProgressService.SyncUser(uid, profileId);
        var snapshot = TranslationSubSnapshotService.Build(uid, profileId);

        return ContentTo(JsonConvert.SerializeObject(new
        {
            success = true,
            snapshot
        }));
    }

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
}
