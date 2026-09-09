(function () {
    'use strict';

    if (window.__TranslationSubPluginStarted) return;
    window.__TranslationSubPluginStarted = true;

    var META = {
        component: 'translationsub',
        name: 'Подписки на озвучки',
        version: '3.0.0',
        description: 'Подписки на озвучки и уведомления о новых сериях',
        type: 'other'
    };

    var API = {
        updates: '/translationsub/updates',
        check: '/translationsub/check',
        settings: '/translationsub/user-settings'
    };
    var SOURCES_KEY = 'translationsub_sources';
    var state = { started: false };

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[TranslationSub]');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function detectHost() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            var scripts = document.getElementsByTagName('script');
            for (var i = scripts.length - 1; i >= 0; i--) {
                var src = scripts[i].src || '';
                if (src.indexOf('/translationsub.js') !== -1 && typeof URL === 'function')
                    return new URL(src, window.location.href).origin;
            }
        } catch (e) {}
        try { return window.location.origin || ''; } catch (e2) { return ''; }
    }

    var HOST = detectHost();

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

    function enabledSources() {
        return sourceList(storageGet(SOURCES_KEY, []));
    }

    function lampacUid() {
        var uid = String(storageGet('lampac_unic_id', '') || '');
        if (uid) return uid;
        try {
            if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.uid === 'function')
                uid = String(Lampa.Utils.uid(8) || '').toLowerCase();
        } catch (e) {}
        if (!uid) uid = Math.random().toString(36).slice(2, 10).toLowerCase();
        storageSet('lampac_unic_id', uid);
        return uid;
    }

    function userKey() {
        return String(storageGet('client_uid', '') || lampacUid() || 'local');
    }

    function query(params) {
        var parts = [];
        params = params || {};
        Object.keys(params).forEach(function (key) {
            var value = params[key];
            if (value === null || value === undefined || value === '') return;
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
        });
        return parts.join('&');
    }

    function parseJson(value, fallback) {
        if (value === null || value === undefined || value === '') return fallback;
        if (typeof value === 'object') return value;
        try { return JSON.parse(value); } catch (e) { return fallback; }
    }

    function request(method, path, params, success, error) {
        success = success || function () {};
        error = error || function () {};
        var qs = query(params);
        var url = HOST + path + (qs ? (path.indexOf('?') === -1 ? '?' : '&') + qs : '');

        if (typeof fetch === 'function') {
            fetch(url, { method: method, cache: 'no-store' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) { success(parseJson(text, {})); })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) success(parseJson(xhr.responseText, {}));
                else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(null);
        } catch (e) { error(e); }
    }

    function refreshSourceSelection(done) {
        done = typeof done === 'function' ? done : function () {};
        request('GET', API.settings, { userKey: userKey(), uid: lampacUid() }, function (settings) {
            var sources = sourceList(settings && (settings.Sources || settings.sources));
            storageSet(SOURCES_KEY, sources);
            done(sources, settings || {});
        }, function () { done(enabledSources(), {}); });
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(text);
                return;
            }
        } catch (e) {}
        log(text);
    }

    function bellSvg() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.4 2.4 0 0 0 2.35-2h-4.7A2.4 2.4 0 0 0 12 22Zm7-5-2-2v-5a5 5 0 0 0-4-4.9V4a1 1 0 0 0-2 0v1.1A5 5 0 0 0 7 10v5l-2 2v1h14v-1Z"/></svg>';
    }

    function registerManifest() {
        try {
            if (!Lampa.Manifest) Lampa.Manifest = {};
            var plugins = Lampa.Manifest.plugins;
            if (Array.isArray(plugins)) {
                if (!plugins.some(function (plugin) { return plugin && plugin.component === META.component; })) plugins.push(META);
                return;
            }
            if (!plugins || typeof plugins !== 'object') plugins = Lampa.Manifest.plugins = {};
            plugins[META.component] = META;
        } catch (e) { log('manifest registration failed', e); }
    }

    function injectStyles() {
        if (document.getElementById('translationsub-core-style')) return;
        var style = document.createElement('style');
        style.id = 'translationsub-core-style';
        style.textContent = '.translationsub-head{position:relative;display:flex;align-items:center;justify-content:center}' +
            '.translationsub-head>svg{width:1.8em;height:1.8em;display:block;fill:currentColor;flex:0 0 auto}';
        (document.head || document.documentElement).appendChild(style);
    }

    function openSubscriptionsPage() {
        if (!window.Lampa || !Lampa.Activity || typeof Lampa.Activity.push !== 'function') return;
        Lampa.Activity.push({ url: '', title: META.name, component: 'translationsub_list', page: 1 });
    }

    function openNoticeOrPage() {
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.open === 'function') {
                window.TranslationSubBadgeState.open();
                return;
            }
        } catch (e) {}
        try {
            if (window.TranslationSubNotice && typeof window.TranslationSubNotice.open === 'function') {
                window.TranslationSubNotice.open();
                return;
            }
        } catch (e2) {}
        openSubscriptionsPage();
    }

    function injectHeadButton() {
        if (typeof $ !== 'function') return;
        var row = $('.head__actions').first();
        if (!row.length) return;
        var button = row.find('.translationsub-head').first();
        if (!button.length) {
            button = $('<div class="head__action selector translationsub-head" title="Уведомления озвучек">' + bellSvg() + '</div>');
            row.append(button);
        }
        button.off('hover:enter.translationsubCore');
        button.on('hover:enter.translationsubCore', openNoticeOrPage);
    }

    function refreshUpdates(done) {
        done = typeof done === 'function' ? done : function () {};
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function') {
                window.TranslationSubBadgeState.refresh(done);
                return;
            }
        } catch (e) {}

        request('GET', API.updates, { userKey: userKey(), force: 'false' }, function (updates) {
            done(Array.isArray(updates) ? updates : []);
        }, function () { done([]); });
    }

    function forceCheckUpdatesUI(done) {
        done = typeof done === 'function' ? done : function () {};
        refreshSourceSelection(function (sources) {
            if (!sources.length) {
                notify('Выберите хотя бы один балансер в настройках');
                done([]);
                return;
            }

            notify('Проверяю новые серии…');
            request('GET', API.check, { userKey: userKey(), sources: sources.join(',') }, function () {
                refreshUpdates(function (updates) {
                    notify(updates.length ? ('С новыми сериями: ' + updates.length) : 'Новых серий нет');
                    done(updates);
                });
            }, function () {
                notify('Не удалось проверить новые серии');
                done([]);
            });
        });
    }

    function cardFlow() {
        try { return window.TranslationSub && window.TranslationSub.cardFlow ? window.TranslationSub.cardFlow : null; }
        catch (e) { return null; }
    }

    function openForItem(object) {
        var flow = cardFlow();
        if (flow && typeof flow.open === 'function') {
            flow.open(object);
            return;
        }
        notify('Модуль озвучек ещё инициализируется');
    }

    function refresh() {
        injectHeadButton();
        refreshUpdates();
        var flow = cardFlow();
        if (flow && typeof flow.refreshButton === 'function') flow.refreshButton();
    }

    function bindLampa() {
        if (!Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return;
        Lampa.Listener.follow('app', function (event) {
            if (!event || event.type !== 'ready') return;
            injectHeadButton();
            refreshSourceSelection();
            refreshUpdates();
        });
    }

    function start() {
        if (state.started || !window.Lampa) return;
        state.started = true;
        registerManifest();
        injectStyles();
        injectHeadButton();
        bindLampa();
        refreshSourceSelection();

        window.TranslationSub = {
            version: META.version,
            openForItem: openForItem,
            openSubscriptions: openSubscriptionsPage,
            checkUpdates: refreshUpdates,
            forceCheckUpdatesUI: forceCheckUpdatesUI,
            refresh: refresh,
            enabledSources: enabledSources,
            refreshSources: refreshSourceSelection
        };

        log('plugin core started', META.version, HOST);
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
                log('Lampa not found');
            }
        }, 250);
    }
})();
