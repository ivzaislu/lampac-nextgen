(function () {
    'use strict';

    if (window.__TranslationSubApiStarted) return;
    window.__TranslationSubApiStarted = true;

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

    function uid() {
        try {
            if (window.TranslationSub && typeof window.TranslationSub.uid === 'function')
                return String(window.TranslationSub.uid() || '');
        } catch (e) {}
        return String(storageGet('lampac_unic_id', '') || '');
    }

    function profileId() {
        return String(storageGet('lampac_profile_id', '') || '0') || '0';
    }

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            var scripts = document.getElementsByTagName('script');
            for (var i = scripts.length - 1; i >= 0; i--) {
                var src = scripts[i].src || '';
                if (src.indexOf('/translationsub.js') !== -1 && typeof URL === 'function')
                    return new URL(src, window.location.href).origin;
            }
            return window.location.origin || '';
        } catch (e) { return ''; }
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

    function request(method, path, params, body, success, error) {
        success = typeof success === 'function' ? success : function () {};
        error = typeof error === 'function' ? error : function () {};

        params = params || {};
        if (!params.uid) params.uid = uid();
        if (!params.profile_id) params.profile_id = profileId();

        var qs = query(params);
        var url = host() + path + (qs ? (path.indexOf('?') === -1 ? '?' : '&') + qs : '');
        var options = {
            method: method,
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        };
        if (body !== null && body !== undefined && method !== 'GET')
            options.body = JSON.stringify(body);

        if (typeof fetch === 'function') {
            fetch(url, options)
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
            xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300)
                    success(parseJson(xhr.responseText, {}));
                else
                    error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(options.body || null);
        } catch (e2) { error(e2); }
    }

    function snapshot(success, error) {
        request('GET', '/translationsub/v2/snapshot', {
            _ts: Date.now ? Date.now() : new Date().getTime()
        }, null, success, error);
    }

    function contentState(card, success, error) {
        request('POST', '/translationsub/v2/content-state', {}, card || {}, success, error);
    }

    function contentSummary(card, success, error) {
        request('POST', '/translationsub/v2/content-state', {}, {
            includeVoices: false,
            payload: card || {}
        }, success, error);
    }

    function subscribe(card, voiceId, voiceName, success, error) {
        request('POST', '/translationsub/v2/subscriptions', {}, {
            card: card || {},
            voiceId: String(voiceId || ''),
            voiceName: String(voiceName || '')
        }, success, error);
    }

    function unsubscribe(subscriptionId, success, error) {
        var id = encodeURIComponent(String(subscriptionId || ''));
        request('DELETE', '/translationsub/v2/subscriptions/' + id, {}, null, success, error);
    }

    function check(success, error) {
        request('GET', '/translationsub/check', {}, null, success, error);
    }

    function settings(success, error) {
        request('GET', '/translationsub/v2/settings', {}, null, success, error);
    }

    function updateSettings(values, success, error) {
        request('PUT', '/translationsub/v2/settings', {}, values || {}, success, error);
    }

    window.TranslationSubApi = {
        request: request,
        snapshot: snapshot,
        contentState: contentState,
        contentSummary: contentSummary,
        subscribe: subscribe,
        unsubscribe: unsubscribe,
        check: check,
        settings: settings,
        updateSettings: updateSettings,
        uid: uid,
        profileId: profileId,
        host: host
    };
})();
