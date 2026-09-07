using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace TranslationSub.Services;

public class TranslationUserSettings
{
    public string UserKey { get; set; }
    public int CheckIntervalHours { get; set; } = 1;
    public List<string> Sources { get; set; } = new() { "flixcdn", "phantom", "zetflixdb", "cdnvideohub" };
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}

public static class TranslationSettingsStore
{
    static readonly object locker = new();
    static readonly string[] allowedSources = { "flixcdn", "phantom", "zetflixdb", "cdnvideohub" };
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

    static TranslationUserSettings Normalize(TranslationUserSettings value, string userKey = null)
    {
        value ??= new TranslationUserSettings();
        value.UserKey = string.IsNullOrWhiteSpace(value.UserKey) ? (userKey ?? "local") : value.UserKey;
        value.CheckIntervalHours = Math.Max(1, Math.Min(24, value.CheckIntervalHours));

        value.Sources = (value.Sources ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim().ToLowerInvariant())
            .Where(x => allowedSources.Contains(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        value.UpdatedAt = DateTime.Now;
        return value;
    }

    public static TranslationUserSettings Get(string userKey)
    {
        userKey = string.IsNullOrWhiteSpace(userKey) ? "local" : userKey;

        lock (locker)
        {
            var current = LoadUnsafe().FirstOrDefault(x => x.UserKey == userKey);
            if (current == null)
                return Normalize(new TranslationUserSettings { UserKey = userKey }, userKey);

            return Normalize(new TranslationUserSettings
            {
                UserKey = current.UserKey,
                CheckIntervalHours = current.CheckIntervalHours,
                Sources = current.Sources?.ToList(),
                UpdatedAt = current.UpdatedAt
            }, userKey);
        }
    }

    public static TranslationUserSettings Set(string userKey, int checkIntervalHours, IEnumerable<string> sources)
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
            Normalize(current, userKey);
            SaveUnsafe(list);

            return new TranslationUserSettings
            {
                UserKey = current.UserKey,
                CheckIntervalHours = current.CheckIntervalHours,
                Sources = current.Sources.ToList(),
                UpdatedAt = current.UpdatedAt
            };
        }
    }
}
