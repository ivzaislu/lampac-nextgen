using Newtonsoft.Json;
using System.Collections.Generic;
using System.IO;
using TranslationSub.Models;

namespace TranslationSub.Services;

public static class SubscriptionStore
{
    static readonly object locker = new();
    static string path => "database/translationsub/subscriptions.json";

    public static List<TranslationSubscription> Load()
    {
        lock (locker)
        {
            if (!File.Exists(path))
                return new List<TranslationSubscription>();

            try
            {
                return JsonConvert.DeserializeObject<List<TranslationSubscription>>(File.ReadAllText(path)) ?? new List<TranslationSubscription>();
            }
            catch
            {
                return new List<TranslationSubscription>();
            }
        }
    }

    public static void Save(List<TranslationSubscription> list)
    {
        lock (locker)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, JsonConvert.SerializeObject(list, Formatting.Indented));
        }
    }
}
