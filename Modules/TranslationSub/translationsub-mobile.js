(function () {
    'use strict';

    if (window.__TranslationSubMobileButtonStarted) return;
    window.__TranslationSubMobileButtonStarted = true;

    function isMobile() {
        try {
            if (window.Lampa && Lampa.Platform && typeof Lampa.Platform.screen === 'function')
                return !!Lampa.Platform.screen('mobile');
        } catch (e) {}

        try {
            var touch = 'ontouchstart' in window || Number(navigator.maxTouchPoints || 0) > 0 || document.body.classList.contains('touch-device');
            return touch && Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= 900;
        } catch (e2) {
            return false;
        }
    }

    function injectStyles() {
        if (document.getElementById('translationsub-mobile-button-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-mobile-button-style';
        style.textContent =
            /* На mobile геометрию кнопки полностью задаёт сама Lampa. */
            '.translationsub-full-button--mobile>span,' +
            '.translationsub-full-button--mobile .translationsub-full-button__progress{' +
                'display:none!important;' +
            '}' +
            '.translationsub-full-button--mobile{' +
                'touch-action:manipulation!important;' +
                '-webkit-tap-highlight-color:transparent;' +
            '}';

        (document.head || document.documentElement).appendChild(style);
    }

    function apply() {
        if (!isMobile() || typeof $ !== 'function') return;

        // Только отмечаем кнопку как mobile. Не меняем её позицию в DOM и не
        // добавляем собственный click/touch handler: этим занимается Lampa.
        $('.translationsub-full-button').addClass('translationsub-full-button--mobile');
    }

    function bind() {
        try {
            if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('full', function (event) {
                    if (!event || event.type !== 'complite') return;
                    apply();
                });
            }
        } catch (e) {}
    }

    function start() {
        if (!window.Lampa) return;
        injectStyles();
        bind();
        apply();
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
