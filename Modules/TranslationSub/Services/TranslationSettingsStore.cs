using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace TranslationSub.Services;

public class TranslationUserSettings
{
    public string UserKey { get; set; }
    public int CheckIntervalHours { get; set; } = 1;
    public List<string> Sources { get; set; } = new();
    public bool UseTmdbSchedule { get; set; } = true;
    public int TmdbRefreshHours { get; set; } = 24;
    public int EndedRefreshDays { get; set; } = 7;
    public string NewSeasonMode { get; set; } = "auto";
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}

public static class TranslationSettingsStore
{
    static readonly object locker = new();
    static readonly string[] allowedNewSeasonModes = { "auto", "notify", "off" };
    static readonly Regex sourceIdRegex = new("^[a-z0-9][a-z0-9._:/-]{0,119}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    static string path => "database/translationsub/settings.json";

    static List<TranslationUserSettings> LoadUnsafe()
    {
        if (!File.Exists(path))
            return new List<TranslationUserSettings>();

        try
        {
            return JsonConvert.DeserializeObject<List<TranslationUserSettings>>(File.ReadAllText(path))
                ?? new List<TranslationUserSettings>();
        }
        catch
        {
            return new List<TranslationUserSettings>();
        }
    }

    static void SaveUnsafe(List<TranslationUserSettings> list)
    {
        string dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(dir))
            Directory.CreateDirectory(dir);

        string temp = path + ".tmp";
        File.WriteAllText(temp, JsonConvert.SerializeObject(list, Formatting.Indented));
        File.Move(temp, path, true);
    }

    static TranslationUserSettings Normalize(TranslationUserSettings value, string userKey = null, bool touchUpdatedAt = false)
    {
        value ??= new TranslationUserSettings();
        value.UserKey = string.IsNullOrWhiteSpace(value.UserKey) ? (userKey ?? "local") : value.UserKey;
        value.CheckIntervalHours = Math.Max(1, Math.Min(24, value.CheckIntervalHours));
        value.TmdbRefreshHours = Math.Max(6, Math.Min(168, value.TmdbRefreshHours <= 0 ? 24 : value.TmdbRefreshHours));
        value.EndedRefreshDays = Math.Max(1, Math.Min(90, value.EndedRefreshDays <= 0 ? 7 : value.EndedRefreshDays));

        value.NewSeasonMode = string.IsNullOrWhiteSpace(value.NewSeasonMode)
            ? "auto"
            : value.NewSeasonMode.Trim().ToLowerInvariant();
        if (!allowedNewSeasonModes.Contains(value.NewSeasonMode))
            value.NewSeasonMode = "auto";

        value.Sources = (value.Sources ?? new List<string>())
            .Select(NormalizeSourceId)
            .Where(x => x != null)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (touchUpdatedAt)
            value.UpdatedAt = DateTime.Now;

        return value;
    }

    public static string NormalizeSourceId(string value)
    {
        string id = value?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(id) || !sourceIdRegex.IsMatch(id))
            return null;
        return id;
    }

    static TranslationUserSettings Clone(TranslationUserSettings value)
    {
        return new TranslationUserSettings
        {
            UserKey = value.UserKey,
            CheckIntervalHours = value.CheckIntervalHours,
            Sources = value.Sources?.ToList() ?? new List<string>(),
            UseTmdbSchedule = value.UseTmdbSchedule,
            TmdbRefreshHours = value.TmdbRefreshHours,
            EndedRefreshDays = value.EndedRefreshDays,
            NewSeasonMode = value.NewSeasonMode,
            UpdatedAt = value.UpdatedAt
        };
    }

    public static TranslationUserSettings Get(string userKey)
    {
        userKey = string.IsNullOrWhiteSpace(userKey) ? "local" : userKey;

        lock (locker)
        {
            var current = LoadUnsafe().FirstOrDefault(x => x.UserKey == userKey);
            if (current == null)
                return Normalize(new TranslationUserSettings { UserKey = userKey }, userKey);

            return Normalize(Clone(current), userKey);
        }
    }

    public static TranslationUserSettings Set(
        string userKey,
        int checkIntervalHours,
        IEnumerable<string> sources,
        bool? useTmdbSchedule = null,
        int? tmdbRefreshHours = null,
        int? endedRefreshDays = null,
        string newSeasonMode = null)
    {
        userKey = string.IsNullOrWhiteSpace(userKey) ? "local" : userKey;

        lock (locker)
        {
            var list = LoadUnsafe();
            var current = list.FirstOrDefault(x => x.UserKey == userKey);
            if (current == null)
            {
                current = new TranslationUserSettings { UserKey = userKey };
                list.Add(current);
            }

            current.CheckIntervalHours = checkIntervalHours;
            current.Sources = sources?.ToList() ?? new List<string>();
            if (useTmdbSchedule.HasValue) current.UseTmdbSchedule = useTmdbSchedule.Value;
            if (tmdbRefreshHours.HasValue) current.TmdbRefreshHours = tmdbRefreshHours.Value;
            if (endedRefreshDays.HasValue) current.EndedRefreshDays = endedRefreshDays.Value;
            if (!string.IsNullOrWhiteSpace(newSeasonMode)) current.NewSeasonMode = newSeasonMode;

            Normalize(current, userKey, true);
            SaveUnsafe(list);
            return Clone(current);
        }
    }
}
