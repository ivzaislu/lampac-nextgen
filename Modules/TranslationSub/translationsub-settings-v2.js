(function () {
    'use strict';

    if (window.__TranslationSubSettingsV2Started) return;
    window.__TranslationSubSettingsV2Started = true;

    var ROOT = 'translationsub_settings';
    var BALANCERS = 'translationsub_balancers';
    var SOURCES_KEY = 'translationsub_sources';
    var KEYS = {
        interval: 'translationsub_interval_hours',
        cardSource: 'translationsub_card_source',
        smartTmdb: 'translationsub_tmdb_schedule',
        tmdbRefreshHours: 'translationsub_tmdb_refresh_hours',
        endedRefreshDays: 'translationsub_tmdb_ended_days',
        newSeasonMode: 'translationsub_new_season_mode'
    };

    var added = false;
    var availableItems = [];
    var selectedSources = [];
    var sourceParamKeys = {};

    function storageGet(name, fallback) {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function')
                return Lampa.Storage.get(name, fallback);
        } catch (e) {}
        try {
            var value = localStorage.getItem(name);
            return value === null ? fallback : value;
        } catch (e2) { return fallback; }
    }

    function storageSet(name, value) {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.set === 'function') {
                Lampa.Storage.set(name, value);
                return;
            }
        } catch (e) {}
        try { localStorage.setItem(name, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e2) {}
    }

    function settingBool(name, fallback) {
        var value = storageGet(name, fallback);
        if (value === true || value === 1 || value === '1' || value === 'true') return true;
        if (value === false || value === 0 || value === '0' || value === 'false') return false;
        return !!fallback;
    }

    function intSetting(name, fallback) {
        var value = parseInt(storageGet(name, String(fallback)), 10);
        return isNaN(value) ? fallback : value;
    }

    function sourceList(value) {
        if (typeof value === 'string') {
            try { value = JSON.parse(value); }
            catch (e) { value = value ? value.split(',') : []; }
        }
        if (!Array.isArray(value)) return [];
        var seen = {};
        return value.map(function (item) { return String(item || '').trim().toLowerCase(); })
            .filter(function (item) {
                if (!item || seen[item]) return false;
                seen[item] = true;
                return true;
            });
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') Lampa.Noty.show(text);
        } catch (e) {}
    }

    function pick(object, pascal, camel, fallback) {
        if (!object) return fallback;
        if (object[pascal] !== undefined && object[pascal] !== null) return object[pascal];
        if (object[camel] !== undefined && object[camel] !== null) return object[camel];
        return fallback;
    }

    function normalizeItems(value) {
        if (!Array.isArray(value)) return [];
        var seen = {};
        return value.map(function (item) {
            item = item || {};
            var id = String(item.id || item.Id || '').trim().toLowerCase();
            var name = String(item.name || item.Name || id).trim();
            return { id: id, name: name || id };
        }).filter(function (item) {
            if (!item.id || seen[item.id]) return false;
            seen[item.id] = true;
            return true;
        });
    }

    function sourceParamKey(id) {
        var hash = 0;
        for (var i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
        return 'translationsub_source_' + id.replace(/[^a-z0-9]+/gi, '_') + '_' + Math.abs(hash);
    }

    function settingsBellSvg() {
        return '<svg class="translationsub-settings-bell" width="37" height="37" viewBox="0 0 37 37" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M28.2 25.4H8.8c1.9-2.1 3-4.5 3-7.3v-3.2a6.7 6.7 0 0 1 13.4 0v3.2c0 2.8 1.1 5.2 3 7.3Z" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M15.2 29.1a3.7 3.7 0 0 0 6.6 0" stroke="currentColor" stroke-width="2.15" stroke-linecap="round"/>' +
        '</svg>';
    }

    function hourValues() {
        var values = {};
        for (var i = 1; i <= 24; i++) {
            var suffix = i === 1 || i === 21 ? 'час' : ((i >= 2 && i <= 4) || (i >= 22 && i <= 24) ? 'часа' : 'часов');
            values[String(i)] = i + ' ' + suffix;
        }
        return values;
    }

    function availableIdSet() {
        var result = {};
        availableItems.forEach(function (item) { result[item.id] = true; });
        return result;
    }

    function currentSelectionFromTriggers() {
        var available = availableIdSet();
        var result = selectedSources.filter(function (id) { return !available[id]; });

        availableItems.forEach(function (item) {
            var key = sourceParamKeys[item.id];
            if (key && settingBool(key, false)) result.push(item.id);
        });

        return sourceList(result);
    }

    function canonicalSettings(data) {
        if (data && data.settings && typeof data.settings === 'object') return data.settings;
        return data || {};
    }

    function applyCanonicalSettings(data) {
        data = data || {};
        var settings = canonicalSettings(data);
        selectedSources = sourceList(pick(settings, 'Sources', 'sources', []));
        availableItems = normalizeItems(data.availableSourceItems || data.AvailableSourceItems || settings.availableSourceItems || settings.AvailableSourceItems || availableItems);
        storageSet(SOURCES_KEY, selectedSources);

        var interval = pick(settings, 'CheckIntervalHours', 'checkIntervalHours', null);
        var smart = pick(settings, 'UseTmdbSchedule', 'useTmdbSchedule', null);
        var tmdbHours = pick(settings, 'TmdbRefreshHours', 'tmdbRefreshHours', null);
        var endedDays = pick(settings, 'EndedRefreshDays', 'endedRefreshDays', null);
        var seasonMode = pick(settings, 'NewSeasonMode', 'newSeasonMode', null);
        if (interval !== null) storageSet(KEYS.interval, String(interval));
        if (smart !== null) storageSet(KEYS.smartTmdb, !!smart);
        if (tmdbHours !== null) storageSet(KEYS.tmdbRefreshHours, String(tmdbHours));
        if (endedDays !== null) storageSet(KEYS.endedRefreshDays, String(endedDays));
        if (seasonMode) storageSet(KEYS.newSeasonMode, String(seasonMode));

        availableItems.forEach(function (item) {
            var key = sourceParamKeys[item.id] || sourceParamKey(item.id);
            sourceParamKeys[item.id] = key;
            storageSet(key, selectedSources.indexOf(item.id) >= 0);
        });
    }

    function refreshPlugin() {
        try {
            if (window.TranslationSub && typeof window.TranslationSub.refresh === 'function') window.TranslationSub.refresh();
        } catch (e) {}
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function')
                window.TranslationSubBadgeState.refresh();
        } catch (e2) {}
    }

    function syncServerSettings() {
        var api = window.TranslationSubApi;
        if (!api || typeof api.updateSettings !== 'function') return;

        selectedSources = availableItems.length ? currentSelectionFromTriggers() : selectedSources.slice();

        api.updateSettings({
            checkIntervalHours: intSetting(KEYS.interval, 1),
            sources: selectedSources,
            useTmdbSchedule: settingBool(KEYS.smartTmdb, true),
            tmdbRefreshHours: intSetting(KEYS.tmdbRefreshHours, 24),
            endedRefreshDays: intSetting(KEYS.endedRefreshDays, 7),
            newSeasonMode: String(storageGet(KEYS.newSeasonMode, 'auto') || 'auto')
        }, function (response) {
            if (!response || response.success !== true) {
                notify('Не удалось сохранить настройки TranslationSub');
                return;
            }
            applyCanonicalSettings(response);
            refreshPlugin();
        }, function () {
            notify('Не удалось сохранить настройки TranslationSub');
        });
    }

    function openBalancersSettings() {
        if (!window.Lampa || !Lampa.Settings || typeof Lampa.Settings.create !== 'function') {
            notify('Эта версия Lampa не поддерживает вложенные настройки');
            return;
        }
        try { if (Lampa.Controller && typeof Lampa.Controller.back === 'function') Lampa.Controller.back(); } catch (e) {}
        setTimeout(function () {
            try {
                Lampa.Settings.create(BALANCERS, {
                    onBack: function () { try { Lampa.Settings.create(ROOT); } catch (e) {} }
                });
            } catch (e2) { notify('Не удалось открыть балансеры'); }
        }, 0);
    }

    function addBalancer(item) {
        var key = sourceParamKey(item.id);
        sourceParamKeys[item.id] = key;
        storageSet(key, selectedSources.indexOf(item.id) >= 0);

        Lampa.SettingsApi.addParam({
            component: BALANCERS,
            param: { name: key, type: 'trigger', values: '', 'default': false },
            field: {
                name: item.name,
                description: 'Lampac: ' + item.id + '. Использовать этот балансер для поиска озвучек и новых серий.'
            },
            onChange: function () {
                selectedSources = currentSelectionFromTriggers();
                syncServerSettings();
            }
        });
    }

    function rebuildSettings() {
        if (added || !window.Lampa || !Lampa.SettingsApi) return;
        added = true;

        try { if (typeof Lampa.SettingsApi.removeParams === 'function') Lampa.SettingsApi.removeParams(ROOT); } catch (e) {}
        try { if (typeof Lampa.SettingsApi.removeParams === 'function') Lampa.SettingsApi.removeParams(BALANCERS); } catch (e2) {}

        Lampa.SettingsApi.addComponent({ component: ROOT, name: 'Подписки на озвучки', icon: settingsBellSvg() });
        Lampa.SettingsApi.addComponent({ component: BALANCERS, name: 'Балансеры для опроса', icon: '' });

        var activeCount = selectedSources.filter(function (id) { return availableIdSet()[id]; }).length;
        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: 'translationsub_open_balancers', type: 'button', 'default': '' },
            field: {
                name: 'Балансеры для опроса',
                description: availableItems.length
                    ? 'Активно выбрано: ' + activeCount + ' из ' + availableItems.length
                    : 'Lampac не вернул доступных online-балансеров'
            },
            onChange: openBalancersSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: KEYS.interval, type: 'select', values: hourValues(), 'default': '1' },
            field: { name: 'Интервал активного опроса', description: 'Как часто проверять выбранные балансеры после выхода серии по TMDB.' },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: KEYS.smartTmdb, type: 'trigger', values: '', 'default': true },
            field: { name: 'Умное расписание TMDB', description: 'Не опрашивать балансеры до фактического выхода серии или сезона.' },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: {
                name: KEYS.tmdbRefreshHours,
                type: 'select',
                values: { '6': '6 часов', '12': '12 часов', '24': '24 часа', '48': '2 дня', '72': '3 дня', '168': '7 дней' },
                'default': '24'
            },
            field: { name: 'Обновление расписания TMDB', description: 'Как часто перепроверять расписание активных сериалов.' },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: {
                name: KEYS.endedRefreshDays,
                type: 'select',
                values: { '7': '7 дней', '14': '14 дней', '30': '30 дней', '60': '60 дней' },
                'default': '7'
            },
            field: { name: 'Перепроверка завершённых сериалов', description: 'Как часто TMDB проверяется на неожиданное продолжение.' },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: {
                name: KEYS.newSeasonMode,
                type: 'select',
                values: { auto: 'Автоматически продолжать', notify: 'Только показать новый сезон', off: 'Не отслеживать новые сезоны' },
                'default': 'auto'
            },
            field: { name: 'Когда начинается новый сезон', description: 'Поведение подписки после появления следующего сезона.' },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: KEYS.cardSource, type: 'select', values: { tmdb: 'TMDB', cub: 'CUB' }, 'default': 'tmdb' },
            field: { name: 'Источник карточки', description: 'Источник карточки Lampa при открытии сериала из подписок.' }
        });

        Lampa.SettingsApi.addParam({
            component: BALANCERS,
            param: { name: 'translationsub_balancers_title', type: 'title', 'default': '' },
            field: { name: 'Доступные в Lampac балансеры' }
        });

        availableItems.forEach(addBalancer);
    }

    function loadServerSettings() {
        var api = window.TranslationSubApi;
        if (!api || typeof api.settings !== 'function') return false;

        api.settings(function (data) {
            applyCanonicalSettings(data);
            rebuildSettings();
        }, function () {
            availableItems = [];
            selectedSources = sourceList(storageGet(SOURCES_KEY, []));
            rebuildSettings();
        });
        return true;
    }

    function start() {
        if (!window.Lampa || !Lampa.SettingsApi || !window.TranslationSubApi) return false;
        return loadServerSettings();
    }

    if (!start()) {
        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (start() || attempts > 80) clearInterval(wait);
        }, 250);
    }
})();
