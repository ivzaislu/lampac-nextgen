(function () {
    'use strict';

    if (window.__TranslationSubLayoutV3Started) return;
    window.__TranslationSubLayoutV3Started = true;

    function injectStyles() {
        if (document.getElementById('translationsub-layout-v3-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-layout-v3-style';
        style.textContent =
            /* Общая композиция: меньше технической плотности, больше воздуха. */
            '.translationsub-page{' +
                'width:100%!important;max-width:112em!important;padding:1.35em 1.55em 5em!important;' +
            '}' +
            '.translationsub-page__top{' +
                'display:flex!important;align-items:center!important;gap:.7em!important;flex-wrap:wrap!important;' +
                'margin:0 0 1.05em!important;' +
            '}' +
            '.translationsub-page__top .translationsub-toolbar,' +
            '.translationsub-page__top .translationsub-summary-v2{margin:0!important}' +
            '.translationsub-toolbar__item{' +
                'min-height:2.65em;box-sizing:border-box;padding:.62em .95em!important;border-radius:.72em!important;' +
            '}' +
            '.translationsub-summary-v2{gap:.45em!important}' +
            '.translationsub-summary-v2__item{' +
                'padding:.39em .66em!important;font-size:.84em!important;line-height:1.25;' +
            '}' +

            /* На TV/desktop три узкие карточки хуже читаются, поэтому максимум две. */
            '.translationsub-list,' +
            '.translationsub-layout--tv .translationsub-list,' +
            '.translationsub-layout--desktop .translationsub-list{' +
                'display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;' +
                'gap:.9em 1em!important;align-items:stretch;' +
            '}' +
            '.translationsub-card{' +
                'min-height:11.2em!important;border-radius:.9em!important;' +
                'border:1px solid rgba(255,255,255,.075)!important;' +
                'background:rgba(255,255,255,.065)!important;' +
                'box-shadow:0 .18em .6em rgba(0,0,0,.08);' +
                'transform:none!important;' +
            '}' +
            '.translationsub-card--has-new{' +
                'border-color:rgba(244,122,66,.42)!important;' +
                'background:linear-gradient(115deg,rgba(244,122,66,.12),rgba(255,255,255,.055))!important;' +
            '}' +
            '.translationsub-card.focus{' +
                'transform:scale(1.012)!important;z-index:3;' +
            '}' +
            '.translationsub-layout--tv .translationsub-card.focus{' +
                'background:rgba(255,255,255,.15)!important;color:inherit!important;border-color:#fff!important;' +
            '}' +
            '.translationsub-card__poster{' +
                'width:7.5em!important;min-width:7.5em!important;' +
            '}' +
            '.translationsub-card__body{' +
                'padding:.92em 1.02em!important;justify-content:flex-start!important;' +
            '}' +
            '.translationsub-card__title{' +
                'font-size:1.22em!important;line-height:1.18!important;font-weight:700!important;' +
                'padding-right:5.2em!important;' +
            '}' +
            '.translationsub-card__voice{' +
                'margin-top:.38em!important;padding:.22em .48em!important;font-size:.82em!important;' +
                'border-radius:.42em!important;opacity:.86;' +
            '}' +
            '.translationsub-card__meta{' +
                'margin-top:.58em!important;font-size:.86em!important;min-width:0;' +
            '}' +
            '.translationsub-meta-v2{gap:.34em!important;min-width:0}' +
            '.translationsub-meta-v2__row{gap:.38em!important;flex-wrap:nowrap!important;min-width:0}' +
            '.translationsub-meta-v2__season{' +
                'flex:0 0 auto;font-size:1.02em;' +
            '}' +
            '.translationsub-meta-v2__pill{' +
                'padding:.21em .44em!important;border-radius:.42em!important;white-space:nowrap;' +
            '}' +
            '.translationsub-progress-v2{' +
                'height:.28em!important;margin:.04em 0 .02em;' +
            '}' +
            '.translationsub-meta-v2__next{' +
                'font-size:.91em!important;line-height:1.25;' +
            '}' +
            '.translationsub-meta-v2__ok{' +
                'font-size:.9em!important;line-height:1.25;' +
            '}' +
            '.translationsub-meta-v2__source{' +
                'font-size:.82em!important;line-height:1.2;opacity:.48!important;' +
                'white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;' +
            '}' +
            '.translationsub-card__new{' +
                'right:.62em!important;top:.6em!important;padding:.31em .5em!important;' +
                'font-size:.66em!important;border-radius:.5em!important;' +
            '}' +

            /* TMDB остаётся полезным, но визуально становится вторичным статусом. */
            '.translationsub-tmdb-v2{' +
                'margin-top:.18em!important;padding-top:.42em!important;' +
                'border-top:1px solid rgba(255,255,255,.075)!important;' +
                'font-size:.79em!important;line-height:1.28!important;min-width:0;' +
            '}' +
            '.translationsub-card.focus .translationsub-tmdb-v2{' +
                'border-top-color:rgba(0,0,0,.1)!important;' +
            '}' +
            '.translationsub-layout--tv .translationsub-card.focus .translationsub-tmdb-v2{' +
                'border-top-color:rgba(255,255,255,.12)!important;' +
            '}' +
            '.translationsub-tmdb-v2__facts{' +
                'display:flex!important;align-items:center!important;gap:.3em!important;flex-wrap:nowrap!important;' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.58!important;' +
            '}' +
            '.translationsub-tmdb-v2__facts>*{flex:0 0 auto}' +
            '.translationsub-tmdb-v2__state{' +
                'margin-top:.16em!important;font-size:.96em;line-height:1.2;' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
            '}' +

            /* TV: крупнее, без третьей колонки даже на 4K/широком viewport. */
            '.translationsub-layout--tv{' +
                'max-width:none!important;padding:1.3em 1.55em 5em!important;' +
            '}' +
            '.translationsub-layout--tv .translationsub-card{' +
                'min-height:11.4em!important;border-width:2px!important;' +
            '}' +
            '.translationsub-layout--tv .translationsub-card__poster{' +
                'width:7.35em!important;min-width:7.35em!important;' +
            '}' +
            '.translationsub-layout--tv .translationsub-card__body{' +
                'padding:.9em 1em!important;' +
            '}' +
            '.translationsub-layout--tv .translationsub-card__title{' +
                'font-size:1.18em!important;' +
            '}' +
            '.translationsub-layout--tv .translationsub-card__meta{' +
                'font-size:.84em!important;' +
            '}' +

            /* Телефон: одна колонка, меньше вертикального шума и запас под нижнюю панель Lampa. */
            '.translationsub-layout--mobile{' +
                'width:100%!important;max-width:none!important;' +
                'padding:.85em .85em calc(9.5em + env(safe-area-inset-bottom,0px))!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-page__top{' +
                'display:grid!important;grid-template-columns:1fr!important;gap:.55em!important;margin-bottom:.75em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-toolbar{' +
                'width:100%!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-toolbar__item{' +
                'width:100%!important;justify-content:center!important;min-height:2.75em;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-summary-v2{' +
                'width:100%!important;display:flex!important;gap:.42em!important;margin:0!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-summary-v2__item{' +
                'font-size:.8em!important;padding:.36em .58em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-list{' +
                'grid-template-columns:1fr!important;gap:.68em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-card{' +
                'min-height:10.8em!important;border-radius:.78em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-card__poster{' +
                'width:6.15em!important;min-width:6.15em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-card__body{' +
                'padding:.72em .78em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-card__title{' +
                'font-size:1.05em!important;padding-right:4.7em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-card__voice{' +
                'font-size:.74em!important;margin-top:.3em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-card__meta{' +
                'font-size:.76em!important;margin-top:.44em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-meta-v2{gap:.26em!important}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__row{' +
                'gap:.28em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__pill{' +
                'padding:.18em .34em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-progress-v2{' +
                'height:.24em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__next,' +
            '.translationsub-layout--mobile .translationsub-meta-v2__ok{' +
                'font-size:.88em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__source{' +
                'font-size:.78em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-tmdb-v2{' +
                'font-size:.72em!important;padding-top:.32em!important;margin-top:.1em!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-tmdb-v2__facts{' +
                'display:block!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-tmdb-v2__sep{margin:0 .18em}' +
            '.translationsub-layout--mobile .translationsub-tmdb-v2__state{' +
                'margin-top:.12em!important;font-size:.94em;' +
            '}' +
            '.translationsub-layout--mobile .translationsub-card__new{' +
                'right:.48em!important;top:.46em!important;font-size:.61em!important;' +
            '}' +

            /* Очень узкие телефоны: не даём pill-ам разломать карточку. */
            '@media(max-width:390px){' +
                '.translationsub-layout--mobile .translationsub-card__poster{width:5.5em!important;min-width:5.5em!important}' +
                '.translationsub-layout--mobile .translationsub-card__body{padding:.65em!important}' +
                '.translationsub-layout--mobile .translationsub-meta-v2__row{flex-wrap:wrap!important}' +
                '.translationsub-layout--mobile .translationsub-card__title{font-size:1em!important}' +
            '}';

        (document.head || document.documentElement).appendChild(style);
    }

    function refresh() {
        injectStyles();
        try {
            if (window.TranslationSubUi && typeof window.TranslationSubUi.refresh === 'function')
                window.TranslationSubUi.refresh();
        } catch (e) {}
    }

    function start() {
        injectStyles();
        setTimeout(refresh, 0);
        setTimeout(refresh, 250);

        try {
            window.addEventListener('resize', refresh);
            window.addEventListener('orientationchange', refresh);
        } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
