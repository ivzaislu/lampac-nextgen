(function () {
    'use strict';

    if (window.__TranslationSubBellThemeStarted) return;
    window.__TranslationSubBellThemeStarted = true;

    var unsubscribeState = null;
    var currentCount = 0;

    /* One canonical bell geometry for full-card, header, menu, settings and empty state. */
    var BELL_BODY = 'M12 3.5a5.5 5.5 0 0 0-5.5 5.5v3.2c0 1.9-.7 3.5-2.1 4.8l-.9.8h17l-.9-.8c-1.4-1.3-2.1-2.9-2.1-4.8V9A5.5 5.5 0 0 0 12 3.5Z';
    var BELL_CLAPPER = 'M9.6 20h4.8c-.35 1.1-1.25 1.7-2.4 1.7S9.95 21.1 9.6 20Z';

    function maskSvg(filled) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
            '<path d="' + BELL_BODY + '" fill="' + (filled ? 'white' : 'none') + '" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' +
            '<path d="' + BELL_CLAPPER + '" fill="white"/>' +
        '</svg>';
    }

    function maskUrl(filled) {
        return 'url("data:image/svg+xml,' + encodeURIComponent(maskSvg(filled)) + '")';
    }

    function injectStyles() {
        if (document.getElementById('translationsub-bell-theme-style')) return;

        var outline = maskUrl(false);
        var filled = maskUrl(true);
        var style = document.createElement('style');
        style.id = 'translationsub-bell-theme-style';
        style.textContent =
            '.translationsub-head{position:relative;display:flex;align-items:center;justify-content:center}' +
            '.translationsub-full-button:before{display:none!important}' +
            '.translationsub-full-button>.translationsub-full-button__bell{' +
                'display:block!important;width:1.55em!important;height:1.55em!important;flex:0 0 1.55em!important;' +
                'background:currentColor!important;fill:none!important;stroke:none!important;' +
                '-webkit-mask:' + outline + ' center/contain no-repeat!important;' +
                'mask:' + outline + ' center/contain no-repeat!important;' +
            '}' +
            '.translationsub-full-button>.translationsub-full-button__bell>*{display:none!important}' +
            '.translationsub-full-button--subscribed>.translationsub-full-button__bell{' +
                'transform:none!important;' +
                '-webkit-mask:' + filled + ' center/contain no-repeat!important;' +
                'mask:' + filled + ' center/contain no-repeat!important;' +
            '}' +
            '.translationsub-head>svg{' +
                'display:block!important;width:1.8em!important;height:1.8em!important;' +
                'background:currentColor!important;fill:none!important;stroke:none!important;' +
                '-webkit-mask:' + outline + ' center/contain no-repeat!important;' +
                'mask:' + outline + ' center/contain no-repeat!important;' +
            '}' +
            '.translationsub-head>svg>*{display:none!important}' +
            '.translationsub-head.translationsub-head--has-updates>svg{' +
                '-webkit-mask:' + filled + ' center/contain no-repeat!important;' +
                'mask:' + filled + ' center/contain no-repeat!important;' +
            '}' +
            '.translationsub-menu-item .menu__ico svg{' +
                'display:block!important;width:100%!important;height:100%!important;' +
                'background:currentColor!important;fill:none!important;stroke:none!important;' +
                '-webkit-mask:' + outline + ' center/contain no-repeat!important;' +
                'mask:' + outline + ' center/contain no-repeat!important;' +
            '}' +
            '.translationsub-menu-item .menu__ico svg>*{display:none!important}' +
            '.settings-folder[data-component="translationsub_settings"] .translationsub-settings-bell{' +
                'width:2em!important;height:2em!important;transform:scale(1.35)!important;' +
                'transform-origin:50% 50%!important;overflow:visible!important;' +
                'background:currentColor!important;fill:none!important;stroke:none!important;' +
                '-webkit-mask:' + outline + ' center/contain no-repeat!important;' +
                'mask:' + outline + ' center/contain no-repeat!important;' +
            '}' +
            '.settings-folder[data-component="translationsub_settings"] .translationsub-settings-bell>*{display:none!important}' +
            '.translationsub-notice__empty .notice__img{position:relative!important}' +
            '.translationsub-notice__empty .notice__img>*{display:none!important}' +
            '.translationsub-notice__empty .notice__img:before{' +
                'content:"";display:block;width:3.5em;height:3.5em;margin:auto;background:currentColor;' +
                '-webkit-mask:' + outline + ' center/contain no-repeat;' +
                'mask:' + outline + ' center/contain no-repeat;' +
            '}';

        (document.head || document.documentElement).appendChild(style);
    }

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
        injectStyles();
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
