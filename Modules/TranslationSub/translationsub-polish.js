(function () {
    'use strict';

    if (window.__TranslationSubPolishStarted) return;
    window.__TranslationSubPolishStarted = true;

    function outlineBellSvg() {
        return '<svg class="translationsub-settings-bell" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M18 8.5a6 6 0 0 0-12 0c0 7-3 7-3 8.5h18c0-1.5-3-1.5-3-8.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M9.7 20a2.5 2.5 0 0 0 4.6 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
        '</svg>';
    }

    function injectStyles() {
        if (document.getElementById('translationsub-polish-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-polish-style';
        style.textContent =
            /* Шторка: тот же язык, что и у полной страницы подписок. */
            '.translationsub-notice .notice[data-translationsub-update]{' +
                'position:relative;' +
                'border:1px solid rgba(255,132,70,.32);' +
                'border-radius:.8em;' +
                'background:linear-gradient(110deg,rgba(255,126,61,.10),rgba(255,255,255,.035));' +
                'overflow:hidden;' +
            '}' +
            '.translationsub-notice .notice[data-translationsub-update]:before{' +
                'content:"";position:absolute;left:0;top:0;bottom:0;width:.22em;background:#f47a42;opacity:.95;' +
            '}' +
            '.translationsub-notice .notice[data-translationsub-update] .notice__time{' +
                'display:inline-flex;align-items:center;justify-content:center;' +
                'padding:.25em .52em;border-radius:.55em;background:#f47a42;color:#fff;' +
                'font-size:.8em;font-weight:700;line-height:1.2;white-space:nowrap;' +
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

            /* Аккуратная outline-иконка раздела TranslationSub в настройках. */
            '.translationsub-settings-bell{width:1.35em!important;height:1.35em!important;display:block;fill:none!important;color:currentColor}' +
            '[data-component="translationsub_settings"] .translationsub-settings-bell{opacity:.9}' +

            '@media(max-width:700px){' +
                '.translationsub-notice .notice[data-translationsub-update]{border-radius:.7em}' +
                '.translationsub-notice .notice[data-translationsub-update] .notice__time{font-size:.74em}' +
            '}';

        (document.head || document.documentElement).appendChild(style);
    }

    function isTranslationSubRow(node) {
        if (!node || !node.length) return false;
        if (String(node.attr('data-component') || '') === 'translationsub_settings') return true;
        var text = String(node.text() || '').replace(/\s+/g, ' ').trim();
        return text.indexOf('Подписки на озвучки') !== -1;
    }

    function patchSettingsIcon() {
        if (typeof $ !== 'function') return false;

        var rows = $('[data-component="translationsub_settings"]');
        if (!rows.length) {
            rows = $('.settings-folder,.settings-param,.settings__item,.selector').filter(function () {
                return isTranslationSubRow($(this));
            });
        }

        var patched = false;
        rows.each(function () {
            var row = $(this);
            if (!isTranslationSubRow(row)) return;
            if (row.attr('data-translationsub-icon-patched') === '1') return;

            var holder = row.find('.settings-folder__icon,.settings-param__icon,.settings__icon,.settings__ico,.menu__ico').first();
            if (holder.length) {
                holder.html(outlineBellSvg());
                row.attr('data-translationsub-icon-patched', '1');
                patched = true;
                return;
            }

            var svg = row.find('svg').first();
            if (svg.length) {
                svg.replaceWith(outlineBellSvg());
                row.attr('data-translationsub-icon-patched', '1');
                patched = true;
            }
        });

        return patched;
    }

    function scheduleSettingsPatch() {
        [0, 80, 220, 500].forEach(function (delay) {
            setTimeout(patchSettingsIcon, delay);
        });
    }

    function bindSettingsEntry() {
        if (typeof $ !== 'function') return;

        // Не держим глобальный MutationObserver: патчим только при фактическом входе в настройки.
        $(document)
            .off('hover:enter.translationsubPolish click.translationsubPolish', '[data-action="settings"],.head__action.settings,.settings-button')
            .on('hover:enter.translationsubPolish click.translationsubPolish', '[data-action="settings"],.head__action.settings,.settings-button', function () {
                scheduleSettingsPatch();
            });
    }

    function start() {
        if (!window.Lampa) return;
        injectStyles();
        bindSettingsEntry();
        scheduleSettingsPatch();

        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') {
                        bindSettingsEntry();
                        scheduleSettingsPatch();
                    }
                });
            }
        } catch (e) {}
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
