(function () {
    'use strict';

    if (window.__TranslationSubWatchStarted) return;
    window.__TranslationSubWatchStarted = true;

    var WATCHED_PERCENT = 60;
    var MAX_EPISODES_SCAN = 250;
    var SYNC_INTERVAL = 60 * 1000;
    var syncTimer = null;
    var debounceTimer = null;
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

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            return window.location.origin || '';
        } catch (e) { return ''; }
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

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(text);
                return;
            }
        } catch (e) {}
        try { console.log('[TranslationSub]', text); } catch (e2) {}
    }

    function value(item, pascal, camel, fallback) {
        if (!item) return fallback;
        if (item[pascal] !== undefined && item[pascal] !== null) return item[pascal];
        if (item[camel] !== undefined && item[camel] !== null) return item[camel];
        return fallback;
    }

    function timelineAvailable() {
        return !!(window.Lampa && Lampa.Timeline && typeof Lampa.Timeline.watchedEpisode === 'function');
    }

    function titleCandidates(item) {
        var names = [];
        var original = String(value(item, 'OriginalTitle', 'originalTitle', '') || '').trim();
        var title = String(value(item, 'Title', 'title', '') || '').trim();
        if (original) names.push(original);
        if (title && names.indexOf(title) === -1) names.push(title);
        return names;
    }

    function episodePercent(names, season, episode) {
        var percent = 0;
        names.forEach(function (name) {
            try {
                var card = { original_name: name, original_title: name };
                var current = Number(Lampa.Timeline.watchedEpisode(card, season, episode) || 0);
                if (current > percent) percent = current;
            } catch (e) {}
        });
        return percent;
    }

    function groupInfo(group) {
        if (!group.length || !timelineAvailable()) return { watched: 0, previous: 0 };

        var first = group[0];
        var season = Number(value(first, 'CurrentSeason', 'currentSeason', 1) || 1);
        var names = titleCandidates(first);
        if (!names.length || season <= 0) return { watched: 0, previous: 0 };

        var available = 0;
        var previous = 0;
        group.forEach(function (item) {
            available = Math.max(available, Number(value(item, 'LastEpisode', 'lastEpisode', 0) || 0));
            previous = Math.max(previous, Number(value(item, 'CurrentEpisode', 'currentEpisode', 0) || 0));
        });

        var scanTo = Math.min(MAX_EPISODES_SCAN, Math.max(32, available + 8, previous + 8));
        var watched = 0;
        for (var episode = 1; episode <= scanTo; episode++) {
            if (episodePercent(names, season, episode) >= WATCHED_PERCENT) watched = episode;
        }

        return { watched: watched, previous: previous };
    }

    function groupSubscriptions(list) {
        var groups = {};
        (Array.isArray(list) ? list : []).forEach(function (item) {
            var isSerial = value(item, 'IsSerial', 'isSerial', true);
            if (isSerial === false || isSerial === 'false') return;

            var contentId = String(value(item, 'ContentId', 'contentId', '') || '');
            var season = Number(value(item, 'CurrentSeason', 'currentSeason', 1) || 1);
            if (!contentId || season <= 0) return;

            var key = contentId + '|' + season;
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });
        return groups;
    }

    function syncGroup(group, done) {
        if (!group || !group.length) {
            done(false);
            return;
        }

        var first = group[0];
        var contentId = String(value(first, 'ContentId', 'contentId', '') || '');
        var season = Number(value(first, 'CurrentSeason', 'currentSeason', 1) || 1);
        var info = groupInfo(group);

        // Не пишем JSON на сервер каждую минуту, если Timeline вообще не изменился.
        if (info.watched === info.previous) {
            done(false);
            return;
        }

        request('POST', '/translationsub/watched', {
            userKey: userKey(),
            contentId: contentId,
            season: season,
            episode: info.watched
        }, function () { done(true); }, function () { done(false); });
    }

    function loadNoticeState() {
        var state = storageGet('translationsub_watch_notices', {});
        if (state && typeof state === 'object') return state;
        try { return JSON.parse(String(state || '{}')); } catch (e) { return {}; }
    }

    function showGapNotifications(done) {
        done = typeof done === 'function' ? done : function () {};
        request('GET', '/translationsub/updates?userKey=' + encodeURIComponent(userKey()), null, function (updates) {
            updates = Array.isArray(updates) ? updates : [];
            var seen = loadNoticeState();
            var changed = false;

            updates.forEach(function (item) {
                var id = String(value(item, 'Id', 'id', '') || '');
                var title = String(value(item, 'Title', 'title', 'Сериал') || 'Сериал');
                var voice = String(value(item, 'TranslationName', 'translationName', '') || '');
                var from = Number(value(item, 'FromEpisode', 'fromEpisode', 0) || 0);
                var to = Number(value(item, 'ToEpisode', 'toEpisode', value(item, 'AvailableEpisode', 'availableEpisode', 0)) || 0);
                var count = Number(value(item, 'NewCount', 'newCount', Math.max(0, to - from + 1)) || 0);

                if (!id || !to || to <= 0 || from <= 0) return;
                if (Number(seen[id] || 0) >= to) return;

                seen[id] = to;
                changed = true;
                var range = from === to ? ('серия ' + from) : ('серии ' + from + '–' + to);
                var text = title + (voice ? ' · ' + voice : '') + ': доступны ' + range;
                if (count > 1) text += ' (' + count + ')';
                notify(text);
            });

            if (changed) storageSet('translationsub_watch_notices', seen);
            done();
        }, done);
    }

    function flushCallbacks() {
        var pending = callbacks.splice(0, callbacks.length);
        pending.forEach(function (callback) {
            try { callback(); } catch (e) {}
        });
    }

    function finishSync(changedProgress) {
        syncing = false;

        showGapNotifications(function () {
            if (changedProgress) {
                try {
                    if (window.TranslationSubNotice && typeof window.TranslationSubNotice.refresh === 'function')
                        window.TranslationSubNotice.refresh();
                } catch (e) {}
            }

            flushCallbacks();

            if (queued) {
                queued = false;
                scheduleSync(300);
            }
        });
    }

    function syncAll(done) {
        if (typeof done === 'function') callbacks.push(done);

        if (!timelineAvailable()) {
            flushCallbacks();
            return;
        }

        if (syncing) {
            queued = true;
            return;
        }

        syncing = true;
        request('GET', '/translationsub/list?userKey=' + encodeURIComponent(userKey()), null, function (list) {
            var groups = groupSubscriptions(list);
            var keys = Object.keys(groups);
            var changedProgress = false;

            if (!keys.length) {
                finishSync(false);
                return;
            }

            function next(index) {
                if (index >= keys.length) {
                    finishSync(changedProgress);
                    return;
                }

                // Последовательно: не запускаем несколько read-modify-write запросов /watched одновременно.
                syncGroup(groups[keys[index]], function (changed) {
                    if (changed) changedProgress = true;
                    next(index + 1);
                });
            }

            next(0);
        }, function () {
            syncing = false;
            flushCallbacks();
            if (queued) {
                queued = false;
                scheduleSync(500);
            }
        });
    }

    function scheduleSync(delay) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () { syncAll(); }, typeof delay === 'number' ? delay : 1200);
    }

    function bindTimeline() {
        try {
            if (Lampa.Timeline && Lampa.Timeline.listener && typeof Lampa.Timeline.listener.follow === 'function') {
                Lampa.Timeline.listener.follow('update', function () { scheduleSync(900); });
            }
        } catch (e) {}

        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('state:changed', function (event) {
                    if (event && event.target === 'timeline') scheduleSync(900);
                });
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') scheduleSync(3000);
                });
            }
        } catch (e2) {}
    }

    function start() {
        if (!window.Lampa) return;
        bindTimeline();
        scheduleSync(5000);
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(function () { syncAll(); }, SYNC_INTERVAL);

        window.TranslationSubWatch = {
            sync: syncAll,
            watchedPercent: WATCHED_PERCENT
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
            } else if (attempts > 80) clearInterval(wait);
        }, 250);
    }
})();
