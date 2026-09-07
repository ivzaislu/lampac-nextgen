(function () {
    'use strict';

    if (window.__TranslationSubMobileButtonStarted) return;
    window.__TranslationSubMobileButtonStarted = true;

    var applyTimer = null;

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
            'body.touch-device .translationsub-full-button--mobile,' +
            '.translationsub-full-button--mobile{' +
                'position:relative!important;' +
                'display:flex!important;' +
                'align-items:center!important;' +
                'justify-content:center!important;' +
                'min-width:9.2em!important;' +
                'height:3.55em!important;' +
                'padding:.45em 1.05em!important;' +
                'margin-right:.7em!important;' +
                'border-radius:.9em!important;' +
                'box-sizing:border-box!important;' +
                'touch-action:manipulation!important;' +
                '-webkit-tap-highlight-color:transparent;' +
                'user-select:none;' +
            '}' +
            '.translationsub-full-button--mobile>svg{' +
                'width:1.35em!important;' +
                'height:1.5em!important;' +
                'margin-right:.55em!important;' +
                'flex-shrink:0!important;' +
            '}' +
            '.translationsub-full-button--mobile>span{' +
                'display:block!important;' +
                'margin:0!important;' +
                'font-size:1em!important;' +
                'font-weight:500!important;' +
                'white-space:nowrap!important;' +
            '}' +
            '.translationsub-full-button--mobile .translationsub-full-button__progress{' +
                'display:inline-flex!important;' +
                'align-items:center!important;' +
                'margin-left:.55em!important;' +
                'padding:.16em .4em!important;' +
                'font-size:.68em!important;' +
                'line-height:1.15!important;' +
            '}' +
            '.translationsub-full-button--mobile:active{' +
                'transform:scale(.96)!important;' +
                'background:rgba(255,255,255,.22)!important;' +
            '}' +
            '@media(max-width:480px){' +
                '.translationsub-full-button--mobile{' +
                    'min-width:8.7em!important;' +
                    'height:3.7em!important;' +
                    'padding:.48em .9em!important;' +
                '}' +
                '.translationsub-full-button--mobile .translationsub-full-button__progress{' +
                    'font-size:.64em!important;' +
                '}' +
            '}';

        (document.head || document.documentElement).appendChild(style);
    }

    function moveNearStart(button) {
        var row = button.parent();
        if (!row || !row.length) return;

        var siblings = row.children('.full-start__button, .full-start-new__button').not(button);
        if (siblings.length) button.insertAfter(siblings.first());
        else row.prepend(button);
    }

    function bindTap(button) {
        button.off('click.translationsubMobile');
        button.on('click.translationsubMobile', function (event) {
            if (!isMobile()) return;

            // На touch-устройствах не ждём, пока Lampa преобразует tap в hover:enter.
            // Вызываем уже существующее действие кнопки напрямую и гасим всплытие,
            // чтобы один tap не открыл меню дважды.
            try {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
            } catch (e) {}

            var now = Date.now ? Date.now() : new Date().getTime();
            var previous = Number(button.data('translationsub-mobile-tap') || 0);
            if (now - previous < 450) return;
            button.data('translationsub-mobile-tap', now);

            button.triggerHandler('hover:enter');
        });
    }

    function apply() {
        if (!isMobile() || typeof $ !== 'function') return;

        var buttons = $('.translationsub-full-button');
        if (!buttons.length) return;

        buttons.each(function () {
            var button = $(this);
            button.addClass('translationsub-full-button--mobile');
            moveNearStart(button);
            bindTap(button);
        });
    }

    function schedule(delay) {
        clearTimeout(applyTimer);
        applyTimer = setTimeout(apply, typeof delay === 'number' ? delay : 100);
    }

    function bind() {
        try {
            if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('full', function (event) {
                    if (!event || event.type !== 'complite') return;
                    schedule(120);
                    setTimeout(apply, 450);
                });

                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') schedule(300);
                });
            }
        } catch (e) {}

        try {
            window.addEventListener('orientationchange', function () { schedule(250); });
            window.addEventListener('resize', function () { schedule(180); });
        } catch (e2) {}
    }

    function start() {
        if (!window.Lampa) return;
        injectStyles();
        bind();
        schedule(100);
        setTimeout(apply, 500);
        setTimeout(apply, 1200);
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