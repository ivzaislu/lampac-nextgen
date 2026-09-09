(function () {
    'use strict';

    if (window.__TranslationSubBellThemeStarted) return;
    window.__TranslationSubBellThemeStarted = true;

    var syncTimer = null;

    /*
     * Единая геометрия колокольчика TranslationSub.
     * Этот же силуэт используется в карточке сериала: outline означает отсутствие
     * состояния, filled — активную подписку / наличие новых серий.
     */
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
            /* Карточка сериала: возвращаем реальный SVG и задаём единую маску. */
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

            /* Верхняя панель: outline без новых серий, filled при count > 0. */
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

            /* Левое меню. */
            '.translationsub-menu-item .menu__ico svg{' +
                'display:block!important;background:currentColor!important;fill:none!important;stroke:none!important;' +
                '-webkit-mask:' + outline + ' center/contain no-repeat!important;' +
                'mask:' + outline + ' center/contain no-repeat!important;' +
            '}' +
            '.translationsub-menu-item .menu__ico svg>*{display:none!important}' +

            /* Раздел настроек. Размер остаётся настроенным отдельно, меняется только силуэт. */
            '.settings-folder[data-component="translationsub_settings"] .translationsub-settings-bell{' +
                'background:currentColor!important;fill:none!important;stroke:none!important;' +
                '-webkit-mask:' + outline + ' center/contain no-repeat!important;' +
                'mask:' + outline + ' center/contain no-repeat!important;' +
            '}' +
            '.settings-folder[data-component="translationsub_settings"] .translationsub-settings-bell>*{display:none!important}' +

            /* Пустая шторка уведомлений — вместо стороннего bell-plus тот же outline. */
            '.translationsub-notice__empty .notice__img{position:relative!important}' +
            '.translationsub-notice__empty .notice__img>*{display:none!important}' +
            '.translationsub-notice__empty .notice__img:before{' +
                'content:"";display:block;width:3.5em;height:3.5em;margin:auto;background:currentColor;' +
                '-webkit-mask:' + outline + ' center/contain no-repeat;' +
                'mask:' + outline + ' center/contain no-repeat;' +
            '}';

        (document.head || document.documentElement).appendChild(style);
    }

    function updateHeadState() {
        var count = 0;
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.count === 'function')
                count = Number(window.TranslationSubBadgeState.count()) || 0;
        } catch (e) {}

        var nodes = document.querySelectorAll ? document.querySelectorAll('.translationsub-head') : [];
        for (var i = 0; i < nodes.length; i++) {
            if (count > 0) nodes[i].classList.add('translationsub-head--has-updates');
            else nodes[i].classList.remove('translationsub-head--has-updates');
            nodes[i].setAttribute('data-translationsub-updates', String(count));
        }
    }

    function start() {
        injectStyles();
        updateHeadState();

        /* Только визуальная синхронизация, сетевых запросов здесь нет. */
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(updateHeadState, 750);

        try {
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) updateHeadState();
            });
        } catch (e) {}

        try {
            if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') setTimeout(updateHeadState, 0);
                });
            }
        } catch (e2) {}

        window.TranslationSubBellTheme = {
            refresh: updateHeadState,
            bodyPath: BELL_BODY,
            clapperPath: BELL_CLAPPER
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
