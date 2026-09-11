(function () {
    'use strict';

    if (window.__TranslationSubSettingsV2Started) return;
    window.__TranslationSubSettingsV2Started = true;

    var ROOT = 'translationsub_settings';
    var BALANCERS = 'translationsub_balancers';
    var KEYS = {
        interval: 'translationsub_interval_hours',
        cardSource: 'translationsub_card_source',
        smartTmdb: 'translationsub_tmdb_schedule',
        tmdbRefreshHours: 'translationsub_tmdb_refresh_hours',
        endedRefreshDays: 'translationsub_tmdb_ended_days',
        newSeasonMode: 'translationsub_new_season_mode'
    };

    var added = false;
    var serverReady = false;
    var serverSchema = {};
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

    function boolOrNull(name) {
        var value = storageGet(name, null);
        if (value === null || value === undefined || value === '') return null;
        if (value === true || value === 1 || value === '1' || value === 'true') return true;
        if (value === false || value === 0 || value === '0' || value === 'false') return false;
        return null;
    }

    function intOrNull(name) {
        var raw = storageGet(name, null);
        if (raw === null || raw === undefined || raw === '') return null;
        var value = parseInt(raw, 10);
        return isNaN(value) ? null : value;
    }

    function sourceList(value) {
        if (!Array.isArray(value)) return [];
        var seen = {};
        return value.map(function (item) { return String(item || '').trim(); })
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
            var id = String(item.id || item.Id || '').trim();
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

    // Geometry is owned by translationsub-bell-theme.js; settings only supplies
    // the native-size SVG anchor that the canonical mask is applied to.
    function settingsBellSvg() {
        return '<svg class="translationsub-settings-bell" width="37" height="37" viewBox="0 0 37 37" aria-hidden="true"></svg>';
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

    function schemaField(name) {
        var field = serverSchema && serverSchema[name];
        return field && typeof field === 'object' ? field : null;
    }

    function schemaValues(name) {
        var field = schemaField(name);
        var values = field && field.values;
        return values && typeof values === 'object' && !Array.isArray(values) ? values : null;
    }

    function schemaDefault(name) {
        var field = schemaField(name);
        return field && field.defaultValue !== undefined ? field.defaultValue : null;
    }

    function applyCanonicalSettings(data) {
        data = data || {};
        var settings = canonicalSettings(data);
        serverSchema = data.schema && typeof data.schema === 'object'
            ? data.schema
            : (settings.schema && typeof settings.schema === 'object' ? settings.schema : serverSchema);
        serverReady = !!(serverSchema && Object.keys(serverSchema).length);
        selectedSources = sourceList(pick(settings, 'Sources', 'sources', []));
        availableItems = normalizeItems(data.availableSourceItems || data.AvailableSourceItems || settings.availableSourceItems || settings.AvailableSourceItems || []);

        var interval = pick(settings, 'CheckIntervalHours', 'checkIntervalHours', null);
        var smart = pick(settings, 'UseTmdbSchedule', 'useTmdbSchedule', null);
        var tmdbHours = pick(settings, 'TmdbRefreshHours', 'tmdbRefreshHours', null);
        var endedDays = pick(settings, 'EndedRefreshDays', 'endedRefreshDays', null);
        var seasonMode = pick(settings, 'NewSeasonMode', 'newSeasonMode', null);
        if (interval !== null) storageSet(KEYS.interval, String(interval));
        if (smart !== null) storageSet(KEYS.smartTmdb, !!smart);
        if (tmdbHours !== null) storageSet(KEYS.tmdbRefreshHours, String(tmdbHours));
        if (endedDays !== null) storageSet(KEYS.endedRefreshDays, String(endedDays));
        if (seasonMode !== null) storageSet(KEYS.newSeasonMode, String(seasonMode));

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
        if (!api || typeof api.updateSettings !== 'function' || !serverReady) return;

        selectedSources = availableItems.length ? currentSelectionFromTriggers() : selectedSources.slice();
        var body = { sources: selectedSources.slice() };
        var interval = intOrNull(KEYS.interval);
        var smart = boolOrNull(KEYS.smartTmdb);
        var tmdbHours = intOrNull(KEYS.tmdbRefreshHours);
        var endedDays = intOrNull(KEYS.endedRefreshDays);
        var seasonMode = storageGet(KEYS.newSeasonMode, null);

        if (interval !== null) body.checkIntervalHours = interval;
        if (smart !== null) body.useTmdbSchedule = smart;
        if (tmdbHours !== null) body.tmdbRefreshHours = tmdbHours;
        if (endedDays !== null) body.endedRefreshDays = endedDays;
        if (seasonMode !== null && seasonMode !== '') body.newSeasonMode = String(seasonMode);

        api.updateSettings(body, function (response) {
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

    function addServerSelect(schemaName, storageKey, name, description) {
        var values = schemaValues(schemaName);
        var defaultValue = schemaDefault(schemaName);
        if (!values || defaultValue === null) return;

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: storageKey, type: 'select', values: values, 'default': String(defaultValue) },
            field: { name: name, description: description },
            onChange: syncServerSettings
        });
    }

    function rebuildSettings() {
        if (added || !window.Lampa || !Lampa.SettingsApi) return;
        added = true;

        try { if (typeof Lampa.SettingsApi.removeParams === 'function') Lampa.SettingsApi.removeParams(ROOT); } catch (e) {}
        try { if (typeof Lampa.SettingsApi.removeParams === 'function') Lampa.SettingsApi.removeParams(BALANCERS); } catch (e2) {}

        Lampa.SettingsApi.addComponent({ component: ROOT, name: 'Подписки на озвучки', icon: settingsBellSvg() });

        if (serverReady) {
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

            addServerSelect(
                'checkIntervalHours',
                KEYS.interval,
                'Интервал активного опроса',
                'Как часто проверять выбранные балансеры после выхода серии по TMDB.'
            );

            var smartDefault = schemaDefault('useTmdbSchedule');
            if (smartDefault !== null) {
                Lampa.SettingsApi.addParam({
                    component: ROOT,
                    param: { name: KEYS.smartTmdb, type: 'trigger', values: '', 'default': !!smartDefault },
                    field: { name: 'Умное расписание TMDB', description: 'Не опрашивать балансеры до фактического выхода серии или сезона.' },
                    onChange: syncServerSettings
                });
            }

            addServerSelect(
                'tmdbRefreshHours',
                KEYS.tmdbRefreshHours,
                'Обновление расписания TMDB',
                'Как часто перепроверять расписание активных сериалов.'
            );
            addServerSelect(
                'endedRefreshDays',
                KEYS.endedRefreshDays,
                'Перепроверка завершённых сериалов',
                'Как часто TMDB проверяется на неожиданное продолжение.'
            );
            addServerSelect(
                'newSeasonMode',
                KEYS.newSeasonMode,
                'Когда начинается новый сезон',
                'Поведение подписки после появления следующего сезона.'
            );
        } else {
            Lampa.SettingsApi.addParam({
                component: ROOT,
                param: { name: 'translationsub_server_settings_unavailable', type: 'title', 'default': '' },
                field: { name: 'Серверные настройки временно недоступны' }
            });
        }

        // This preference changes only which Lampa card provider opens from the UI;
        // it is intentionally local and is not a TranslationSub domain policy.
        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: KEYS.cardSource, type: 'select', values: { tmdb: 'TMDB', cub: 'CUB' }, 'default': 'tmdb' },
            field: { name: 'Источник карточки', description: 'Источник карточки Lampa при открытии сериала из подписок.' }
        });

        if (serverReady) {
            Lampa.SettingsApi.addParam({
                component: BALANCERS,
                param: { name: 'translationsub_balancers_title', type: 'title', 'default': '' },
                field: { name: 'Доступные в Lampac балансеры' }
            });
            availableItems.forEach(addBalancer);
        }
    }

    function loadServerSettings() {
        var api = window.TranslationSubApi;
        if (!api || typeof api.settings !== 'function') return false;

        api.settings(function (data) {
            applyCanonicalSettings(data);
            rebuildSettings();
        }, function () {
            serverReady = false;
            serverSchema = {};
            availableItems = [];
            selectedSources = [];
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
