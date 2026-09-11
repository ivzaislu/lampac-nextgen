(function () {
    'use strict';

    if (window.__TranslationSubUiV2Started) return;
    window.__TranslationSubUiV2Started = true;

    var lampaBound = false;
    var BELL_BODY = 'M12 3.5a5.5 5.5 0 0 0-5.5 5.5v3.2c0 1.9-.7 3.5-2.1 4.8l-.9.8h17l-.9-.8c-1.4-1.3-2.1-2.9-2.1-4.8V9A5.5 5.5 0 0 0 12 3.5Z';
    var BELL_CLAPPER = 'M9.6 20h4.8c-.35 1.1-1.25 1.7-2.4 1.7S9.95 21.1 9.6 20Z';

    function layoutMode() {
        try {
            if (window.Lampa && Lampa.Platform && typeof Lampa.Platform.screen === 'function') {
                if (Lampa.Platform.screen('mobile')) return 'mobile';
                if (Lampa.Platform.screen('tv')) return 'tv';
            }
        } catch (e) {}

        try {
            var ua = String(navigator.userAgent || '').toLowerCase();
            if (/android tv|google tv|googletv|mibox|mitv|smarttv|smart tv|tizen|webos/.test(ua)) return 'tv';
            if (/iphone|ipad|android/.test(ua) && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) return 'mobile';
        } catch (e2) {}
        return 'desktop';
    }

    function posterUrl(path) {
        path = String(path || '');
        if (!path) return '';
        if (/^https?:\/\//i.test(path)) return path;

        try {
            if (window.Lampa && Lampa.Api && typeof Lampa.Api.img === 'function')
                return Lampa.Api.img(path, 'w300');
        } catch (e) {}

        try {
            if (window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.image === 'function')
                return Lampa.TMDB.image('t/p/w300/' + path.replace(/^\//, ''));
        } catch (e2) {}

        return path.charAt(0) === '/' ? 'https://image.tmdb.org/t/p/w300' + path : path;
    }

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
        if (document.getElementById('translationsub-ui-v2-style')) return;

        var outline = maskUrl(false);
        var filled = maskUrl(true);
        var style = document.createElement('style');
        style.id = 'translationsub-ui-v2-style';
        style.textContent =
            /* Subscription page and responsive layout. */
            '.translationsub-page{width:100%!important;max-width:112em!important;padding:1.35em 1.55em 5em!important;box-sizing:border-box}' +
            '.translationsub-page__top{display:flex!important;align-items:center!important;gap:.7em!important;flex-wrap:wrap!important;margin:0 0 1.05em!important}' +
            '.translationsub-page__top .translationsub-toolbar,.translationsub-page__top .translationsub-summary-v2{margin:0!important}' +
            '.translationsub-summary-v2{display:flex;align-items:center;gap:.45em!important;flex-wrap:wrap}' +
            '.translationsub-summary-v2__item{display:flex;align-items:center;gap:.42em;padding:.39em .66em!important;border-radius:2em;background:rgba(255,255,255,.085);font-size:.84em!important;line-height:1.25}' +
            '.translationsub-summary-v2__item b{font-weight:700}' +
            '.translationsub-summary-v2__item--new{background:rgba(255,125,55,.18)}' +
            '.translationsub-summary-v2__dot{width:.52em;height:.52em;border-radius:50%;background:rgba(255,255,255,.45)}' +
            '.translationsub-summary-v2__item--new .translationsub-summary-v2__dot{background:#ff8a4c}' +
            '.translationsub-toolbar{display:flex;gap:.65em!important;flex-wrap:wrap}' +
            '.translationsub-toolbar__item{min-height:2.65em;box-sizing:border-box;padding:.62em .95em!important;border-radius:.72em!important;background:rgba(255,255,255,.075)!important;border:1px solid rgba(255,255,255,.055);font-size:.94em}' +
            '.translationsub-toolbar__item.focus{background:#fff!important;color:#111!important;border-color:#fff;transform:scale(1.035)}' +
            '.translationsub-list,.translationsub-layout--tv .translationsub-list,.translationsub-layout--desktop .translationsub-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:.9em 1em!important;align-items:stretch}' +
            '.translationsub-card{display:flex;align-items:stretch;min-height:11.2em!important;border-radius:.9em!important;background:rgba(255,255,255,.065)!important;border:1px solid rgba(255,255,255,.075)!important;box-shadow:0 .18em .6em rgba(0,0,0,.08);overflow:hidden!important;position:relative;transition:transform .16s ease,background .16s ease,border-color .16s ease;transform:none!important}' +
            '.translationsub-card--has-new{border-color:rgba(244,122,66,.42)!important;background:linear-gradient(115deg,rgba(244,122,66,.12),rgba(255,255,255,.055))!important}' +
            '.translationsub-card.focus{background:#fff!important;color:#111!important;border-color:#fff!important;transform:scale(1.012)!important;z-index:3}' +
            '.translationsub-card__poster{width:7.5em!important;min-width:7.5em!important;position:relative;background:rgba(0,0,0,.2)!important;overflow:hidden}' +
            '.translationsub-card__poster img{width:100%;height:100%;object-fit:cover;display:block}' +
            '.translationsub-card__body{padding:.92em 1.02em!important;min-width:0;display:flex;flex-direction:column;flex:1;justify-content:flex-start!important}' +
            '.translationsub-card__title{font-size:1.22em!important;line-height:1.18!important;font-weight:700!important;padding-right:5.2em!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.translationsub-card__voice{display:inline-flex!important;align-self:flex-start;margin-top:.38em!important;padding:.22em .48em!important;border-radius:.42em!important;background:rgba(255,255,255,.09);font-size:.82em!important;font-weight:500;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.86}' +
            '.translationsub-card.focus .translationsub-card__voice{background:rgba(0,0,0,.075)}' +
            '.translationsub-card__meta{margin-top:.58em!important;font-size:.86em!important;opacity:1!important;min-width:0}' +
            '.translationsub-meta-v2{display:flex;flex-direction:column;gap:.34em!important;min-width:0}' +
            '.translationsub-meta-v2__row{display:flex;align-items:center;gap:.38em!important;flex-wrap:nowrap!important;min-width:0}' +
            '.translationsub-meta-v2__season{font-weight:700;flex:0 0 auto;font-size:1.02em}' +
            '.translationsub-meta-v2__pill{padding:.21em .44em!important;border-radius:.42em!important;background:rgba(255,255,255,.075);opacity:.78;white-space:nowrap}' +
            '.translationsub-card.focus .translationsub-meta-v2__pill{background:rgba(0,0,0,.065)}' +
            '.translationsub-progress-v2{height:.28em!important;margin:.04em 0 .02em;border-radius:1em;background:rgba(255,255,255,.1);overflow:hidden}' +
            '.translationsub-progress-v2>i{display:block;height:100%;border-radius:inherit;background:#67c997}' +
            '.translationsub-meta-v2__next{font-size:.91em!important;line-height:1.25;font-weight:600;color:#ffb07f}' +
            '.translationsub-meta-v2__ok{font-size:.9em!important;line-height:1.25;opacity:.55}' +
            '.translationsub-meta-v2__source{font-size:.82em!important;line-height:1.2;opacity:.48!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:100%}' +
            '.translationsub-tmdb-v2{margin-top:.18em!important;padding-top:.42em!important;border-top:1px solid rgba(255,255,255,.075)!important;font-size:.79em!important;line-height:1.28!important;min-width:0}' +
            '.translationsub-card.focus .translationsub-tmdb-v2{border-top-color:rgba(0,0,0,.1)!important}' +
            '.translationsub-tmdb-v2__facts{display:flex!important;align-items:center!important;gap:.3em!important;flex-wrap:nowrap!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.58!important}' +
            '.translationsub-tmdb-v2__facts>*{flex:0 0 auto}' +
            '.translationsub-tmdb-v2__sep{opacity:.45}' +
            '.translationsub-tmdb-v2__state{margin-top:.16em!important;font-size:.96em;line-height:1.2;font-weight:550;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.translationsub-tmdb-v2__state--active,.translationsub-tmdb-v2__state--new-season{color:#ffad7d;opacity:1}' +
            '.translationsub-tmdb-v2__state--ok{color:#75cfa0;opacity:.88}' +
            '.translationsub-tmdb-v2__state--warn{color:#e7c56c;opacity:.9}' +
            '.translationsub-card.focus .translationsub-tmdb-v2__state--active,.translationsub-card.focus .translationsub-tmdb-v2__state--new-season{color:#b65125}' +
            '.translationsub-card.focus .translationsub-tmdb-v2__state--ok{color:#26794d}' +
            '.translationsub-card__new{position:absolute;right:.62em!important;top:.6em!important;padding:.31em .5em!important;border-radius:.5em!important;background:#f36f3d!important;color:#fff;font-size:.66em!important;font-weight:700}' +
            '.translationsub-empty{grid-column:1/-1;padding:4em 1.5em!important;border-radius:1em;background:rgba(255,255,255,.045);font-size:1.05em;line-height:1.55}' +
            '.translationsub-layout--tv{max-width:none!important;width:100%!important;padding:1.3em 1.55em 5em!important}' +
            '.translationsub-layout--tv .translationsub-card{min-height:11.4em!important;border-width:2px!important}' +
            '.translationsub-layout--tv .translationsub-card.focus{background:rgba(255,255,255,.15)!important;color:inherit!important;border-color:#fff!important}' +
            '.translationsub-layout--tv .translationsub-card__poster{width:7.35em!important;min-width:7.35em!important}' +
            '.translationsub-layout--tv .translationsub-card__body{padding:.9em 1em!important}' +
            '.translationsub-layout--tv .translationsub-card__title{font-size:1.18em!important}' +
            '.translationsub-layout--tv .translationsub-card__meta{font-size:.84em!important}' +
            '.translationsub-layout--tv .translationsub-card.focus .translationsub-tmdb-v2{border-top-color:rgba(255,255,255,.12)!important}' +
            '.translationsub-layout--mobile{width:100%!important;max-width:none!important;padding:.85em .85em calc(9.5em + env(safe-area-inset-bottom,0px))!important}' +
            '.translationsub-layout--mobile .translationsub-page__top{display:grid!important;grid-template-columns:1fr!important;gap:.55em!important;margin-bottom:.75em!important}' +
            '.translationsub-layout--mobile .translationsub-toolbar{width:100%!important}' +
            '.translationsub-layout--mobile .translationsub-toolbar__item{width:100%!important;justify-content:center!important;min-height:2.75em}' +
            '.translationsub-layout--mobile .translationsub-summary-v2{width:100%!important;display:flex!important;gap:.42em!important;margin:0!important}' +
            '.translationsub-layout--mobile .translationsub-summary-v2__item{font-size:.8em!important;padding:.36em .58em!important}' +
            '.translationsub-layout--mobile .translationsub-list{grid-template-columns:1fr!important;gap:.68em!important}' +
            '.translationsub-layout--mobile .translationsub-card{min-height:10.8em!important;border-radius:.78em!important}' +
            '.translationsub-layout--mobile .translationsub-card__poster{width:6.15em!important;min-width:6.15em!important}' +
            '.translationsub-layout--mobile .translationsub-card__body{padding:.72em .78em!important}' +
            '.translationsub-layout--mobile .translationsub-card__title{font-size:1.05em!important;padding-right:4.7em!important}' +
            '.translationsub-layout--mobile .translationsub-card__voice{font-size:.74em!important;margin-top:.3em!important}' +
            '.translationsub-layout--mobile .translationsub-card__meta{font-size:.76em!important;margin-top:.44em!important}' +
            '.translationsub-layout--mobile .translationsub-meta-v2{gap:.26em!important}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__row{gap:.28em!important}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__pill{padding:.18em .34em!important}' +
            '.translationsub-layout--mobile .translationsub-progress-v2{height:.24em!important}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__next,.translationsub-layout--mobile .translationsub-meta-v2__ok{font-size:.88em!important}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__source{font-size:.78em!important}' +
            '.translationsub-layout--mobile .translationsub-tmdb-v2{font-size:.72em!important;padding-top:.32em!important;margin-top:.1em!important}' +
            '.translationsub-layout--mobile .translationsub-tmdb-v2__facts{display:block!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}' +
            '.translationsub-layout--mobile .translationsub-tmdb-v2__sep{margin:0 .18em}' +
            '.translationsub-layout--mobile .translationsub-tmdb-v2__state{margin-top:.12em!important;font-size:.94em}' +
            '.translationsub-layout--mobile .translationsub-card__new{right:.48em!important;top:.46em!important;font-size:.61em!important}' +
            '.translationsub-full-button--mobile>span,.translationsub-full-button--mobile .translationsub-full-button__progress{display:none!important}' +
            '.translationsub-full-button--mobile{touch-action:manipulation!important;-webkit-tap-highlight-color:transparent}' +
            '@media(max-width:390px){' +
                '.translationsub-layout--mobile .translationsub-card__poster{width:5.5em!important;min-width:5.5em!important}' +
                '.translationsub-layout--mobile .translationsub-card__body{padding:.65em!important}' +
                '.translationsub-layout--mobile .translationsub-meta-v2__row{flex-wrap:wrap!important}' +
                '.translationsub-layout--mobile .translationsub-card__title{font-size:1em!important}' +
            '}' +

            /* Badge presentation. */
            '.translationsub-state-badge{' +
                'position:absolute;right:-.25em;top:-.25em;min-width:1.5em;height:1.5em;padding:0 .3em;' +
                'border-radius:1em;background:#e53935;color:#fff;font-size:.7em;font-weight:600;' +
                'display:flex;align-items:center;justify-content:center;box-sizing:border-box;pointer-events:none;' +
            '}' +
            '.translationsub-state-menu-badge{' +
                'margin-left:auto;min-width:1.65em;height:1.65em;padding:0 .38em;border-radius:1em;' +
                'background:#e45e2c;color:#fff;font-size:.7em;font-weight:700;display:flex;' +
                'align-items:center;justify-content:center;box-sizing:border-box;pointer-events:none;' +
            '}' +

            /* Canonical bell/icon presentation. */
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
            '}' +

            /* Notice drawer presentation. */
            '.translationsub-notice{padding:0!important}' +
            '.translationsub-notice .notice{margin:0 0 .45em!important;padding:.65em!important;min-height:4.7em!important;border-radius:.55em!important}' +
            '.translationsub-notice .notice:last-child{margin-bottom:0!important}' +
            '.translationsub-notice .notice__left{width:3.15em!important;min-width:3.15em!important}' +
            '.translationsub-notice .notice__img{width:3.15em!important;height:4.55em!important;border-radius:.38em!important}' +
            '.translationsub-notice .notice__body{padding-left:.72em!important;min-width:0!important}' +
            '.translationsub-notice .notice__title{font-size:1em!important;line-height:1.2!important;font-weight:650!important}' +
            '.translationsub-notice .notice__time{font-size:.72em!important;opacity:.55!important;margin-left:.55em!important}' +
            '.translationsub-notice .notice__descr{font-size:.82em!important;line-height:1.3!important;opacity:.8!important;margin-top:.22em!important}' +
            '.translationsub-notice .notice__footer{display:flex;gap:.3em!important;flex-wrap:nowrap!important;margin-top:.3em!important;white-space:nowrap!important;overflow:hidden!important}' +
            '.translationsub-notice .notice__footer>div{padding:.16em .34em!important;border-radius:.3em!important;background:rgba(255,255,255,.07)!important;font-size:.72em!important;opacity:.65!important;overflow:hidden!important;text-overflow:ellipsis!important}' +
            '.translationsub-notice .notice.focus .notice__footer>div{background:rgba(0,0,0,.07)!important}' +
            '.translationsub-notice__empty{padding:1.1em 0;opacity:.72}' +

            /* Full-card button presentation. */
            '.translationsub-full-button{position:relative}' +
            '.translationsub-full-button[data-translationsub-card-flow="1"]{gap:.55em}' +
            '.translationsub-full-button[data-translationsub-card-flow="1"] span{white-space:nowrap}';

        (document.head || document.documentElement).appendChild(style);
    }

    function applyFullButtonMode() {
        if (typeof $ !== 'function') return;
        var mobile = layoutMode() === 'mobile';
        $('.translationsub-full-button').each(function () {
            $(this).toggleClass('translationsub-full-button--mobile', mobile);
        });
    }

    function applyLayout(page) {
        if (typeof $ !== 'function') return;
        var root = $(page);
        var mode = layoutMode();
        root.removeClass('translationsub-layout--tv translationsub-layout--mobile translationsub-layout--desktop');
        root.addClass('translationsub-layout--' + mode);
    }

    function refresh() {
        if (typeof $ !== 'function') return;
        $('.translationsub-page').each(function () { applyLayout(this); });
        applyFullButtonMode();
    }

    function bindLampa() {
        if (lampaBound) return true;
        try {
            if (!Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return false;
            Lampa.Listener.follow('full', function (event) {
                if (event && event.type === 'complite') refresh();
            });
            lampaBound = true;
            return true;
        } catch (e) {
            return false;
        }
    }

    function start() {
        injectStyles();
        bindLampa();
        window.TranslationSubUi = { refresh: refresh, posterUrl: posterUrl };
        refresh();
        try {
            window.addEventListener('resize', refresh);
            window.addEventListener('orientationchange', refresh);
        } catch (e) {}
    }

    window.TranslationSubRuntime.onReady(start);
})();