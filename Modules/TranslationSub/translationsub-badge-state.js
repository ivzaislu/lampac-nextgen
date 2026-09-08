(function () {
    'use strict';

    if (window.__TranslationSubBadgeStateStarted) return;
    window.__TranslationSubBadgeStateStarted = true;

    var state = {
        count: 0,
        updates: [],
        requestSeq: 0,
        refreshTimer: null,
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
        addQuery(parts, 'force', 'false');
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

    function render() {
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

    function refresh(done) {
        done = typeof done === 'function' ? done : function () {};
        var seq = ++state.requestSeq;
        var url = updatesUrl();

        function apply(updates) {
            if (seq !== state.requestSeq) return;
            updates = Array.isArray(updates) ? updates : [];
            state.updates = updates;
            state.count = updates.length;
            render();
            done(updates);
        }

        function fail() {
            if (seq !== state.requestSeq) return;
            render();
            done(state.updates.slice());
        }

        if (typeof fetch === 'function') {
            fetch(url, { method: 'GET', cache: 'no-store' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    var data = [];
                    try { data = text ? JSON.parse(text) : []; } catch (e) {}
                    apply(data);
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
                    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : []; } catch (e) {}
                    apply(data);
                } else fail();
            };
            xhr.send(null);
        } catch (e2) {
            fail();
        }
    }

    function openDrawerSynced() {
        if (state.drawerOpening) return;
        state.drawerOpening = true;

        function openAfterRefresh() {
            refresh(function () {
                state.drawerOpening = false;
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
            });
        }

        try {
            if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function') {
                window.TranslationSubWatch.sync(openAfterRefresh);
                return;
            }
        } catch (e3) {}

        openAfterRefresh();
    }

    function bindLampa() {
        try {
            if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (!event || event.type !== 'ready') return;
                    render();
                    refresh();
                });
            }
        } catch (e) {}
    }

    function start() {
        injectStyles();
        bindLampa();
        refresh();

        if (state.refreshTimer) clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(refresh, 60 * 1000);

        try {
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) refresh();
            });
        } catch (e) {}

        window.TranslationSubBadgeState = {
            refresh: refresh,
            render: render,
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
