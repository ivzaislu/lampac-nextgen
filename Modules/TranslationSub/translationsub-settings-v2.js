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
        cardSource: 'translationsub_card_source',
        smartTmdb: 'translationsub_tmdb_schedule',
        tmdbRefreshHours: 'translationsub_tmdb_refresh_hours',
        endedRefreshDays: 'translationsub_tmdb_ended_days',
        newSeasonMode: 'translationsub_new_season_mode'
    };

    var added = false;

    function storageGet(name, fallback) {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function')
                return Lampa.Storage.get(name, fallback);
        } catch (e) {}

        try {
            var value = localStorage.getItem(name);
            return value === null ? fallback : value;
        } catch (e2) {
            return fallback;
        }
    }

    function settingBool(name, fallback) {
        var value = storageGet(name, fallback);
        if (value === true || value === 1 || value === '1' || value === 'true') return true;
        if (value === false || value === 0 || value === '0' || value === 'false') return false;
        return !!fallback;
    }

    function intSetting(name, fallback, min, max) {
        var value = parseInt(storageGet(name, String(fallback)), 10);
        if (isNaN(value)) value = fallback;
        return Math.max(min, Math.min(max, value));
    }

    function userKey() {
        return String(storageGet('client_uid', '') || storageGet('lampac_unic_id', '') || 'local');
    }

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            return window.location.origin || '';
        } catch (e) {
            return '';
        }
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function')
                Lampa.Noty.show(text);
        } catch (e) {}
    }

    function request(method, path, body, success, error) {
        success = success || function () {};
        error = error || function () {};
        var url = host() + path;
        var options = {
            method: method,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            cache: 'no-store'
        };
        if (body && method !== 'GET') options.body = JSON.stringify(body);

        if (typeof fetch === 'function') {
            fetch(url, options)
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    var data = {};
                    try { data = text ? JSON.parse(text) : {}; } catch (e) {}
                    success(data);
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
                    var data = {};
                    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (e) {}
                    success(data);
                } else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(body && method !== 'GET' ? JSON.stringify(body) : null);
        } catch (e2) {
            error(e2);
        }
    }

    function enabledSources() {
        var result = [];
        if (settingBool(KEYS.flixcdn, true)) result.push('flixcdn');
        if (settingBool(KEYS.phantom, true)) result.push('phantom');
        if (settingBool(KEYS.zetflixdb, true)) result.push('zetflixdb');
        if (settingBool(KEYS.videohub, true)) result.push('cdnvideohub');
        return result;
    }

    function newSeasonMode() {
        var value = String(storageGet(KEYS.newSeasonMode, 'auto') || 'auto').toLowerCase();
        return ['auto', 'notify', 'off'].indexOf(value) >= 0 ? value : 'auto';
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

    function syncServerSettings() {
        request('POST', '/translationsub/user-settings', {
            userKey: userKey(),
            checkIntervalHours: intSetting(KEYS.interval, 1, 1, 24),
            sources: enabledSources(),
            useTmdbSchedule: settingBool(KEYS.smartTmdb, true),
            tmdbRefreshHours: intSetting(KEYS.tmdbRefreshHours, 24, 6, 168),
            endedRefreshDays: intSetting(KEYS.endedRefreshDays, 7, 1, 90),
            newSeasonMode: newSeasonMode()
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
        if (added || !window.Lampa || !Lampa.SettingsApi) return;
        added = true;

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
                description: 'Выбрать источники, которые участвуют в поиске озвучек и проверке новых серий'
            },
            onChange: openBalancersSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: KEYS.interval, type: 'select', values: hourValues(), 'default': '1' },
            field: {
                name: 'Интервал активного опроса',
                description: 'Как часто опрашивать балансеры, когда TMDB сообщает, что уже вышла серия, которой ещё нет в озвучке.'
            },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: { name: KEYS.smartTmdb, type: 'trigger', values: '', 'default': true },
            field: {
                name: 'Умное расписание TMDB',
                description: 'Ждать фактического выхода серии или нового сезона по TMDB и не опрашивать балансеры без причины.'
            },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: {
                name: KEYS.tmdbRefreshHours,
                type: 'select',
                values: {
                    '6': '6 часов',
                    '12': '12 часов',
                    '24': '24 часа',
                    '48': '2 дня',
                    '72': '3 дня',
                    '168': '7 дней'
                },
                'default': '24'
            },
            field: {
                name: 'Обновление расписания TMDB',
                description: 'Как часто перепроверять активные сериалы, если дата выхода изменилась или ещё не объявлена.'
            },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: {
                name: KEYS.endedRefreshDays,
                type: 'select',
                values: {
                    '7': '7 дней',
                    '14': '14 дней',
                    '30': '30 дней',
                    '60': '60 дней'
                },
                'default': '7'
            },
            field: {
                name: 'Перепроверка завершённых сериалов',
                description: 'Балансеры спят, а TMDB изредка проверяется снова, чтобы поймать неожиданное продолжение.'
            },
            onChange: syncServerSettings
        });

        Lampa.SettingsApi.addParam({
            component: ROOT,
            param: {
                name: KEYS.newSeasonMode,
                type: 'select',
                values: {
                    auto: 'Автоматически продолжать',
                    notify: 'Только показать новый сезон',
                    off: 'Не отслеживать новые сезоны'
                },
                'default': 'auto'
            },
            field: {
                name: 'Когда начинается новый сезон',
                description: 'Авто: создать подписку на ту же озвучку для нового сезона, не удаляя прогресс старого.'
            },
            onChange: syncServerSettings
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

        syncServerSettings();
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
        request('GET', '/translationsub/check?userKey=' + encodeURIComponent(userKey()) + '&sources=' + encodeURIComponent(sources.join(',')), null, function () {
            function finish(updates) {
                updates = Array.isArray(updates) ? updates : [];
                notify(updates.length ? ('С новыми сериями: ' + updates.length) : 'Новых серий нет');
                done(updates);
            }

            try {
                if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function') {
                    window.TranslationSubBadgeState.refresh(finish);
                    return;
                }
            } catch (e) {}

            request('GET', '/translationsub/updates?userKey=' + encodeURIComponent(userKey()) + '&force=false', null, finish, function () { done([]); });
        }, function () {
            notify('Не удалось проверить новые серии');
            done([]);
        });
    }

    function exposeManualCheck() {
        try {
            if (window.TranslationSub) window.TranslationSub.forceCheckUpdatesUI = manualCheck;
        } catch (e) {}
    }

    function injectStyles() {
        if (document.getElementById('translationsub-settings-v2-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-settings-v2-style';
        style.textContent =
            '.settings-folder[data-component="' + BALANCERS + '"]{display:none!important}' +
            '.settings-folder[data-component="' + ROOT + '"] .translationsub-settings-bell{' +
                'width:2em!important;height:2em!important;display:block!important;overflow:visible!important;' +
                'fill:none!important;color:inherit!important;' +
            '}' +
            '.settings-folder[data-component="' + ROOT + '"] .translationsub-settings-bell path{' +
                'fill:none!important;stroke:currentColor!important;' +
            '}';
        (document.head || document.documentElement).appendChild(style);
    }

    function start() {
        if (!window.Lampa) return;
        injectStyles();
        rebuildSettings();
        exposeManualCheck();

        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (!event || event.type !== 'ready') return;
                    exposeManualCheck();
                    syncServerSettings();
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
            } else if (attempts > 80) {
                clearInterval(wait);
            }
        }, 250);
    }
})();
