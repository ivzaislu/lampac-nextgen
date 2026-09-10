(function () {
    'use strict';

    if (window.__TranslationSubBadgeStateStarted) return;
    window.__TranslationSubBadgeStateStarted = true;

    var state = {
        count: 0,
        updates: [],
        snapshot: null,
        requestSeq: 0,
        drawerOpening: false
    };

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

    function applySnapshot(snapshot) {
        snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
        var updates = Array.isArray(snapshot.updates) ? snapshot.updates : [];
        var badge = snapshot.badge && typeof snapshot.badge === 'object' ? snapshot.badge : {};
        var count = Number(badge.count);

        state.snapshot = snapshot;
        state.updates = updates;
        state.count = isNaN(count) ? updates.length : Math.max(0, count);
        render();
        return updates.slice();
    }

    function refresh(done) {
        done = typeof done === 'function' ? done : function () {};
        var seq = ++state.requestSeq;
        var api = window.TranslationSubApi;

        if (!api || typeof api.snapshot !== 'function') {
            render();
            done(state.updates.slice());
            return;
        }

        api.snapshot(function (snapshot) {
            if (seq !== state.requestSeq) {
                done(state.updates.slice());
                return;
            }
            done(applySnapshot(snapshot));
        }, function () {
            if (seq !== state.requestSeq) {
                done(state.updates.slice());
                return;
            }
            render();
            done(state.updates.slice());
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

        try {
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) refresh();
            });
        } catch (e) {}

        window.TranslationSubBadgeState = {
            refresh: refresh,
            applySnapshot: applySnapshot,
            render: render,
            open: openDrawerSynced,
            count: function () { return state.count; },
            updates: function () { return state.updates.slice(); },
            snapshot: function () { return state.snapshot; }
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
