(function () {
    'use strict';

    if (window.__TranslationSubBellThemeStarted) return;
    window.__TranslationSubBellThemeStarted = true;

    var unsubscribeState = null;
    var currentCount = 0;

    function updateHeadState(next) {
        if (next && typeof next === 'object' && next.count !== undefined)
            currentCount = Math.max(0, Number(next.count) || 0);

        var nodes = document.querySelectorAll ? document.querySelectorAll('.translationsub-head') : [];
        for (var i = 0; i < nodes.length; i++) {
            if (currentCount > 0) nodes[i].classList.add('translationsub-head--has-updates');
            else nodes[i].classList.remove('translationsub-head--has-updates');
        }
    }

    function bindState() {
        if (unsubscribeState) return true;
        try {
            var badge = window.TranslationSubBadgeState;
            if (!badge || typeof badge.subscribe !== 'function') return false;
            unsubscribeState = badge.subscribe(updateHeadState);
            return true;
        } catch (e) {
            return false;
        }
    }

    function start() {
        bindState();
        updateHeadState();

        try {
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) {
                    bindState();
                    updateHeadState();
                }
            });
        } catch (e) {}

        window.TranslationSubBellTheme = {
            refresh: updateHeadState
        };
    }

    window.TranslationSubRuntime.onReady(start);
})();