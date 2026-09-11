(function () {
    'use strict';

    if (window.__TranslationSubBadgeStateStarted) return;
    window.__TranslationSubBadgeStateStarted = true;

    var state = {
        count: 0,
        updates: [],
        snapshot: null,
        requestSeq: 0,
        loading: false,
        waiters: [],
        drawerOpening: false,
        listeners: []
    };

    function injectStyles() {
        if (document.getElementById('translationsub-badge-state-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-badge-state-style';
        style.textContent =
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

    function view() {
        return {
            count: Number(state.count) || 0,
            updates: state.updates.slice(),
            snapshot: state.snapshot
        };
    }

    function emit() {
        var current = view();
        state.listeners.slice().forEach(function (listener) {
            try { listener(current); } catch (e) {}
        });
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return function () {};
        if (state.listeners.indexOf(listener) === -1) state.listeners.push(listener);

        try { listener(view()); } catch (e) {}

        return function () {
            var index = state.listeners.indexOf(listener);
            if (index !== -1) state.listeners.splice(index, 1);
        };
    }

    function commitSnapshot(snapshot) {
        snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
        var updates = Array.isArray(snapshot.updates) ? snapshot.updates : [];
        var badge = snapshot.badge && typeof snapshot.badge === 'object' ? snapshot.badge : {};
        var count = Number(badge.count);

        state.snapshot = snapshot;
        state.updates = updates;
        state.count = isNaN(count) ? updates.length : Math.max(0, count);
        render();
        emit();
        return updates.slice();
    }

    function finishRefresh(updates) {
        state.loading = false;
        var waiters = state.waiters.splice(0);
        waiters.forEach(function (done) {
            try { done(updates.slice()); } catch (e) {}
        });
    }

    function applySnapshot(snapshot) {
        state.requestSeq++;
        var updates = commitSnapshot(snapshot);
        if (state.loading) finishRefresh(updates);
    }

    function applyCommand(result) {
        if (!result || result.success !== true || !result.snapshot || typeof result.snapshot !== 'object')
            return null;
        applySnapshot(result.snapshot);
        return view();
    }

    function refresh(done) {
        done = typeof done === 'function' ? done : function () {};
        state.waiters.push(done);
        if (state.loading) return;

        var api = window.TranslationSubApi;
        if (!api || typeof api.snapshot !== 'function') {
            render();
            finishRefresh(state.updates.slice());
            return;
        }

        state.loading = true;
        var seq = ++state.requestSeq;
        api.snapshot(function (snapshot) {
            if (seq !== state.requestSeq) return;
            finishRefresh(commitSnapshot(snapshot));
        }, function () {
            if (seq !== state.requestSeq) return;
            render();
            finishRefresh(state.updates.slice());
        });
    }

    function openDrawerSynced() {
        if (state.drawerOpening) return;
        state.drawerOpening = true;

        refresh(function (updates) {
            state.drawerOpening = false;

            try {
                if (window.TranslationSubNotice && typeof window.TranslationSubNotice.open === 'function') {
                    window.TranslationSubNotice.open(updates);
                    return;
                }
            } catch (e) {}

            try {
                if (window.TranslationSub && typeof window.TranslationSub.openSubscriptions === 'function')
                    window.TranslationSub.openSubscriptions();
            } catch (e2) {}
        });
    }

    function start() {
        injectStyles();
        refresh();

        try {
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) refresh();
            });
        } catch (e) {}

        window.TranslationSubBadgeState = {
            refresh: refresh,
            applyCommand: applyCommand,
            subscribe: subscribe,
            render: render,
            open: openDrawerSynced
        };
    }

    window.TranslationSubRuntime.onReady(start);
})();
