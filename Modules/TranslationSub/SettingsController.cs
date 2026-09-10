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

public class TranslationSubSettingsController : BaseController
{
    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/user-settings")]
    [Route("translationsub/v2/settings")]
    async public Task<ActionResult> GetSettings(string uid = null)
    {
        uid = ResolveUid(uid);
        var options = await LampacMetadataService.AvailableSourcesAsync(uid).ConfigureAwait(false);
        var json = JObject.FromObject(TranslationSettingsStore.Get(uid));
        json["availableSources"] = JArray.FromObject(options.Select(x => x.id));
        json["availableSourceItems"] = JArray.FromObject(options);
        return ContentTo(json.ToString(Formatting.None));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/sources")]
    async public Task<ActionResult> GetSources(string uid = null)
    {
        var options = await LampacMetadataService.AvailableSourcesAsync(ResolveUid(uid)).ConfigureAwait(false);
        return ContentTo(JsonConvert.SerializeObject(new
        {
            sources = options.Select(x => x.id).ToList(),
            items = options
        }));
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/user-settings")]
    public Task<ActionResult> SetSettings()
        => SetSettingsCore();

    [HttpPut]
    [AllowAnonymous]
    [Route("translationsub/v2/settings")]
    public Task<ActionResult> SetSettingsV2()
        => SetSettingsCore();

    async Task<ActionResult> SetSettingsCore()
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        string raw = await reader.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(raw))
            return ContentTo("{\"success\":false,\"error\":\"empty body\"}");

        JObject body;
        try
        {
            body = JsonConvert.DeserializeObject<JObject>(raw);
        }
        catch
        {
            return ContentTo("{\"success\":false,\"error\":\"invalid json\"}");
        }

        string uid = ResolveUid(body?.Value<string>("uid"));
        if (string.IsNullOrWhiteSpace(uid))
            return ContentTo("{\"success\":false,\"error\":\"uid required\"}");

        int interval = body?.Value<int?>("checkIntervalHours") ?? 1;
        bool? useTmdbSchedule = body?["useTmdbSchedule"]?.Type == JTokenType.Null
            ? null
            : body?.Value<bool?>("useTmdbSchedule");
        int? tmdbRefreshHours = body?.Value<int?>("tmdbRefreshHours");
        int? endedRefreshDays = body?.Value<int?>("endedRefreshDays");
        string newSeasonMode = body?.Value<string>("newSeasonMode");
        var sources = new List<string>();

        if (body?["sources"] is JArray arr)
        {
            foreach (var item in arr)
            {
                string value = TranslationSettingsStore.NormalizeSourceId(item?.ToString());
                if (value != null)
                    sources.Add(value);
            }
        }
        else
        {
            string rawSources = body?.Value<string>("sources");
            if (!string.IsNullOrWhiteSpace(rawSources))
            {
                sources.AddRange(rawSources
                    .Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(TranslationSettingsStore.NormalizeSourceId)
                    .Where(x => x != null));
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
            availableSources = options.Select(x => x.id).ToList(),
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

        if (Request.Query.TryGetValue("uid", out var uidQuery) && !string.IsNullOrWhiteSpace(uidQuery.ToString()))
            return uidQuery.ToString().Trim();

        return null;
    }
}
