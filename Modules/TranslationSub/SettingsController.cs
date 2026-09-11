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
using TranslationSub.Services;

namespace TranslationSub;

/// <summary>
/// Canonical server-owned TranslationSub settings API. The Lampa client may
/// mirror values into its Settings UI, but policy, defaults, valid options and
/// selected balancers are persisted and normalized only on the backend.
/// </summary>
public class TranslationSubSettingsController : BaseController
{
    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/v2/settings")]
    async public Task<ActionResult> GetSettings(string uid = null)
    {
        uid = ResolveUid(uid);
        var settings = TranslationSettingsStore.Get(uid);
        var options = await LampacMetadataService.AvailableSourcesAsync(uid).ConfigureAwait(false);

        return ContentTo(JsonConvert.SerializeObject(new
        {
            success = true,
            settings,
            schema = TranslationSettingsStore.UiSchema(),
            availableSourceItems = options
        }));
    }

    // Dynamic Lampac module routing is built around GET/POST endpoints.
    // Keep the v2 resource path canonical while using the runtime-supported
    // mutation verb instead of exposing an endpoint that silently falls through.
    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/v2/settings")]
    async public Task<ActionResult> SetSettings()
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        string raw = await reader.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(raw))
            return ContentTo("{\"success\":false,\"error\":\"empty_body\"}");

        JObject body;
        try
        {
            body = JsonConvert.DeserializeObject<JObject>(raw);
        }
        catch
        {
            return ContentTo("{\"success\":false,\"error\":\"invalid_json\"}");
        }

        string uid = ResolveUid(body?.Value<string>("uid"));
        if (string.IsNullOrWhiteSpace(uid))
            return ContentTo("{\"success\":false,\"error\":\"uid_required\"}");

        var current = TranslationSettingsStore.Get(uid);
        int interval = body?.Value<int?>("checkIntervalHours") ?? current.CheckIntervalHours;
        bool useTmdbSchedule = body?.Value<bool?>("useTmdbSchedule") ?? current.UseTmdbSchedule;
        int tmdbRefreshHours = body?.Value<int?>("tmdbRefreshHours") ?? current.TmdbRefreshHours;
        int endedRefreshDays = body?.Value<int?>("endedRefreshDays") ?? current.EndedRefreshDays;
        string newSeasonMode = body?.Value<string>("newSeasonMode") ?? current.NewSeasonMode;
        var sources = current.Sources?.ToList() ?? new List<string>();

        if (body?["sources"] is JArray arr)
        {
            sources = new List<string>();
            foreach (var item in arr)
            {
                string value = TranslationSettingsStore.NormalizeSourceId(item?.ToString());
                if (value != null)
                    sources.Add(value);
            }
        }

        var settings = TranslationSettingsStore.Set(
            uid,
            interval,
            sources,
            useTmdbSchedule,
            tmdbRefreshHours,
            endedRefreshDays,
            newSeasonMode);

        var options = await LampacMetadataService.AvailableSourcesAsync(uid).ConfigureAwait(false);
        return ContentTo(JsonConvert.SerializeObject(new
        {
            success = true,
            settings,
            schema = TranslationSettingsStore.UiSchema(),
            availableSourceItems = options
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
}
