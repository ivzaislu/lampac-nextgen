using Shared.Models.Base;
using Shared.Models.Module.Entrys;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using TranslationSub.Models;

namespace TranslationSub.Services;

internal static class LampacSourceRegistry
{
    public static IReadOnlyList<LampacSourceOption> AvailableSources()
    {
        OnlineModuleEntry.EnsureCache();

        var result = new Dictionary<string, LampacSourceOption>(StringComparer.OrdinalIgnoreCase);
        AddModules(OnlineModuleEntry.Modules?.Cast<object>(), result);
        AddModules(OnlineModuleEntry.ModulesAsync?.Cast<object>(), result);

        return result.Values
            .OrderBy(x => x.name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.id, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    static void AddModules(IEnumerable<object> modules, Dictionary<string, LampacSourceOption> result)
    {
        if (modules == null)
            return;

        foreach (object module in modules)
        {
            if (module == null)
                continue;

            foreach (BaseSettings settings in FindSettings(module))
            {
                if (settings == null || !settings.enable || settings.rip)
                    continue;

                string id = TranslationSettingsStore.NormalizeSourceId(settings.plugin);
                if (id == null)
                    continue;

                string name = settings.displayname;
                if (string.IsNullOrWhiteSpace(name))
                    name = settings.plugin;
                if (string.IsNullOrWhiteSpace(name))
                    name = id;

                result[id] = new LampacSourceOption
                {
                    id = id,
                    name = name.Trim()
                };
            }
        }
    }

    static IEnumerable<BaseSettings> FindSettings(object module)
    {
        Type type = module.GetType();
        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic |
            BindingFlags.Static | BindingFlags.Instance | BindingFlags.FlattenHierarchy;

        var seen = new HashSet<BaseSettings>(ReferenceEqualityComparer.Instance);

        foreach (FieldInfo field in type.GetFields(flags))
        {
            if (!typeof(BaseSettings).IsAssignableFrom(field.FieldType))
                continue;

            BaseSettings value = null;
            try { value = field.GetValue(field.IsStatic ? null : module) as BaseSettings; }
            catch { }

            if (value != null && seen.Add(value))
                yield return value;
        }

        foreach (PropertyInfo property in type.GetProperties(flags))
        {
            if (!property.CanRead || property.GetIndexParameters().Length != 0
                || !typeof(BaseSettings).IsAssignableFrom(property.PropertyType))
                continue;

            MethodInfo getter = property.GetGetMethod(true);
            if (getter == null)
                continue;

            BaseSettings value = null;
            try { value = property.GetValue(getter.IsStatic ? null : module) as BaseSettings; }
            catch { }

            if (value != null && seen.Add(value))
                yield return value;
        }
    }
}
