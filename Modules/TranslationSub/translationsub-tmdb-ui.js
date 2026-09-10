(function () {
    'use strict';

    if (window.__TranslationSubTmdbUiStarted) return;
    window.__TranslationSubTmdbUiStarted = true;

    function escapeHtml(value) {
        try {
            if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.escape === 'function')
                return Lampa.Utils.escape(String(value || ''));
        } catch (e) {}
        return String(value || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function formatDate(value) {
        if (!value) return '';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '';
        try {
            return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
        } catch (e) {
            var month = date.getMonth() + 1;
            return date.getDate() + '.' + (month < 10 ? '0' : '') + month;
        }
    }

    function decorateCard(card) {
        var node = $(card);
        var item = node.data('translationsubTmdbItem');
        if (!item) return;

        var meta = node.find('.translationsub-meta-v2').first();
        if (!meta.length) return;

        meta.find('.translationsub-tmdb-v2').remove();

        var tmdb = item.tmdb && typeof item.tmdb === 'object' ? item.tmdb : {};
        var schedule = item.schedule && typeof item.schedule === 'object' ? item.schedule : null;
        var season = Number(item.season || 1) || 1;
        var aired = Number(tmdb.targetSeasonEpisodes || 0) || 0;
        var nextSeason = Number(tmdb.nextSeason || 0) || 0;
        var nextEpisode = Number(tmdb.nextEpisode || 0) || 0;
        var nextDate = formatDate(tmdb.nextAirDate);
        var parts = [];

        if (aired > 0)
            parts.push('<span class="translationsub-tmdb-v2__air">TMDB · вышло S' + season + 'E' + aired + '</span>');

        if (nextDate && nextSeason > 0 && nextEpisode > 0)
            parts.push('<span class="translationsub-tmdb-v2__next">Следующая S' + nextSeason + 'E' + nextEpisode + ' · ' + escapeHtml(nextDate) + '</span>');

        if (!parts.length && tmdb.status)
            parts.push('<span class="translationsub-tmdb-v2__air">TMDB · ' + escapeHtml(tmdb.status) + '</span>');

        if (!parts.length && !(schedule && schedule.text)) return;

        var row = $('<div class="translationsub-tmdb-v2"></div>');
        if (parts.length)
            row.append('<div class="translationsub-tmdb-v2__facts">' + parts.join('<span class="translationsub-tmdb-v2__sep">•</span>') + '</div>');

        if (schedule && schedule.text) {
            var type = String(schedule.type || 'plain').replace(/[^a-z0-9-]/gi, '');
            row.append('<div class="translationsub-tmdb-v2__state translationsub-tmdb-v2__state--' + type + '">' + escapeHtml(schedule.text) + '</div>');
        }

        if (tmdb.lastSyncedAt) row.attr('title', 'TMDB обновлён: ' + tmdb.lastSyncedAt);
        meta.append(row);
    }

    function decorateAll() {
        if (typeof $ !== 'function') return;
        $('.translationsub-page .translationsub-card').each(function () { decorateCard(this); });
    }

    function wrapSourceBinding() {
        try {
            var source = window.TranslationSubCardSource;
            if (!source || typeof source.bindPage !== 'function' || source.__tmdbUiWrapped) return false;
            var original = source.bindPage;
            source.bindPage = function (root, list) {
                original.apply(source, arguments);
                root = root && root.jquery ? root : $(root);
                list = Array.isArray(list) ? list : [];
                var map = {};
                list.forEach(function (item) {
                    var id = String(item && item.id || '');
                    if (id) map[id] = item;
                });
                root.find('.translationsub-card').each(function () {
                    var card = $(this);
                    var id = String(card.attr('data-subscription-id') || '');
                    if (map[id]) card.data('translationsubTmdbItem', map[id]);
                });
            };
            source.__tmdbUiWrapped = true;
            return true;
        } catch (e) { return false; }
    }

    function wrapUiRefresh() {
        try {
            var ui = window.TranslationSubUi;
            if (!ui || typeof ui.refresh !== 'function' || ui.__tmdbUiWrapped) return false;
            var original = ui.refresh;
            ui.refresh = function () {
                original.apply(ui, arguments);
                decorateAll();
            };
            ui.__tmdbUiWrapped = true;
            return true;
        } catch (e) { return false; }
    }

    function injectStyles() {
        if (document.getElementById('translationsub-tmdb-ui-style')) return;
        var style = document.createElement('style');
        style.id = 'translationsub-tmdb-ui-style';
        style.textContent =
            '.translationsub-tmdb-v2{margin-top:.12em;padding-top:.5em;border-top:1px solid rgba(255,255,255,.07);font-size:.91em;line-height:1.35}' +
            '.translationsub-card.focus .translationsub-tmdb-v2{border-top-color:rgba(0,0,0,.09)}' +
            '.translationsub-tmdb-v2__facts{display:flex;gap:.4em;align-items:center;flex-wrap:wrap;opacity:.62}' +
            '.translationsub-tmdb-v2__sep{opacity:.45}' +
            '.translationsub-tmdb-v2__state{margin-top:.25em;font-weight:550;opacity:.72}' +
            '.translationsub-tmdb-v2__state--active,.translationsub-tmdb-v2__state--new-season{color:#ffad7d;opacity:1}' +
            '.translationsub-tmdb-v2__state--ok{color:#75cfa0;opacity:.88}' +
            '.translationsub-tmdb-v2__state--warn{color:#e7c56c;opacity:.9}' +
            '.translationsub-card.focus .translationsub-tmdb-v2__state--active,.translationsub-card.focus .translationsub-tmdb-v2__state--new-season{color:#b65125}' +
            '.translationsub-card.focus .translationsub-tmdb-v2__state--ok{color:#26794d}' +
            '@media(max-width:700px){.translationsub-tmdb-v2{font-size:.84em}}';
        (document.head || document.documentElement).appendChild(style);
    }

    function start() {
        injectStyles();
        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            var a = wrapSourceBinding();
            var b = wrapUiRefresh();
            if ((a || (window.TranslationSubCardSource && window.TranslationSubCardSource.__tmdbUiWrapped))
                && (b || (window.TranslationSubUi && window.TranslationSubUi.__tmdbUiWrapped))) {
                clearInterval(wait);
                decorateAll();
            } else if (attempts > 40) clearInterval(wait);
        }, 100);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
