(function () {
    'use strict';

    if (window.__TranslationSubBadgeStateStarted) return;
    window.__TranslationSubBadgeStateStarted = true;

    var state = {
        count: 0,
        updates: [],
        requestSeq: 0,
        appliedSeq: 0,
        bindTimer: null,
        refreshTimer: null,
        observer: null,
        wrappedNotice: false,
        wrappedPlugin: false,
        drawerOpening: false
    };

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

    function userKey() {
        return String(storageGet('client_uid', '') || lampacUid() || 'local');
    }

    function accountEmail() {
        var account = storageGet('account', {});
        if (typeof account === 'string') {
            try { account = JSON.parse(account || '{}'); } catch (e) { account = {}; }
        }
        return String(account && account.email || '');
    }

    function profileId() {
        return String(storageGet('lampac_profile_id', '') || '');
    }

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            return window.location.origin || '';
        } catch (e) {
            return '';
        }
    }

    function addQuery(parts, name, value) {
        if (value === null || value === undefined || value === '') return;
        parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
    }

    function updatesUrl() {
        var parts = [];
        addQuery(parts, 'userKey', userKey());
        addQuery(parts, 'uid', lampacUid());
        addQuery(parts, 'account_email', accountEmail());
        addQuery(parts, 'profile_id', profileId());
        addQuery(parts, '_ts', Date.now ? Date.now() : new Date().getTime());
        return host() + '/translationsub/updates?' + parts.join('&');
    }

    function injectStyles() {
        if (document.getElementById('translationsub-badge-state-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-badge-state-style';
        style.textContent =
            '.translationsub-head>.translationsub-badge{display:none!important}' +
            '.translationsub-menu-item>.translationsub-menu-badge{display:none!important}' +
            '.translationsub-state-badge{' +
                'position:absolute;right:-.25em;top:-.25em;min-width:1.5em;height:1.5em;padding:0 .3em;' +
                'border-radius:1em;background:#e53935;color:#fff;font-size:.7em;font-weight:600;' +
                'display:flex;align-items:center;justify-content:center;box-sizing:border-box;pointer-events:none;' +
            '}' +
            '.translationsub-state-menu-badge{' +
                'margin-left:auto;min-width:1.65em;height:1.65em;padding:0 .38em;border-radius:1em;' +
                'background:#e45e2c;color:#fff;font-size:.7em;font-weight:700;display:flex;' +
                'align-items:center;justify-content:center;box-sizing:border-box;pointer-events:none;' +
            '}';

        (document.head || document.documentElement).appendChild(style);
    }

    function textCount(count) {
        count = Number(count) || 0;
        return count > 99 ? '99+' : String(count);
    }

    function openDrawerSynced() {
        if (state.drawerOpening) return;
        state.drawerOpening = true;

        function open() {
            state.drawerOpening = false;
            refresh();

            try {
                if (window.TranslationSubNotice && typeof window.TranslationSubNotice.open === 'function') {
                    window.TranslationSubNotice.open();
                    return;
                }
            } catch (e) {}

            try {
                if (window.TranslationSub && typeof window.TranslationSub.openSubscriptions === 'function')
                    window.TranslationSub.openSubscriptions();
            } catch (e2) {}
        }

        try {
            if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function') {
                // The drawer must be built only after Lampac TimeCode has been
                // reconciled into TranslationSub. Otherwise the bell and drawer can
                // observe two different moments of watched progress.
                window.TranslationSubWatch.sync(open);
                return;
            }
        } catch (e3) {}

        open();
    }

    function applyCount() {
        if (typeof $ !== 'function') return;
        var count = Number(state.count) || 0;

        $('.translationsub-head').each(function () {
            var head = $(this);
            var badge = head.children('.translationsub-state-badge').first();

            if (!badge.length && count > 0) {
                badge = $('<div class="translationsub-state-badge"></div>');
                head.append(badge);
            }

            if (badge.length) {
                if (count > 0) badge.text(textCount(count)).show();
                else badge.hide();
            }

            // Take ownership of the TranslationSub bell. Notice's own binder checks
            // this marker, so setting it prevents a later DOM pass from replacing
            // our TimeCode-synchronized handler.
            head.attr('data-translationsub-notice-bound', '1');
            head.off('hover:enter.translationsubNotice');
            head.off('hover:enter.translationsubBadgeState');
            head.on('hover:enter.translationsubBadgeState', openDrawerSynced);
        });

        $('.translationsub-menu-item').each(function () {
            var item = $(this);
            var badge = item.children('.translationsub-state-menu-badge').first();

            if (!badge.length && count > 0) {
                badge = $('<div class="translationsub-state-menu-badge"></div>');
                item.append(badge);
            }

            if (badge.length) {
                if (count > 0) badge.text(textCount(count)).show();
                else badge.hide();
            }
        });
    }

    function scheduleApply() {
        clearTimeout(state.bindTimer);
        state.bindTimer = setTimeout(function () {
            injectStyles();
            applyCount();
            patchIntegrations();
        }, 30);
    }

    function refresh() {
        var seq = ++state.requestSeq;
        var url = updatesUrl();

        function success(updates) {
            // Only the newest request may alter visible state. A slower response
            // can never resurrect a notification already removed by TimeCode sync.
            if (seq !== state.requestSeq) return;

            updates = Array.isArray(updates) ? updates : [];
            state.appliedSeq = seq;
            state.updates = updates;
            state.count = updates.length;
            applyCount();
        }

        function fail() {
            if (seq !== state.requestSeq) return;
            applyCount();
        }

        if (typeof fetch === 'function') {
            fetch(url, { method: 'GET', cache: 'no-store' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    var data = [];
                    try { data = text ? JSON.parse(text) : []; } catch (e) { data = []; }
                    success(data);
                })
                .catch(fail);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    var data = [];
                    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : []; } catch (e) { data = []; }
                    success(data);
                } else fail();
            };
            xhr.send(null);
        } catch (e2) {
            fail();
        }
    }

    function patchNotice() {
        if (state.wrappedNotice || !window.TranslationSubNotice) return;

        var notice = window.TranslationSubNotice;
        var originalRefresh = typeof notice.refresh === 'function' ? notice.refresh : null;

        if (originalRefresh) {
            notice.refresh = function () {
                var result = originalRefresh.apply(notice, arguments);
                refresh(true);
                return result;
            };
        }

        state.wrappedNotice = true;
    }

    function patchPlugin() {
        if (state.wrappedPlugin || !window.TranslationSub) return;

        var plugin = window.TranslationSub;

        if (typeof plugin.checkUpdates === 'function') {
            var originalCheck = plugin.checkUpdates;
            plugin.checkUpdates = function () {
                var result = originalCheck.apply(plugin, arguments);
                setTimeout(function () { refresh(true); }, 80);
                return result;
            };
        }

        if (typeof plugin.forceCheckUpdatesUI === 'function') {
            var originalForce = plugin.forceCheckUpdatesUI;
            plugin.forceCheckUpdatesUI = function (done) {
                return originalForce.call(plugin, function (updates) {
                    refresh(true);
                    if (typeof done === 'function') done(updates);
                });
            };
        }

        state.wrappedPlugin = true;
    }

    function patchIntegrations() {
        patchNotice();
        patchPlugin();
    }

    function bindLampa() {
        try {
            if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (!event || event.type !== 'ready') return;
                    scheduleApply();
                    refresh(true);
                });
            }
        } catch (e) {}

        try {
            if (window.Lampa && Lampa.Timeline && Lampa.Timeline.listener &&
                typeof Lampa.Timeline.listener.follow === 'function') {
                // TimeCode plugin writes the same Timeline update to SQLite. The watch
                // bridge performs the delayed reconciliation; this refresh is only a
                // second safety net for the visible counter.
                Lampa.Timeline.listener.follow('update', function () {
                    setTimeout(function () { refresh(true); }, 4800);
                });
            }
        } catch (e2) {}
    }

    function start() {
        injectStyles();
        patchIntegrations();
        bindLampa();
        scheduleApply();
        refresh(true);

        try {
            state.observer = new MutationObserver(function () {
                // Lampa recreates head/menu between activities. Reapply only the last
                // server-confirmed count; do not restore legacy state.updates.
                scheduleApply();
            });
            state.observer.observe(document.body || document.documentElement, {
                childList: true,
                subtree: true
            });
        } catch (e) {}

        if (state.refreshTimer) clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(function () { refresh(true); }, 60 * 1000);

        try {
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) refresh(true);
            });
        } catch (e2) {}

        window.TranslationSubBadgeState = {
            refresh: refresh,
            open: openDrawerSynced,
            count: function () { return state.count; },
            updates: function () { return state.updates.slice(); }
        };
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
