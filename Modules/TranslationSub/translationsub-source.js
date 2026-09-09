(function () {
    'use strict';

    if (window.__TranslationSubSourceStarted) return;
    window.__TranslationSubSourceStarted = true;

    var SOURCE_SETTING = 'translationsub_card_source';

    function storageGet(name, fallback) {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function')
                return Lampa.Storage.get(name, fallback);
        } catch (e) {}

        try {
            var value = localStorage.getItem(name);
            return value === null ? fallback : value;
        } catch (e2) {
            return fallback;
        }
    }

    function selectedSource() {
        return String(storageGet(SOURCE_SETTING, 'tmdb') || 'tmdb').toLowerCase() === 'cub' ? 'cub' : 'tmdb';
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function')
                Lampa.Noty.show(text);
        } catch (e) {}
    }

    function value(item, pascal, camel, fallback) {
        if (!item) return fallback;
        if (item[pascal] !== undefined && item[pascal] !== null) return item[pascal];
        if (item[camel] !== undefined && item[camel] !== null) return item[camel];
        return fallback;
    }

    function tmdbId(item) {
        var id = String(value(item, 'TmdbId', 'tmdbId', '') || '').trim();
        if (!id) {
            var fallback = String(value(item, 'ContentId', 'contentId', '') || '').trim();
            if (/^\d+$/.test(fallback)) id = fallback;
        }
        return id;
    }

    function openCard(item) {
        if (!window.Lampa || !Lampa.Activity || typeof Lampa.Activity.push !== 'function') return;

        var id = tmdbId(item);
        if (!id) {
            notify('TMDB ID не найден. Пересоздайте подписку из карточки сериала.');
            return;
        }

        var source = selectedSource();
        var numericId = /^\d+$/.test(id) ? Number(id) : id;
        var isSerial = value(item, 'IsSerial', 'isSerial', true) !== false;

        Lampa.Activity.push({
            url: '',
            component: 'full',
            source: source,
            id: numericId,
            method: isSerial ? 'tv' : 'movie',
            card: { id: numericId, source: source }
        });
    }

    function bindPage(root, list) {
        if (typeof $ !== 'function') return;
        root = root && root.jquery ? root : $(root);
        list = Array.isArray(list) ? list : [];

        var byId = {};
        list.forEach(function (item) {
            var id = String(value(item, 'Id', 'id', '') || '');
            if (id) byId[id] = item;
        });

        root.find('.translationsub-card').each(function () {
            var card = $(this);
            var id = String(card.attr('data-subscription-id') || '');
            var item = byId[id];
            if (!item) return;

            card.attr('data-translationsub-card-source', selectedSource());
            card.off('.translationsubSource');

            /*
             * На странице подписок оставляем только обычное открытие карточки.
             * Long-press/Select здесь намеренно отсутствуют: ручной Select.close()
             * в этом пути вызывал зависание Android TV WebView/history.
             */
            card.on('hover:enter.translationsubSource', function () {
                openCard(item);
            });
        });
    }

    function start() {
        window.TranslationSubCardSource = {
            get: selectedSource,
            open: openCard,
            bindPage: bindPage
        };
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