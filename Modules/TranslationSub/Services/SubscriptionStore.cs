using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using TranslationSub.Models;

namespace TranslationSub.Services;

public static class SubscriptionStore
{
    static readonly object locker = new();
    static string path => "database/translationsub/subscriptions.json";

    static List<TranslationSubscription> LoadUnsafe()
    {
        if (!File.Exists(path))
            return new List<TranslationSubscription>();

        try
        {
            return JsonConvert.DeserializeObject<List<TranslationSubscription>>(File.ReadAllText(path))
                ?? new List<TranslationSubscription>();
        }
        catch
        {
            return new List<TranslationSubscription>();
        }
    }

    static void SaveUnsafe(List<TranslationSubscription> list)
    {
        string dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(dir))
            Directory.CreateDirectory(dir);

        string json = JsonConvert.SerializeObject(list ?? new List<TranslationSubscription>(), Formatting.Indented);
        string temp = path + ".tmp";

        File.WriteAllText(temp, json);
        File.Move(temp, path, true);
    }

    public static List<TranslationSubscription> Load()
    {
        lock (locker)
            return LoadUnsafe();
    }

    public static void Save(List<TranslationSubscription> list)
    {
        lock (locker)
            SaveUnsafe(list);
    }

    public static void Mutate(Action<List<TranslationSubscription>> action)
    {
        if (action == null)
            return;

        lock (locker)
        {
            var list = LoadUnsafe();
            action(list);
            SaveUnsafe(list);
        }
    }

    public static bool MutateIfChanged(Func<List<TranslationSubscription>, bool> action)
    {
        if (action == null)
            return false;

        lock (locker)
        {
            var list = LoadUnsafe();
            if (!action(list))
                return false;

            SaveUnsafe(list);
            return true;
        }
    }

    public static T MutateResult<T>(Func<List<TranslationSubscription>, T> action)
    {
        if (action == null)
            return default;

        lock (locker)
        {
            var list = LoadUnsafe();
            T result = action(list);
            SaveUnsafe(list);
            return result;
        }
    }
}
