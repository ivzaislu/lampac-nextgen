(function () {
    'use strict';

    if (window.__TranslationSubApiStarted) return;
    window.__TranslationSubApiStarted = true;

    var REQUEST_TIMEOUT = 30000;

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

    function uid() {
        var value = String(storageGet('lampac_unic_id', '') || '');
        if (value) return value;

        try {
            if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.uid === 'function')
                value = String(Lampa.Utils.uid(8) || '').toLowerCase();
        } catch (e) {}
        if (!value) value = Math.random().toString(36).slice(2, 10).toLowerCase();

        storageSet('lampac_unic_id', value);
        return value;
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
                var isPlugin = src.indexOf('/translationsub.js') !== -1 || src.indexOf('/translationsub/plugin.js') !== -1;
                if (isPlugin && typeof URL === 'function')
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
            var settled = false;
            var controller = typeof AbortController === 'function' ? new AbortController() : null;
            if (controller) options.signal = controller.signal;

            var timeout = setTimeout(function () {
                if (settled) return;
                if (controller) {
                    try { controller.abort(); } catch (e) {}
                }
                settled = true;
                error(new Error('Request timeout'));
            }, REQUEST_TIMEOUT);

            fetch(url, options)
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    success(parseJson(text, {}));
                })
                .catch(function (reason) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    error(reason);
                });
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            var xhrSettled = false;

            function xhrSuccess(data) {
                if (xhrSettled) return;
                xhrSettled = true;
                success(data);
            }

            function xhrError(reason) {
                if (xhrSettled) return;
                xhrSettled = true;
                error(reason);
            }

            xhr.open(method, url, true);
            xhr.timeout = REQUEST_TIMEOUT;
            xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || xhrSettled) return;
                if (xhr.status >= 200 && xhr.status < 300)
                    xhrSuccess(parseJson(xhr.responseText, {}));
                else
                    xhrError(new Error('HTTP ' + xhr.status));
            };
            xhr.onerror = function () { xhrError(new Error('Network error')); };
            xhr.ontimeout = function () { xhrError(new Error('Request timeout')); };
            xhr.send(options.body || null);
        } catch (e2) { error(e2); }
    }

    function snapshot(success, error) {
        request('GET', '/translationsub/v2/snapshot', {
            profile_id: profileId(),
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
        request('POST', '/translationsub/v2/subscriptions', { profile_id: profileId() }, {
            card: card || {},
            voiceId: String(voiceId || ''),
            voiceName: String(voiceName || '')
        }, success, error);
    }

    function unsubscribe(subscriptionId, success, error) {
        var id = encodeURIComponent(String(subscriptionId || ''));
        request('POST', '/translationsub/v2/subscriptions/' + id + '/remove', { profile_id: profileId() }, {}, success, error);
    }

    function check(success, error) {
        request('POST', '/translationsub/v2/check', { profile_id: profileId() }, {}, success, error);
    }

    function settings(success, error) {
        request('GET', '/translationsub/v2/settings', {}, null, success, error);
    }

    function updateSettings(values, success, error) {
        request('POST', '/translationsub/v2/settings', {}, values || {}, success, error);
    }

    window.TranslationSubApi = {
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
