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

    function createRuntime() {
        if (window.TranslationSubRuntime && typeof window.TranslationSubRuntime.onReady === 'function')
            return window.TranslationSubRuntime;

        var queue = [];
        var ready = false;
        var listenerBound = false;
        var waitTimer = null;
        var attempts = 0;

        function run(callback) {
            try { callback(); }
            catch (e) { log('module start failed', e); }
        }

        function flush() {
            if (ready || !window.Lampa || !window.appready) return false;

            ready = true;
            if (waitTimer) clearInterval(waitTimer);
            waitTimer = null;

            var callbacks = queue.splice(0);
            callbacks.forEach(run);
            return true;
        }

        function bindAppReady() {
            if (ready || listenerBound || !window.Lampa || !Lampa.Listener || typeof Lampa.Listener.follow !== 'function')
                return false;

            listenerBound = true;
            Lampa.Listener.follow('app', function (event) {
                if (event && event.type === 'ready') flush();
            });
            return true;
        }

        function waitForLampa() {
            if (ready || waitTimer || flush()) return;
            if (bindAppReady()) {
                flush();
                return;
            }

            waitTimer = setInterval(function () {
                attempts++;

                if (flush()) return;
                if (bindAppReady()) {
                    clearInterval(waitTimer);
                    waitTimer = null;
                    flush();
                    return;
                }

                if (attempts > 80) {
                    clearInterval(waitTimer);
                    waitTimer = null;
                    log('Lampa not found');
                }
            }, 250);
        }

        function onReady(callback) {
            if (typeof callback !== 'function') return;

            if (ready) {
                run(callback);
                return;
            }

            queue.push(callback);
            if (!flush()) waitForLampa();
        }

        window.TranslationSubRuntime = {
            onReady: onReady,
            isReady: function () { return ready; }
        };

        waitForLampa();
        return window.TranslationSubRuntime;
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
        registerManifest();

        window.TranslationSub = {
            openSubscriptions: openSubscriptionsPage
        };

        log('plugin core started', META.version);
    }

    createRuntime().onReady(start);
})();
