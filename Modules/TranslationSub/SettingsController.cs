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
using TranslationSub.Providers;
using TranslationSub.Services;

namespace TranslationSub;

public class TranslationSubSettingsController : BaseController
{
    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/user-settings")]
    public ActionResult GetSettings(string userKey = null)
    {
        var json = JObject.FromObject(TranslationSettingsStore.Get(userKey));
        json["availableSources"] = JArray.FromObject(TranslationProviderHub.AvailableSources());
        return ContentTo(json.ToString(Formatting.None));
    }

    [HttpGet]
    [AllowAnonymous]
    [Route("translationsub/sources")]
    public ActionResult GetSources()
    {
        return ContentTo(JsonConvert.SerializeObject(new
        {
            sources = TranslationProviderHub.AvailableSources()
        }));
    }

    [HttpPost]
    [AllowAnonymous]
    [Route("translationsub/user-settings")]
    async public Task<ActionResult> SetSettings()
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

        string userKey = body?.Value<string>("userKey") ?? "local";
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
                string value = item?.ToString();
                if (!string.IsNullOrWhiteSpace(value))
                    sources.Add(value);
            }
        }
        else
        {
            string rawSources = body?.Value<string>("sources");
            if (!string.IsNullOrWhiteSpace(rawSources))
                sources.AddRange(rawSources.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()));
        }

        var settings = TranslationSettingsStore.Set(
            userKey,
            interval,
            sources,
            useTmdbSchedule,
            tmdbRefreshHours,
            endedRefreshDays,
            newSeasonMode);

        return ContentTo(JsonConvert.SerializeObject(new
        {
            success = true,
            settings,
            availableSources = TranslationProviderHub.AvailableSources()
        }));
    }
}
