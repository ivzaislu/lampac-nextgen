(function () {
    'use strict';

    if (window.__TranslationSubUiV2Started) return;
    window.__TranslationSubUiV2Started = true;

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

    function injectStyles() {
        if (document.getElementById('translationsub-ui-v2-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-ui-v2-style';
        style.textContent =
            '.translationsub-page{max-width:92em!important;padding:1.5em 1.7em 4em!important;box-sizing:border-box}' +
            '.translationsub-page__title{font-size:2.25em!important;font-weight:650!important;letter-spacing:-.025em;margin:0 0 .15em!important}' +
            '.translationsub-page__subtitle{font-size:.95em;opacity:.58!important;margin:0 0 .85em!important}' +
            '.translationsub-summary-v2{display:flex;align-items:center;gap:.55em;flex-wrap:wrap;margin:0 0 1.25em}' +
            '.translationsub-summary-v2__item{display:flex;align-items:center;gap:.42em;padding:.46em .72em;border-radius:2em;background:rgba(255,255,255,.085);font-size:.88em}' +
            '.translationsub-summary-v2__item b{font-weight:700}' +
            '.translationsub-summary-v2__item--new{background:rgba(255,125,55,.18)}' +
            '.translationsub-summary-v2__dot{width:.52em;height:.52em;border-radius:50%;background:rgba(255,255,255,.45)}' +
            '.translationsub-summary-v2__item--new .translationsub-summary-v2__dot{background:#ff8a4c}' +
            '.translationsub-toolbar{display:flex;gap:.65em!important;flex-wrap:wrap;margin-bottom:1.35em!important}' +
            '.translationsub-toolbar__item{padding:.72em 1.05em!important;border-radius:.8em!important;background:rgba(255,255,255,.075)!important;border:1px solid rgba(255,255,255,.055);font-size:.94em}' +
            '.translationsub-toolbar__item.focus{background:#fff!important;color:#111!important;border-color:#fff;transform:scale(1.035)}' +
            '.translationsub-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8em!important}' +
            '.translationsub-card{display:flex;align-items:stretch;min-height:10.2em!important;border-radius:1em!important;background:rgba(255,255,255,.068)!important;border:1px solid rgba(255,255,255,.045);overflow:hidden!important;position:relative;transition:transform .16s ease,background .16s ease,border-color .16s ease}' +
            '.translationsub-card.focus{background:#fff!important;color:#111!important;transform:scale(1.025)!important;border-color:#fff;z-index:3}' +
            '.translationsub-card--has-new{background:linear-gradient(115deg,rgba(255,132,61,.12),rgba(255,255,255,.065))!important;border-color:rgba(255,143,82,.16)}' +
            '.translationsub-card__poster{width:7em!important;min-width:7em!important;position:relative;background:rgba(0,0,0,.2)!important;overflow:hidden}' +
            '.translationsub-card__poster img{width:100%;height:100%;object-fit:cover;display:block}' +
            '.translationsub-card__body{padding:1em 1.05em 1.05em!important;min-width:0;display:flex;flex-direction:column;flex:1}' +
            '.translationsub-card__title{font-size:1.18em!important;font-weight:650!important;line-height:1.2;padding-right:4.4em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.translationsub-card__voice{display:inline-flex!important;align-self:flex-start;margin-top:.48em!important;padding:.28em .55em;border-radius:.5em;background:rgba(255,255,255,.09);font-size:.84em;font-weight:500;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.translationsub-card.focus .translationsub-card__voice{background:rgba(0,0,0,.075)}' +
            '.translationsub-card__meta{margin-top:.72em!important;font-size:.84em!important;opacity:1!important}' +
            '.translationsub-meta-v2{display:flex;flex-direction:column;gap:.48em}' +
            '.translationsub-meta-v2__row{display:flex;align-items:center;gap:.48em;flex-wrap:wrap}' +
            '.translationsub-meta-v2__pill{padding:.27em .5em;border-radius:.48em;background:rgba(255,255,255,.075);opacity:.78}' +
            '.translationsub-card.focus .translationsub-meta-v2__pill{background:rgba(0,0,0,.065)}' +
            '.translationsub-meta-v2__season{font-weight:700}' +
            '.translationsub-meta-v2__source{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;opacity:.5;font-size:.92em}' +
            '.translationsub-progress-v2{height:.34em;border-radius:1em;background:rgba(255,255,255,.1);overflow:hidden}' +
            '.translationsub-progress-v2>i{display:block;height:100%;border-radius:inherit;background:#67c997}' +
            '.translationsub-meta-v2__next{font-size:.94em;font-weight:600;color:#ffb07f}' +
            '.translationsub-meta-v2__ok{font-size:.94em;opacity:.55}' +
            '.translationsub-card__new{position:absolute;right:.72em!important;top:.72em!important;padding:.36em .58em!important;border-radius:.58em!important;background:#f36f3d!important;color:#fff;font-size:.68em!important;font-weight:700}' +
            '.translationsub-empty{grid-column:1/-1;padding:4em 1.5em!important;border-radius:1em;background:rgba(255,255,255,.045);font-size:1.05em;line-height:1.55}' +
            '.translationsub-layout--tv{max-width:none!important;width:100%!important;padding:1.15em 1.4em 3em!important}' +
            '.translationsub-layout--tv .translationsub-list{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:.82em 1em!important}' +
            '.translationsub-layout--tv .translationsub-card{min-height:8.8em!important;border-width:2px!important}' +
            '.translationsub-layout--tv .translationsub-card.focus{background:rgba(255,255,255,.16)!important;color:inherit!important;border-color:#fff!important;transform:scale(1.018)!important}' +
            '.translationsub-layout--tv .translationsub-card__poster{width:6.15em!important;min-width:6.15em!important}' +
            '.translationsub-layout--tv .translationsub-card__body{padding:.78em .88em!important;justify-content:center}' +
            '.translationsub-layout--tv .translationsub-card__title{font-size:1.08em!important}' +
            '.translationsub-layout--tv .translationsub-card__voice{font-size:.78em!important}' +
            '.translationsub-layout--tv .translationsub-card__meta{font-size:.77em!important;margin-top:.5em!important}' +
            '.translationsub-layout--mobile{padding:1em!important;max-width:none!important}' +
            '.translationsub-layout--mobile .translationsub-list{grid-template-columns:1fr!important;gap:.68em!important}' +
            '.translationsub-layout--mobile .translationsub-card{min-height:8.6em!important}' +
            '.translationsub-layout--mobile .translationsub-card__poster{width:5.8em!important;min-width:5.8em!important}' +
            '.translationsub-layout--mobile .translationsub-card__title{font-size:1.05em!important}' +
            '.translationsub-layout--mobile .translationsub-card__body{padding:.82em!important}';
        (document.head || document.documentElement).appendChild(style);
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
    }

    function start() {
        injectStyles();
        window.TranslationSubUi = { refresh: refresh, mode: layoutMode };
        refresh();
        try {
            window.addEventListener('resize', refresh);
            window.addEventListener('orientationchange', refresh);
        } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
