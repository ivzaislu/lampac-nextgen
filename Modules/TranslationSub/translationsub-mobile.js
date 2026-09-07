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
            '.translationsub-full-button--mobile{' +
                'position:relative!important;' +
                'display:flex!important;' +
                'align-items:center!important;' +
                'justify-content:center!important;' +
                'min-width:8.8em!important;' +
                'height:3.35em!important;' +
                'padding:.4em .95em!important;' +
                'margin-right:.7em!important;' +
                'border-radius:.9em!important;' +
                'box-sizing:border-box!important;' +
                'touch-action:manipulation!important;' +
                '-webkit-tap-highlight-color:transparent;' +
            '}' +
            '.translationsub-full-button--mobile>svg{' +
                'width:1.3em!important;' +
                'height:1.45em!important;' +
                'margin-right:.5em!important;' +
                'flex-shrink:0!important;' +
            '}' +
            '.translationsub-full-button--mobile>span{' +
                'display:block!important;' +
                'margin:0!important;' +
                'white-space:nowrap!important;' +
            '}' +
            '.translationsub-full-button--mobile .translationsub-full-button__progress{' +
                'display:none!important;' +
            '}' +
            '.translationsub-full-button--mobile:active{' +
                'transform:scale(.97)!important;' +
            '}';

        (document.head || document.documentElement).appendChild(style);
    }

    function place(button) {
        if (!isMobile() || !button || !button.length) return;

        button.addClass('translationsub-full-button--mobile');

        // Перемещаем только один раз. Никаких отложенных перестановок после того,
        // как пользователь уже увидел кнопку и мог начать касание.
        if (button.attr('data-translationsub-mobile-positioned') === '1') return;

        var row = button.parent();
        if (!row || !row.length) return;

        var siblings = row.children('.full-start__button, .full-start-new__button').not(button);
        if (siblings.length) button.insertAfter(siblings.first());
        else row.prepend(button);

        button.attr('data-translationsub-mobile-positioned', '1');
    }

    function apply() {
        if (!isMobile() || typeof $ !== 'function') return;
        $('.translationsub-full-button').each(function () { place($(this)); });
    }

    function bind() {
        try {
            if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('full', function (event) {
                    if (!event || event.type !== 'complite') return;
                    // Main TranslationSub создаёт кнопку своим более ранним listener'ом.
                    // Этот listener выполняется в том же цикле события до отрисовки кадра.
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
