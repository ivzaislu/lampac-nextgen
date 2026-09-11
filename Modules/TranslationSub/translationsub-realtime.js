(function () {
    'use strict';

    if (window.__TranslationSubRealtimeStarted) return;
    window.__TranslationSubRealtimeStarted = true;

    var socket = null;
    var reconnectTimer = null;
    var reconnectDelay = 2000;
    var pingTimer = null;
    var refreshTimer = null;
    var everConnected = false;

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

    function api() {
        return window.TranslationSubApi || null;
    }

    function connectionId() {
        var value = String(storageGet('translationsub_nws_id', '') || '');
        if (value) return value;

        try {
            if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.uid === 'function')
                value = String(Lampa.Utils.uid(32) || '').toLowerCase();
        } catch (e) {}
        if (!value) value = 'ts' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        value = value.replace(/[^a-z0-9_-]+/gi, '').slice(0, 64);
        storageSet('translationsub_nws_id', value);
        return value;
    }

    function websocketUrl() {
        var client = api();
        var base = client && typeof client.host === 'function' ? String(client.host() || '') : '';
        if (!base) return '';
        if (/^https:/i.test(base)) base = base.replace(/^https:/i, 'wss:');
        else if (/^http:/i.test(base)) base = base.replace(/^http:/i, 'ws:');
        else return '';
        return base + '/nws?id=' + encodeURIComponent(connectionId()) + '&ver=1';
    }

    function send(method, args) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        try {
            socket.send(JSON.stringify({ method: method, args: args || [] }));
            return true;
        } catch (e) { return false; }
    }

    function register() {
        var client = api();
        if (!client || typeof client.uid !== 'function' || typeof client.profileId !== 'function') return false;
        var uid = String(client.uid() || '');
        if (!uid) return false;
        return send('TranslationSubRegister', [uid, String(client.profileId() || '0')]);
    }

    function refreshSnapshot() {
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function')
                window.TranslationSubBadgeState.refresh();
        } catch (e) {}
    }

    function scheduleRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refreshSnapshot, 50);
    }

    function startPing() {
        stopPing();
        pingTimer = setInterval(function () {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            try { socket.send('ping'); } catch (e) {}
        }, 50000);
    }

    function stopPing() {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(30000, Math.round(reconnectDelay * 1.7));
    }

    function onMessage(event) {
        if (!event || event.data === 'pong') return;
        var message = null;
        try { message = JSON.parse(event.data); } catch (e) { return; }
        if (!message || typeof message.method !== 'string') return;

        if (message.method === 'Connected') {
            register();
            if (everConnected) scheduleRefresh();
            everConnected = true;
            return;
        }

        if (message.method === 'TranslationSubChanged')
            scheduleRefresh();
    }

    function connect() {
        if (typeof WebSocket !== 'function') return;
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

        var url = websocketUrl();
        if (!url) return;

        try { socket = new WebSocket(url); }
        catch (e) { scheduleReconnect(); return; }

        socket.onopen = function () {
            reconnectDelay = 2000;
            startPing();
        };
        socket.onmessage = onMessage;
        socket.onerror = function () {};
        socket.onclose = function () {
            stopPing();
            socket = null;
            scheduleReconnect();
        };
    }

    function start() {
        if (!window.Lampa) return;
        connect();

        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (!event || event.type !== 'ready') return;
                    if (!register()) connect();
                });
            }
        } catch (e) {}

        try {
            document.addEventListener('visibilitychange', function () {
                if (document.hidden) return;
                if (!register()) connect();
            });
        } catch (e2) {}
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
