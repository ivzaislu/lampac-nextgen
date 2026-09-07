(function () {
    'use strict';

    if (window.__TranslationSubUiV2Started) return;
    window.__TranslationSubUiV2Started = true;

    function injectStyles() {
        if (document.getElementById('translationsub-ui-v2-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-ui-v2-style';
        style.textContent =
            '.translationsub-page{max-width:92em!important;padding:1.5em 1.7em 4em!important}' +
            '.translationsub-page__title{font-size:2.25em!important;font-weight:650!important;letter-spacing:-.025em;margin:0 0 .15em!important}' +
            '.translationsub-page__subtitle{font-size:.95em;opacity:.58!important;margin:0 0 .85em!important}' +
            '.translationsub-summary-v2{display:flex;align-items:center;gap:.55em;flex-wrap:wrap;margin:0 0 1.25em}' +
            '.translationsub-summary-v2__item{display:flex;align-items:center;gap:.42em;padding:.46em .72em;border-radius:2em;background:rgba(255,255,255,.085);font-size:.88em}' +
            '.translationsub-summary-v2__item b{font-weight:700}' +
            '.translationsub-summary-v2__item--new{background:rgba(255,125,55,.18)}' +
            '.translationsub-summary-v2__dot{width:.52em;height:.52em;border-radius:50%;background:rgba(255,255,255,.45)}' +
            '.translationsub-summary-v2__item--new .translationsub-summary-v2__dot{background:#ff8a4c;box-shadow:0 0 0 .22em rgba(255,138,76,.12)}' +
            '.translationsub-toolbar{gap:.65em!important;margin-bottom:1.35em!important}' +
            '.translationsub-toolbar__item{padding:.72em 1.05em!important;border-radius:.8em!important;background:rgba(255,255,255,.075)!important;border:1px solid rgba(255,255,255,.055);font-size:.94em;transition:transform .15s ease,background .15s ease}' +
            '.translationsub-toolbar__item.focus{background:#fff!important;color:#111!important;border-color:#fff;transform:scale(1.035);box-shadow:0 .5em 1.5em rgba(0,0,0,.18)}' +
            '.translationsub-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8em!important}' +
            '.translationsub-card{min-height:10.2em!important;border-radius:1em!important;background:rgba(255,255,255,.068)!important;border:1px solid rgba(255,255,255,.045);overflow:hidden!important;transition:transform .16s ease,background .16s ease,box-shadow .16s ease,border-color .16s ease}' +
            '.translationsub-card.focus{background:#fff!important;color:#111!important;transform:scale(1.025)!important;border-color:#fff;box-shadow:0 .8em 2.4em rgba(0,0,0,.28);z-index:3}' +
            '.translationsub-card--has-new{background:linear-gradient(115deg,rgba(255,132,61,.12),rgba(255,255,255,.065))!important;border-color:rgba(255,143,82,.16)}' +
            '.translationsub-card--has-new.focus{background:#fff!important;border-color:#fff}' +
            '.translationsub-card__poster{width:7em!important;min-width:7em!important;position:relative;background:rgba(0,0,0,.2)!important}' +
            '.translationsub-card__poster:after{content:"";position:absolute;inset:0;box-shadow:inset -.9em 0 1.4em rgba(0,0,0,.12);pointer-events:none}' +
            '.translationsub-card__poster img{transition:transform .2s ease}' +
            '.translationsub-card.focus .translationsub-card__poster img{transform:scale(1.04)}' +
            '.translationsub-card__body{padding:1em 1.05em 1.05em!important;justify-content:flex-start!important;flex:1}' +
            '.translationsub-card__title{font-size:1.18em!important;font-weight:650!important;line-height:1.2;padding-right:4.4em}' +
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
            '.translationsub-card__new{right:.72em!important;top:.72em!important;padding:.36em .58em!important;border-radius:.58em!important;background:#f36f3d!important;box-shadow:0 .3em .9em rgba(0,0,0,.15);font-size:.68em!important;letter-spacing:.03em}' +
            '.translationsub-card.focus .translationsub-card__new{background:#e45e2c!important;color:#fff!important}' +
            '.translationsub-empty{grid-column:1/-1;padding:4em 1.5em!important;border-radius:1em;background:rgba(255,255,255,.045);font-size:1.05em;line-height:1.55}' +
            '@media(max-width:1050px){.translationsub-list{grid-template-columns:1fr!important}}' +
            '@media(max-width:700px){.translationsub-page{padding:1em!important}.translationsub-page__title{font-size:1.7em!important}.translationsub-card{min-height:8.6em!important}.translationsub-card__poster{width:5.8em!important;min-width:5.8em!important}.translationsub-card__title{padding-right:3.8em;font-size:1.05em!important}.translationsub-card__body{padding:.82em!important}.translationsub-meta-v2__row{gap:.34em}.translationsub-summary-v2{margin-bottom:1em}}';

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
        var cards = root.find('.translationsub-card');

        cards.each(function () { enhanceCard(this); });

        var total = cards.length;
        var withNew = 0;
        cards.each(function () {
            if (Number($(this).attr('data-translationsub-new-count') || 0) > 0) withNew++;
        });

        var subtitle = root.find('.translationsub-page__subtitle').first();
        if (subtitle.length) subtitle.text('Прогресс просмотра синхронизируется с Lampa');

        if (total > 0 && !root.find('.translationsub-summary-v2').length) {
            var summary = $('<div class="translationsub-summary-v2"></div>');
            summary.append('<div class="translationsub-summary-v2__item"><span class="translationsub-summary-v2__dot"></span><span>Подписок <b>' + total + '</b></span></div>');
            summary.append('<div class="translationsub-summary-v2__item translationsub-summary-v2__item--new"><span class="translationsub-summary-v2__dot"></span><span>С новыми сериями <b>' + withNew + '</b></span></div>');
            subtitle.after(summary);
        }

        var list = root.find('.translationsub-list').first();
        if (list.length && cards.length > 1) {
            var sorted = cards.get().sort(function (a, b) {
                return Number($(b).attr('data-translationsub-new-count') || 0) - Number($(a).attr('data-translationsub-new-count') || 0);
            });
            sorted.forEach(function (card) { list.append(card); });
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
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
