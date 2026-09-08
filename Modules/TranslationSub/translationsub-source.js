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

    function sourceTitle(source) {
        return source === 'cub' ? 'CUB' : 'TMDB';
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function')
                Lampa.Noty.show(text);
        } catch (e) {}
    }

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            return window.location.origin || '';
        } catch (e) {
            return '';
        }
    }

    function request(method, path, success, error) {
        success = success || function () {};
        error = error || function () {};
        var url = host() + path;

        if (typeof fetch === 'function') {
            fetch(url, { method: method, cache: 'no-store' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    var data = {};
                    try { data = text ? JSON.parse(text) : {}; } catch (e) {}
                    success(data);
                })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    var data = {};
                    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (e) {}
                    success(data);
                } else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(null);
        } catch (e2) {
            error(e2);
        }
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

    function syncWatched(done) {
        done = typeof done === 'function' ? done : function () {};
        try {
            if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function') {
                window.TranslationSubWatch.sync(done);
                return;
            }
        } catch (e) {}
        done();
    }

    function refreshPage() {
        try {
            if (typeof window.TranslationSubPageRefresh === 'function') window.TranslationSubPageRefresh();
        } catch (e) {}
    }

    function refreshState() {
        refreshPage();
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function') {
                window.TranslationSubBadgeState.refresh();
                return;
            }
        } catch (e) {}

        try {
            if (window.TranslationSub && typeof window.TranslationSub.checkUpdates === 'function')
                window.TranslationSub.checkUpdates();
        } catch (e2) {}
    }

    function closeSelect() {
        try {
            if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') Lampa.Select.close();
        } catch (e) {}
    }

    function showActions(item) {
        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') return;

        var id = String(value(item, 'Id', 'id', '') || '');
        var title = String(value(item, 'Title', 'title', 'Подписка') || 'Подписка');
        var voice = String(value(item, 'TranslationName', 'translationName', 'Озвучка') || 'Озвучка');
        var season = Number(value(item, 'CurrentSeason', 'currentSeason', 1) || 1);
        var isSerial = value(item, 'IsSerial', 'isSerial', true) !== false;
        var watched = Number(value(item, 'CurrentEpisode', 'currentEpisode', 0) || 0);
        var available = Number(value(item, 'LastEpisode', 'lastEpisode', 0) || 0);
        var actions = [];

        if (available > watched) {
            actions.push({
                title: 'Доступны серии ' + (watched + 1) + (available > watched + 1 ? '–' + available : ''),
                subtitle: 'Просмотрено до ' + watched + ' серии',
                onclick: function () { openCard(item); }
            });
        }

        actions.push({
            title: 'Открыть карточку · ' + sourceTitle(selectedSource()),
            onclick: function () { openCard(item); }
        });

        actions.push({
            title: 'Обновить прогресс просмотра',
            onclick: function () {
                syncWatched(refreshPage);
            }
        });

        actions.push({
            title: 'Отписаться от озвучки',
            subtitle: voice + (isSerial ? (' · ' + season + ' сезон') : ''),
            onclick: function () {
                if (!id) return;
                request('POST', '/translationsub/remove?id=' + encodeURIComponent(id), function () {
                    notify('Вы отписались · ' + voice + (isSerial ? (' · ' + season + ' сезон') : ''));
                    refreshState();
                }, function () {
                    notify('Не удалось отписаться · ' + voice);
                });
            }
        });

        Lampa.Select.show({
            title: title,
            items: actions,
            onSelect: function (action) {
                closeSelect();
                if (action && typeof action.onclick === 'function') action.onclick();
            },
            onBack: function () {
                closeSelect();
                try { Lampa.Controller.toggle('content'); } catch (e) {}
            }
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

            card.on('hover:enter.translationsubSource', function () {
                openCard(item);
            });

            card.on('hover:long.translationsubSource', function () {
                showActions(item);
            });
        });
    }

    function start() {
        window.TranslationSubCardSource = {
            get: selectedSource,
            open: openCard,
            bindPage: bindPage,
            actions: showActions
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
