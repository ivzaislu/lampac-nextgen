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
            var tv = /android tv|google tv|googletv|mibox|mitv|smarttv|smart tv|tizen|webos/.test(ua);
            if (tv) return 'tv';
            if (/iphone|ipad|android/.test(ua) && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) return 'mobile';
        } catch (e2) {}

        return 'desktop';
    }

    function applyLayoutClass(root) {
        var mode = layoutMode();
        root.removeClass('translationsub-layout--tv translationsub-layout--mobile translationsub-layout--desktop');
        root.addClass('translationsub-layout--' + mode);
        root.attr('data-translationsub-layout', mode);
        return mode;
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
            '.translationsub-summary-v2__item--new .translationsub-summary-v2__dot{background:#ff8a4c;box-shadow:0 0 0 .22em rgba(255,138,76,.12)}' +
            '.translationsub-toolbar{display:flex;gap:.65em!important;flex-wrap:wrap;margin-bottom:1.35em!important}' +
            '.translationsub-toolbar__item{padding:.72em 1.05em!important;border-radius:.8em!important;background:rgba(255,255,255,.075)!important;border:1px solid rgba(255,255,255,.055);font-size:.94em;transition:transform .15s ease,background .15s ease,border-color .15s ease}' +
            '.translationsub-toolbar__item.focus{background:#fff!important;color:#111!important;border-color:#fff;transform:scale(1.035);box-shadow:0 .5em 1.5em rgba(0,0,0,.18)}' +
            '.translationsub-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8em!important}' +
            '.translationsub-card{display:flex;align-items:stretch;min-height:10.2em!important;border-radius:1em!important;background:rgba(255,255,255,.068)!important;border:1px solid rgba(255,255,255,.045);overflow:hidden!important;position:relative;transition:transform .16s ease,background .16s ease,box-shadow .16s ease,border-color .16s ease}' +
            '.translationsub-card.focus{background:#fff!important;color:#111!important;transform:scale(1.025)!important;border-color:#fff;box-shadow:0 .8em 2.4em rgba(0,0,0,.28);z-index:3}' +
            '.translationsub-card--has-new{background:linear-gradient(115deg,rgba(255,132,61,.12),rgba(255,255,255,.065))!important;border-color:rgba(255,143,82,.16)}' +
            '.translationsub-card--has-new.focus{background:#fff!important;border-color:#fff}' +
            '.translationsub-card__poster{width:7em!important;min-width:7em!important;position:relative;background:rgba(0,0,0,.2)!important;overflow:hidden}' +
            '.translationsub-card__poster:after{content:"";position:absolute;inset:0;box-shadow:inset -.9em 0 1.4em rgba(0,0,0,.12);pointer-events:none}' +
            '.translationsub-card__poster img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s ease}' +
            '.translationsub-card.focus .translationsub-card__poster img{transform:scale(1.04)}' +
            '.translationsub-card__body{padding:1em 1.05em 1.05em!important;min-width:0;display:flex;flex-direction:column;justify-content:flex-start!important;flex:1}' +
            '.translationsub-card__title{font-size:1.18em!important;font-weight:650!important;line-height:1.2;padding-right:4.4em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.translationsub-card__voice{display:inline-flex!important;align-self:flex-start;margin-top:.48em!important;padding:.28em .55em;border-radius:.5em;background:rgba(255,255,255,.09);font-size:.84em;font-weight:500;opacity:.88!important;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.translationsub-card.focus .translationsub-card__voice{background:rgba(0,0,0,.075)}' +
            '.translationsub-card__meta{margin-top:.72em!important;font-size:.84em!important;opacity:1!important}' +
            '.translationsub-meta-v2{display:flex;flex-direction:column;gap:.48em}' +
            '.translationsub-meta-v2__row{display:flex;align-items:center;gap:.48em;flex-wrap:wrap}' +
            '.translationsub-meta-v2__pill{padding:.27em .5em;border-radius:.48em;background:rgba(255,255,255,.075);opacity:.78}' +
            '.translationsub-card.focus .translationsub-meta-v2__pill{background:rgba(0,0,0,.065);opacity:.8}' +
            '.translationsub-meta-v2__pill b{font-weight:700;opacity:1}' +
            '.translationsub-meta-v2__season{font-weight:700;opacity:.92}' +
            '.translationsub-meta-v2__source{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;opacity:.5;font-size:.92em}' +
            '.translationsub-card.focus .translationsub-meta-v2__source{opacity:.58}' +
            '.translationsub-progress-v2{height:.34em;border-radius:1em;background:rgba(255,255,255,.1);overflow:hidden;position:relative}' +
            '.translationsub-progress-v2>i{display:block;height:100%;border-radius:inherit;background:#67c997;min-width:0;transition:width .25s ease}' +
            '.translationsub-card.focus .translationsub-progress-v2{background:rgba(0,0,0,.1)}' +
            '.translationsub-card.focus .translationsub-progress-v2>i{background:#24965f}' +
            '.translationsub-meta-v2__next{font-size:.94em;font-weight:600;color:#ffb07f}' +
            '.translationsub-card.focus .translationsub-meta-v2__next{color:#b64b14}' +
            '.translationsub-meta-v2__ok{font-size:.94em;opacity:.55}' +
            '.translationsub-card__new{position:absolute;right:.72em!important;top:.72em!important;padding:.36em .58em!important;border-radius:.58em!important;background:#f36f3d!important;color:#fff;box-shadow:0 .3em .9em rgba(0,0,0,.15);font-size:.68em!important;font-weight:700;letter-spacing:.03em}' +
            '.translationsub-card.focus .translationsub-card__new{background:#e45e2c!important;color:#fff!important}' +
            '.translationsub-empty{grid-column:1/-1;padding:4em 1.5em!important;border-radius:1em;background:rgba(255,255,255,.045);font-size:1.05em;line-height:1.55}' +

            /* Android TV / TV-box: не полагаться на CSS viewport — он часто около 960px. */
            '.translationsub-layout--tv{max-width:none!important;width:100%!important;padding:1.15em 1.4em 3em!important}' +
            '.translationsub-layout--tv .translationsub-page__title{font-size:1.85em!important;margin-bottom:.12em!important}' +
            '.translationsub-layout--tv .translationsub-page__subtitle{font-size:.9em!important;margin-bottom:.7em!important}' +
            '.translationsub-layout--tv .translationsub-summary-v2{margin-bottom:1em!important;gap:.5em}' +
            '.translationsub-layout--tv .translationsub-summary-v2__item{font-size:.86em;padding:.42em .68em}' +
            '.translationsub-layout--tv .translationsub-toolbar{margin-bottom:1.05em!important}' +
            '.translationsub-layout--tv .translationsub-toolbar__item{font-size:.92em!important;padding:.64em .9em!important}' +
            '.translationsub-layout--tv .translationsub-toolbar__item.focus{background:rgba(255,255,255,.18)!important;color:inherit!important;border-color:#fff!important;box-shadow:0 0 0 .08em rgba(255,255,255,.25),0 .45em 1.2em rgba(0,0,0,.2);transform:scale(1.025)}' +
            '.translationsub-layout--tv .translationsub-list{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:.82em 1em!important}' +
            '.translationsub-layout--tv .translationsub-card{min-height:8.8em!important;border-width:2px!important;border-color:rgba(255,255,255,.055)!important;border-radius:.9em!important}' +
            '.translationsub-layout--tv .translationsub-card.focus{background:rgba(255,255,255,.16)!important;color:inherit!important;border-color:#fff!important;transform:scale(1.018)!important;box-shadow:0 0 0 .08em rgba(255,255,255,.16),0 .65em 1.8em rgba(0,0,0,.28)!important}' +
            '.translationsub-layout--tv .translationsub-card--has-new.focus{background:linear-gradient(115deg,rgba(255,135,69,.24),rgba(255,255,255,.15))!important}' +
            '.translationsub-layout--tv .translationsub-card__poster{width:6.15em!important;min-width:6.15em!important}' +
            '.translationsub-layout--tv .translationsub-card__body{padding:.78em .88em .78em!important;justify-content:center!important}' +
            '.translationsub-layout--tv .translationsub-card__title{font-size:1.08em!important;padding-right:3.8em}' +
            '.translationsub-layout--tv .translationsub-card__voice{font-size:.78em!important;margin-top:.36em!important;padding:.23em .46em}' +
            '.translationsub-layout--tv .translationsub-card.focus .translationsub-card__voice{background:rgba(255,255,255,.11)!important}' +
            '.translationsub-layout--tv .translationsub-card__meta{font-size:.77em!important;margin-top:.5em!important}' +
            '.translationsub-layout--tv .translationsub-meta-v2{gap:.34em}' +
            '.translationsub-layout--tv .translationsub-meta-v2__row{gap:.32em;flex-wrap:nowrap}' +
            '.translationsub-layout--tv .translationsub-meta-v2__pill{padding:.22em .38em;white-space:nowrap}' +
            '.translationsub-layout--tv .translationsub-card.focus .translationsub-meta-v2__pill{background:rgba(255,255,255,.1)!important;opacity:.9}' +
            '.translationsub-layout--tv .translationsub-progress-v2{height:.28em}' +
            '.translationsub-layout--tv .translationsub-card.focus .translationsub-progress-v2{background:rgba(255,255,255,.14)!important}' +
            '.translationsub-layout--tv .translationsub-card.focus .translationsub-progress-v2>i{background:#76e0ae!important}' +
            '.translationsub-layout--tv .translationsub-meta-v2__next{font-size:.9em;color:#ffc59e}' +
            '.translationsub-layout--tv .translationsub-card.focus .translationsub-meta-v2__next{color:#ffd7bc!important}' +
            '.translationsub-layout--tv .translationsub-meta-v2__source{font-size:.86em;opacity:.48}' +
            '.translationsub-layout--tv .translationsub-card.focus .translationsub-meta-v2__source{opacity:.72}' +
            '.translationsub-layout--tv .translationsub-card__new{right:.52em!important;top:.52em!important;font-size:.61em!important;padding:.3em .45em!important}' +

            /* Телефон / планшет с touch. */
            '.translationsub-layout--mobile{padding:1em!important;max-width:none!important}' +
            '.translationsub-layout--mobile .translationsub-page__title{font-size:1.7em!important}' +
            '.translationsub-layout--mobile .translationsub-list{grid-template-columns:1fr!important;gap:.68em!important}' +
            '.translationsub-layout--mobile .translationsub-card{min-height:8.6em!important}' +
            '.translationsub-layout--mobile .translationsub-card__poster{width:5.8em!important;min-width:5.8em!important}' +
            '.translationsub-layout--mobile .translationsub-card__title{padding-right:3.8em;font-size:1.05em!important}' +
            '.translationsub-layout--mobile .translationsub-card__body{padding:.82em!important}' +
            '.translationsub-layout--mobile .translationsub-meta-v2__row{gap:.34em}' +
            '.translationsub-layout--mobile .translationsub-summary-v2{margin-bottom:1em}' +

            '@media(min-width:1500px){.translationsub-layout--tv .translationsub-list{grid-template-columns:repeat(3,minmax(0,1fr))!important}}';

        (document.head || document.documentElement).appendChild(style);
    }

    function parseNumber(text, expression) {
        var match = String(text || '').match(expression);
        return match ? Number(match[1] || 0) : 0;
    }

    function sourceFromMeta(text) {
        var parts = String(text || '').split(/\s+·\s+/);
        for (var i = parts.length - 1; i >= 0; i--) {
            var part = String(parts[i] || '').trim();
            if (!part) continue;
            if (/^S\d+$/i.test(part)) continue;
            if (/^просмотрено\s+E\d+/i.test(part)) continue;
            if (/^озвучка\s+до\s+E\d+/i.test(part)) continue;
            if (/^доступны\s+E\d+/i.test(part)) continue;
            return part;
        }
        return '';
    }

    function enhanceCard(card) {
        var node = $(card);
        if (node.attr('data-translationsub-ui-v2') === '1') return;

        var meta = node.find('.translationsub-card__meta').first();
        if (!meta.length) return;

        var text = meta.text();
        var season = parseNumber(text, /S(\d+)/i) || 1;
        var watched = parseNumber(text, /просмотрено\s+E(\d+)/i);
        var available = parseNumber(text, /озвучка\s+до\s+E(\d+)/i);
        var source = sourceFromMeta(text);
        var newCount = Math.max(0, available - watched);
        var ratio = available > 0 ? Math.max(0, Math.min(100, Math.round((watched / available) * 100))) : 0;

        var html = '<div class="translationsub-meta-v2">' +
            '<div class="translationsub-meta-v2__row">' +
                '<span class="translationsub-meta-v2__season">S' + season + '</span>' +
                '<span class="translationsub-meta-v2__pill">Просмотрено <b>E' + watched + '</b></span>' +
                '<span class="translationsub-meta-v2__pill">В озвучке <b>E' + available + '</b></span>' +
            '</div>' +
            '<div class="translationsub-progress-v2"><i style="width:' + ratio + '%"></i></div>';

        if (newCount > 0) {
            html += '<div class="translationsub-meta-v2__next">Можно смотреть E' + (watched + 1) + (available > watched + 1 ? '–E' + available : '') + '</div>';
            node.addClass('translationsub-card--has-new');
        } else {
            html += '<div class="translationsub-meta-v2__ok">Новых серий пока нет</div>';
            node.removeClass('translationsub-card--has-new');
        }

        if (source) html += '<div class="translationsub-meta-v2__source">' + $('<div>').text(source).html() + '</div>';
        html += '</div>';

        meta.html(html);
        node.attr('data-translationsub-new-count', String(newCount));
        node.attr('data-translationsub-ui-v2', '1');
    }

    function enhancePage(page) {
        var root = $(page);
        applyLayoutClass(root);

        var cards = root.find('.translationsub-card');
        cards.each(function () { enhanceCard(this); });

        var total = cards.length;
        var withNew = 0;
        cards.each(function () {
            if (Number($(this).attr('data-translationsub-new-count') || 0) > 0) withNew++;
        });

        var subtitle = root.find('.translationsub-page__subtitle').first();
        var subtitleText = 'Прогресс просмотра синхронизируется с Lampa';
        if (subtitle.length && subtitle.text() !== subtitleText) subtitle.text(subtitleText);

        var summary = root.find('.translationsub-summary-v2').first();
        if (total > 0 && !summary.length) {
            summary = $('<div class="translationsub-summary-v2"></div>');
            summary.append('<div class="translationsub-summary-v2__item"><span class="translationsub-summary-v2__dot"></span><span>Подписок <b class="translationsub-summary-v2__total">' + total + '</b></span></div>');
            summary.append('<div class="translationsub-summary-v2__item translationsub-summary-v2__item--new"><span class="translationsub-summary-v2__dot"></span><span>С новыми сериями <b class="translationsub-summary-v2__new">' + withNew + '</b></span></div>');
            subtitle.after(summary);
        } else if (summary.length) {
            var totalNode = summary.find('.translationsub-summary-v2__total');
            var newNode = summary.find('.translationsub-summary-v2__new');
            if (totalNode.text() !== String(total)) totalNode.text(total);
            if (newNode.text() !== String(withNew)) newNode.text(withNew);
        }

        var list = root.find('.translationsub-list').first();
        if (list.length && cards.length > 1) {
            var current = list.children('.translationsub-card').get();
            var sorted = cards.get().sort(function (a, b) {
                return Number($(b).attr('data-translationsub-new-count') || 0) - Number($(a).attr('data-translationsub-new-count') || 0);
            });
            var changed = sorted.some(function (card, index) { return current[index] !== card; });
            if (changed) sorted.forEach(function (card) { list.append(card); });
        }
    }

    var enhanceTimer = null;

    function enhanceAll() {
        clearTimeout(enhanceTimer);
        enhanceTimer = setTimeout(function () {
            $('.translationsub-page').each(function () { enhancePage(this); });
        }, 25);
    }

    function start() {
        injectStyles();
        enhanceAll();

        try {
            var observer = new MutationObserver(function () { enhanceAll(); });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e) {
            setInterval(enhanceAll, 1200);
        }

        try {
            window.addEventListener('resize', enhanceAll);
            window.addEventListener('orientationchange', enhanceAll);
        } catch (e2) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
