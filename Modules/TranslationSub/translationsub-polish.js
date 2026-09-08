(function () {
    'use strict';

    if (window.__TranslationSubPolishStarted) return;
    window.__TranslationSubPolishStarted = true;

    function injectStyles() {
        if (document.getElementById('translationsub-polish-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-polish-style';
        style.textContent =
            '.translationsub-notice .notice[data-translationsub-update]{' +
                'position:relative;border:1px solid rgba(255,132,70,.32);border-radius:.8em;' +
                'background:linear-gradient(110deg,rgba(255,126,61,.10),rgba(255,255,255,.035));overflow:hidden;' +
            '}' +
            '.translationsub-notice .notice[data-translationsub-update]:before{' +
                'content:"";position:absolute;left:0;top:0;bottom:0;width:.22em;background:#f47a42;opacity:.95;' +
            '}' +
            '.translationsub-notice .notice[data-translationsub-update] .notice__time{' +
                'display:inline-flex;align-items:center;justify-content:center;padding:.25em .52em;border-radius:.55em;' +
                'background:#f47a42;color:#fff;font-size:.8em;font-weight:700;line-height:1.2;white-space:nowrap;' +
            '}' +
            '.translationsub-notice .notice[data-translationsub-update] .notice__descr>div:first-child{' +
                'display:inline-flex;align-self:flex-start;padding:.2em .45em;border-radius:.4em;' +
                'background:rgba(255,255,255,.07);font-size:.92em;' +
            '}' +
            '.translationsub-notice .notice[data-translationsub-update] .notice__descr>div:nth-child(2){' +
                'margin-top:.28em;color:#ffb083;font-weight:500;' +
            '}' +
            '.translationsub-notice .notice[data-translationsub-update].focus{' +
                'border-color:#fff;background:#fff;color:#111;' +
            '}' +
            '.translationsub-notice .notice[data-translationsub-update].focus:before{background:#e9632c}' +
            '.translationsub-notice .notice[data-translationsub-update].focus .notice__time{background:#e9632c;color:#fff}' +
            '.translationsub-notice .notice[data-translationsub-update].focus .notice__descr>div:first-child{background:rgba(0,0,0,.07)}' +
            '.translationsub-notice .notice[data-translationsub-update].focus .notice__descr>div:nth-child(2){color:#b85020}' +
            '.translationsub-page__top{' +
                'display:flex;align-items:center;justify-content:flex-start;gap:.7em 1em;flex-wrap:wrap;margin:0 0 1.15em;' +
            '}' +
            '.translationsub-page__top .translationsub-summary-v2{margin:0!important}' +
            '.translationsub-page__top .translationsub-toolbar{margin:0!important}' +
            '.translationsub-page__top .translationsub-toolbar__item{margin:0!important}' +
            '@media(max-width:700px){' +
                '.translationsub-notice .notice[data-translationsub-update]{border-radius:.7em}' +
                '.translationsub-notice .notice[data-translationsub-update] .notice__time{font-size:.74em}' +
                '.translationsub-page__top{align-items:flex-start;gap:.65em;margin-bottom:.9em}' +
                '.translationsub-page__top .translationsub-toolbar{width:100%}' +
            '}';
        (document.head || document.documentElement).appendChild(style);
    }

    function cleanPage(root) {
        if (typeof $ !== 'function') return;
        root = root && root.jquery ? root : $(root);
        if (!root.length) return;

        root.find('.translationsub-page__title,.translationsub-page__subtitle').remove();

        var toolbar = root.find('.translationsub-toolbar').first();
        if (toolbar.length) {
            toolbar.find('.translationsub-toolbar__item').filter(function () {
                return String($(this).text() || '').indexOf('Обновить прогресс') !== -1;
            }).remove();
        }

        var top = root.find('.translationsub-page__top').first();
        if (!top.length) {
            top = $('<div class="translationsub-page__top"></div>');
            if (toolbar.length) toolbar.before(top);
            else root.prepend(top);
        }

        var summary = root.find('.translationsub-summary-v2').first();
        if (toolbar.length) top.append(toolbar.detach());
        if (summary.length) top.append(summary.detach());
    }

    function cleanPages() {
        if (typeof $ !== 'function') return;
        $('.translationsub-page').each(function () { cleanPage($(this)); });
    }

    function wrapUiRefresh() {
        try {
            var ui = window.TranslationSubUi;
            if (!ui || typeof ui.refresh !== 'function' || ui.__translationsubPolished) return false;

            var original = ui.refresh;
            ui.refresh = function () {
                original.apply(ui, arguments);
                cleanPages();
            };
            ui.__translationsubPolished = true;
            return true;
        } catch (e) {
            return false;
        }
    }

    function start() {
        injectStyles();

        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (wrapUiRefresh() || attempts > 20) {
                clearInterval(wait);
                cleanPages();
            }
        }, 100);

        wrapUiRefresh();
        cleanPages();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
