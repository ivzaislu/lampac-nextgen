using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace TranslationSub.Services;

public class TranslationUserSettings
{
    public string Uid { get; set; }
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

    static TranslationUserSettings Normalize(TranslationUserSettings value, string uid = null, bool touchUpdatedAt = false)
    {
        value ??= new TranslationUserSettings();
        value.Uid = string.IsNullOrWhiteSpace(value.Uid) ? uid?.Trim() : value.Uid.Trim();
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
            Uid = value.Uid,
            CheckIntervalHours = value.CheckIntervalHours,
            Sources = value.Sources?.ToList() ?? new List<string>(),
            UseTmdbSchedule = value.UseTmdbSchedule,
            TmdbRefreshHours = value.TmdbRefreshHours,
            EndedRefreshDays = value.EndedRefreshDays,
            NewSeasonMode = value.NewSeasonMode,
            UpdatedAt = value.UpdatedAt
        };
    }

    public static TranslationUserSettings Get(string uid)
    {
        uid = string.IsNullOrWhiteSpace(uid) ? null : uid.Trim();

        lock (locker)
        {
            var current = uid == null
                ? null
                : LoadUnsafe().FirstOrDefault(x => string.Equals(x.Uid, uid, StringComparison.Ordinal));
            if (current == null)
                return Normalize(new TranslationUserSettings { Uid = uid }, uid);

            return Normalize(Clone(current), uid);
        }
    }

    public static TranslationUserSettings Set(
        string uid,
        int checkIntervalHours,
        IEnumerable<string> sources,
        bool? useTmdbSchedule = null,
        int? tmdbRefreshHours = null,
        int? endedRefreshDays = null,
        string newSeasonMode = null)
    {
        uid = string.IsNullOrWhiteSpace(uid) ? null : uid.Trim();
        if (uid == null)
            throw new ArgumentException("uid is required", nameof(uid));

        lock (locker)
        {
            var list = LoadUnsafe();
            var current = list.FirstOrDefault(x => string.Equals(x.Uid, uid, StringComparison.Ordinal));
            if (current == null)
            {
                current = new TranslationUserSettings { Uid = uid };
                list.Add(current);
            }

            current.CheckIntervalHours = checkIntervalHours;
            current.Sources = sources?.ToList() ?? new List<string>();
            if (useTmdbSchedule.HasValue) current.UseTmdbSchedule = useTmdbSchedule.Value;
            if (tmdbRefreshHours.HasValue) current.TmdbRefreshHours = tmdbRefreshHours.Value;
            if (endedRefreshDays.HasValue) current.EndedRefreshDays = endedRefreshDays.Value;
            if (!string.IsNullOrWhiteSpace(newSeasonMode)) current.NewSeasonMode = newSeasonMode;

            Normalize(current, uid, true);
            SaveUnsafe(list);
            return Clone(current);
        }
    }

    /// <summary>
    /// Canonical UI options/defaults for server-owned policy settings. Clients
    /// render this schema and mirror canonical values, but do not define policy.
    /// </summary>
    public static object UiSchema()
    {
        var intervalValues = Enumerable.Range(1, 24)
            .ToDictionary(x => x.ToString(), HourLabel, StringComparer.Ordinal);

        return new
        {
            checkIntervalHours = new
            {
                defaultValue = 1,
                values = intervalValues
            },
            useTmdbSchedule = new
            {
                defaultValue = true
            },
            tmdbRefreshHours = new
            {
                defaultValue = 24,
                values = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["6"] = "6 часов",
                    ["12"] = "12 часов",
                    ["24"] = "24 часа",
                    ["48"] = "2 дня",
                    ["72"] = "3 дня",
                    ["168"] = "7 дней"
                }
            },
            endedRefreshDays = new
            {
                defaultValue = 7,
                values = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["7"] = "7 дней",
                    ["14"] = "14 дней",
                    ["30"] = "30 дней",
                    ["60"] = "60 дней"
                }
            },
            newSeasonMode = new
            {
                defaultValue = "auto",
                values = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["auto"] = "Автоматически продолжать",
                    ["notify"] = "Только показать новый сезон",
                    ["off"] = "Не отслеживать новые сезоны"
                }
            }
        };
    }

    static string HourLabel(int value)
    {
        int mod10 = value % 10;
        int mod100 = value % 100;
        string suffix = mod10 == 1 && mod100 != 11
            ? "час"
            : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
                ? "часа"
                : "часов";
        return value + " " + suffix;
    }
}
