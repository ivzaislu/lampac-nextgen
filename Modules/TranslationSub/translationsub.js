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

    function openSubscriptionsPage() {
        if (!window.Lampa || !Lampa.Activity || typeof Lampa.Activity.push !== 'function') return;
        Lampa.Activity.push({ url: '', title: META.name, component: 'translationsub_list', page: 1 });
    }

    function start() {
        if (!window.Lampa) return false;
        registerManifest();

        window.TranslationSub = {
            version: META.version,
            uid: lampacUid,
            openSubscriptions: openSubscriptionsPage
        };

        log('plugin core started', META.version);
        return true;
    }

    if (!start()) {
        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (start() || attempts > 80) {
                clearInterval(wait);
                if (attempts > 80 && !window.Lampa) log('Lampa not found');
            }
        }, 250);
    }
})();
