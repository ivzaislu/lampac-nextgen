(function () {
    'use strict';

    if (window.__TranslationSubSettingsV2Started) return;
    window.__TranslationSubSettingsV2Started = true;

    var ROOT = 'translationsub_settings';
    var BALANCERS = 'translationsub_balancers';
    var KEYS = {
        flixcdn: 'translationsub_flixcdn',
        phantom: 'translationsub_phantom',
        zetflixdb: 'translationsub_zetflixdb',
        videohub: 'translationsub_videohub',
        interval: 'translationsub_interval_hours',
        legacyInterval: 'translationsub_interval',
        cardSource: 'translationsub_card_source'
    };

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
        try { localStorage.setItem(name, value); } catch (e2) {}
    }

    function userKey() {
        return String(storageGet('client_uid', '') || storageGet('lampac_unic_id', '') || 'local');
    }

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            return window.location.origin || '';
        } catch (e) { return ''; }
    }

    function settingBool(name, fallback) {
        var value = storageGet(name, fallback);
        if (value === true || value === 1 || value === '1' || value === 'true') return true;
        if (value === false || value === 0 || value === '0' || value === 'false') return false;
        return !!fallback;
    }

    function enabledSources() {
        var result = [];
        if (settingBool(KEYS.flixcdn, true)) result.push('flixcdn');
        if (settingBool(KEYS.phantom, true)) result.push('phantom');
        if (settingBool(KEYS.zetflixdb, true)) result.push('zetflixdb');
        if (settingBool(KEYS.videohub, true)) result.push('cdnvideohub');
        return result;
    }

    function checkIntervalHours() {
        var value = parseInt(storageGet(KEYS.interval, '1'), 10);
        return isNaN(value) ? 1 : Math.max(1, Math.min(24, value));
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function')
                Lampa.Noty.show(text);
        } catch (e) {}
    }

    function settingsBellSvg() {
        return '<svg class="translationsub-settings-bell" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M18 8.5a6 6 0 0 0-12 0c0 7-3 7-3 8.5h18c0-1.5-3-1.5-3-8.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M9.7 20a2.5 2.5 0 0 0 4.6 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
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

    function request(method, path, body, success, error) {
        success = success || function () {};
        error = error || function () {};
        var url = host() + path;

        if (typeof fetch === 'function') {
            var options = { method: method, headers: { 'Content-Type': 'application/json; charset=utf-8' } };
            if (body && method !== 'GET') options.body = JSON.stringify(body);
            fetch(url, options)
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    try { success(text ? JSON.parse(text) : {}); }
                    catch (e) { success({}); }
                })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { success(xhr.responseText ? JSON.parse(xhr.responseText) : {}); }
                    catch (e) { success({}); }
                } else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(body && method !== 'GET' ? JSON.stringify(body) : null);
        } catch (e2) { error(e2); }
    }

    function syncServerSettings() {
        request('POST', '/translationsub/user-settings', {
            userKey: userKey(),
            checkIntervalHours: checkIntervalHours(),
            sources: enabledSources()
        });
    }

    function refreshPlugin() {
        try {
            if (window.TranslationSub && typeof window.TranslationSub.refresh === 'function')
                window.TranslationSub.refresh();
        } catch (e) {}
    }

    function openBalancersSettings() {
        if (!window.Lampa || !Lampa.Settings || typeof Lampa.Settings.create !== 'function') {
            notify('Эта версия Lampa не поддерживает вложенные настройки');
            return;
        }

        try {
            if (Lampa.Controller && typeof Lampa.Controller.back === 'function') Lampa.Controller.back();
        } catch (e) {}

        setTimeout(function () {
            try {
                Lampa.Settings.create(BALANCERS, {
                    onBack: function () {
                        try { Lampa.Settings.create(ROOT); } catch (e) {}
                    }
                });
            } catch (e2) {
                notify('Не удалось открыть балансеры');
            }
        }, 0);
    }

    function addBalancer(name, key, description) {
        Lampa.SettingsApi.addParam({
            component: BALANCERS,
            param: { name: key, type: 'trigger', values: '', 'default': true },
            field: { name: name, description: description },
            onChange: function () {
                syncServerSettings();
                refreshPlugin();
            }
        });
    }

    function rebuildSettings() {
        if (!window.Lampa || !Lampa.SettingsApi || window.__TranslationSubSettingsV2Added) return;
        window.__TranslationSubSettingsV2Added = true;

        try { if (typeof Lampa.SettingsApi.removeParams === 'function') Lampa.SettingsApi.removeParams(ROOT); } catch (e) {}
        try { if (typeof Lampa.SettingsApi.removeParams === 'function') Lampa.SettingsApi.removeParams(BALANCERS); } catch (e2) {}

        Lampa.SettingsApi.addComponent({
            component: ROOT,
            name: 'Подписки на озвучки',
            icon: settingsBellSvg()
        });

        Lampa.SettingsApi.addComponent({
            component: BALANCERS,
            name: 'Балансеры для опроса',
            icon: ''
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: 'translationsub_open_balancers', type: 'button', 'default': '' },
            field: {
                name: 'Балансеры для опроса',
                description: 'Выбрать источники, которые участвуют в поиске озвучек и фоновой проверке новых серий'
            },
            onChange: openBalancersSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: {
                name: KEYS.interval,
                type: 'select',
                values: hourValues(),
                'default': '1'
            },
            field: {
                name: 'Интервал проверки',
                description: 'Как часто сервер Lampac опрашивает выбранные балансеры. Ручная проверка работает сразу.'
            },
            onChange: function () {
                syncServerSettings();
            }
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: {
                name: KEYS.cardSource,
                type: 'select',
                values: { tmdb: 'TMDB', cub: 'CUB' },
                'default': 'tmdb'
            },
            field: {
                name: 'Источник карточки',
                description: 'Источник карточки Lampa при открытии сериала из озвучек. По умолчанию TMDB.'
            }
        });

        Lampa.SettingsApi.addParam({
            component: BALANCERS,
            param: { name: 'translationsub_balancers_title', type: 'title', 'default': '' },
            field: { name: 'Балансеры для опроса' }
        });

        addBalancer('FlixCDN', KEYS.flixcdn, 'Искать озвучки и новые серии через FlixCDN');
        addBalancer('Phantom', KEYS.phantom, 'Искать озвучки и новые серии через Phantom');
        addBalancer('ZetflixDB', KEYS.zetflixdb, 'Искать озвучки и новые серии через ZetflixDB');
        addBalancer('VideoHUB', KEYS.videohub, 'Искать озвучки и новые серии через VideoHUB');

        // Старый таймер основного скрипта оставляем только как лёгкое обновление бейджа.
        // На следующем запуске он будет не чаще одного раза в час, а request_before ниже
        // не даст ему запускать принудительный опрос балансеров.
        storageSet(KEYS.legacyInterval, '60');
        syncServerSettings();
    }

    function disableLegacyForcePolling() {
        try {
            if (!Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return;
            Lampa.Listener.follow('request_before', function (event) {
                var params = event && event.params;
                if (!params || typeof params.url !== 'string') return;
                if (params.url.indexOf('/translationsub/updates') === -1) return;
                params.url = params.url.replace(/([?&])force=true(?=(&|$))/i, '$1force=false');
            });
        } catch (e) {}
    }

    function manualCheck(done) {
        done = typeof done === 'function' ? done : function () {};
        var sources = enabledSources();
        if (!sources.length) {
            notify('Включите хотя бы один балансер в настройках');
            done([]);
            return;
        }

        notify('Проверяю новые серии…');
        var checkPath = '/translationsub/check?userKey=' + encodeURIComponent(userKey()) + '&sources=' + encodeURIComponent(sources.join(','));
        request('GET', checkPath, null, function () {
            var updatesPath = '/translationsub/updates?userKey=' + encodeURIComponent(userKey()) + '&force=false';
            request('GET', updatesPath, null, function (updates) {
                updates = Array.isArray(updates) ? updates : [];
                notify(updates.length ? ('С новыми сериями: ' + updates.length) : 'Новых серий нет');
                try {
                    if (window.TranslationSub && typeof window.TranslationSub.checkUpdates === 'function')
                        window.TranslationSub.checkUpdates();
                    if (window.TranslationSubNotice && typeof window.TranslationSubNotice.refresh === 'function')
                        window.TranslationSubNotice.refresh();
                } catch (e) {}
                done(updates);
            }, function () { done([]); });
        }, function () {
            notify('Не удалось проверить новые серии');
            done([]);
        });
    }

    function exposeManualCheck() {
        try {
            if (window.TranslationSub)
                window.TranslationSub.forceCheckUpdatesUI = manualCheck;
        } catch (e) {}
    }

    function injectStyles() {
        if (document.getElementById('translationsub-settings-v2-style')) return;
        var style = document.createElement('style');
        style.id = 'translationsub-settings-v2-style';
        style.textContent =
            '.settings-folder[data-component="' + BALANCERS + '"]{display:none!important}' +
            '.settings-folder[data-component="' + ROOT + '"] .translationsub-settings-bell{width:1.2em;height:1.2em;display:block;color:#fff!important;fill:none!important}' +
            '.settings-folder[data-component="' + ROOT + '"] .translationsub-settings-bell path{stroke:#fff!important;fill:none!important}' +
            '.settings-folder[data-component="' + ROOT + '"].focus .translationsub-settings-bell path{stroke:#111!important}';
        (document.head || document.documentElement).appendChild(style);
    }

    function start() {
        if (!window.Lampa) return;
        injectStyles();
        disableLegacyForcePolling();
        rebuildSettings();
        exposeManualCheck();

        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') {
                        rebuildSettings();
                        exposeManualCheck();
                        syncServerSettings();
                    }
                });
            }
        } catch (e) {}
    }

    if (window.Lampa) start();
    else {
        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (window.Lampa) {
                clearInterval(wait);
                start();
            } else if (attempts > 80) clearInterval(wait);
        }, 250);
    }
})();
