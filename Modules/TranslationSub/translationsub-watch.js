(function () {
    'use strict';

    if (window.__TranslationSubWatchStarted) return;
    window.__TranslationSubWatchStarted = true;

    var FALLBACK_SYNC_INTERVAL = 5 * 60 * 1000;
    var syncTimer = null;
    var debounceTimer = null;
    var retryTimer = null;
    var syncing = false;
    var queued = false;
    var callbacks = [];

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
        try { localStorage.setItem(name, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e2) {}
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

    function addParam(parts, name, value) {
        if (value === null || value === undefined || value === '') return;
        parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
    }

    function identityQuery() {
        var parts = [];
        addParam(parts, 'userKey', userKey());
        addParam(parts, 'uid', lampacUid());
        addParam(parts, 'account_email', accountEmail());
        addParam(parts, 'profile_id', profileId());
        addParam(parts, '_ts', Date.now ? Date.now() : new Date().getTime());
        return parts.join('&');
    }

    function request(path, success, error) {
        success = success || function () {};
        error = error || function () {};
        var url = host() + path;

        if (typeof fetch === 'function') {
            fetch(url, { method: 'GET', cache: 'no-store' })
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
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) success({});
                else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(null);
        } catch (e2) {
            error(e2);
        }
    }

    function flushCallbacks() {
        var pending = callbacks.splice(0, callbacks.length);
        pending.forEach(function (callback) {
            try { callback(); } catch (e) {}
        });
    }

    function refreshVisibleState() {
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function')
                window.TranslationSubBadgeState.refresh();
        } catch (e) {}
    }

    function finish() {
        syncing = false;
        refreshVisibleState();
        flushCallbacks();

        if (queued) {
            queued = false;
            scheduleSync(350, false);
        }
    }

    function syncAll(done) {
        if (typeof done === 'function') callbacks.push(done);

        if (syncing) {
            queued = true;
            return;
        }

        syncing = true;
        request('/translationsub/progress?' + identityQuery(), finish, function () {
            syncing = false;
            flushCallbacks();
            if (queued) {
                queued = false;
                scheduleSync(700, false);
            }
        });
    }

    function scheduleSync(delay, withRetry) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(syncAll, typeof delay === 'number' ? delay : 1400);

        if (withRetry !== false) {
            clearTimeout(retryTimer);
            retryTimer = setTimeout(function () {
                // TimeCode пишет SQLite асинхронно после Timeline.update. Повторная
                // сверка закрывает окно, когда первый запрос пришёл раньше commit.
                syncAll();
            }, 4200);
        }
    }

    function bindTimeline() {
        try {
            if (Lampa.Timeline && Lampa.Timeline.listener && typeof Lampa.Timeline.listener.follow === 'function') {
                Lampa.Timeline.listener.follow('update', function () {
                    scheduleSync(1400, true);
                });
            }
        } catch (e) {}

        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('state:changed', function (event) {
                    if (event && event.target === 'timeline') scheduleSync(1600, true);
                });

                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') scheduleSync(2200, false);
                });
            }
        } catch (e2) {}
    }

    function start() {
        if (!window.Lampa) return;

        bindTimeline();
        scheduleSync(3000, false);

        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(syncAll, FALLBACK_SYNC_INTERVAL);

        window.TranslationSubWatch = {
            sync: syncAll,
            watchedPercent: 60,
            source: 'lampac-timecode'
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
