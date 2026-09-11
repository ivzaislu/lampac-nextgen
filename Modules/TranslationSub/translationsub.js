(function () {
    'use strict';

    if (window.__TranslationSubPluginStarted) return;
    window.__TranslationSubPluginStarted = true;

    var META = {
        component: 'translationsub',
        name: 'Подписки на озвучки',
        version: '4.0.0-backend-first',
        description: 'Подписки на озвучки и уведомления о новых сериях',
        type: 'other'
    };
    var state = { started: false };

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[TranslationSub]');
            console.log.apply(console, args);
        } catch (e) {}
    }

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

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(text);
                return;
            }
        } catch (e) {}
        log(text);
    }

    // Geometry belongs to translationsub-bell-theme.js. Other layers only
    // provide a stable SVG anchor for the canonical mask.
    function bellSvg() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"></svg>';
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
        style.textContent = '.translationsub-head{position:relative;display:flex;align-items:center;justify-content:center}';
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
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.render === 'function')
                window.TranslationSubBadgeState.render();
        } catch (e) {}
        var flow = cardFlow();
        if (flow && typeof flow.refreshButton === 'function') flow.refreshButton();
    }

    function bindLampa() {
        if (!Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return;
        Lampa.Listener.follow('app', function (event) {
            if (!event || event.type !== 'ready') return;
            injectHeadButton();
        });
    }

    function start() {
        if (state.started || !window.Lampa) return;
        state.started = true;
        registerManifest();
        injectStyles();
        injectHeadButton();
        bindLampa();

        window.TranslationSub = {
            version: META.version,
            uid: lampacUid,
            openForItem: openForItem,
            openSubscriptions: openSubscriptionsPage,
            refresh: refresh
        };

        log('plugin core started', META.version);
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
