(function () {
    'use strict';

    if (window.__TranslationSubSourceStarted) return;
    window.__TranslationSubSourceStarted = true;

    var SETTINGS_COMPONENT = 'translationsub_settings';
    var SOURCE_SETTING = 'translationsub_card_source';
    var settingsAdded = false;

    function storageGet(name, fallback) {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function')
                return Lampa.Storage.get(name, fallback);
        } catch (e) {}
        try {
            var value = localStorage.getItem(name);
            return value === null ? fallback : value;
        } catch (e2) { return fallback; }
    }

    function selectedSource() {
        return String(storageGet(SOURCE_SETTING, 'tmdb') || 'tmdb').toLowerCase() === 'cub' ? 'cub' : 'tmdb';
    }

    function sourceTitle(source) {
        return source === 'cub' ? 'CUB' : 'TMDB';
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') Lampa.Noty.show(text);
        } catch (e) {}
    }

    function addSetting() {
        if (settingsAdded || !window.Lampa || !Lampa.SettingsApi || typeof Lampa.SettingsApi.addParam !== 'function') return;

        try {
            Lampa.SettingsApi.addParam({
                component: SETTINGS_COMPONENT,
                param: {
                    name: SOURCE_SETTING,
                    type: 'select',
                    values: { tmdb: 'TMDB', cub: 'CUB' },
                    'default': 'tmdb'
                },
                field: {
                    name: 'Источник карточки',
                    description: 'Источник карточки Lampa при открытии сериала из подписок. По умолчанию TMDB.'
                },
                onChange: function () {
                    notify('Источник карточки: ' + sourceTitle(selectedSource()));
                }
            });
            settingsAdded = true;
        } catch (e) {
            setTimeout(addSetting, 500);
        }
    }

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            return window.location.origin || '';
        } catch (e) { return ''; }
    }

    function request(method, path, success, error) {
        success = success || function () {};
        error = error || function () {};
        var url = host() + path;

        if (typeof fetch === 'function') {
            fetch(url, { method: method })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    try { success(text ? JSON.parse(text) : {}); }
                    catch (e) { success({}); }
                })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { success(xhr.responseText ? JSON.parse(xhr.responseText) : {}); }
                    catch (e) { success({}); }
                } else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(null);
        } catch (e2) { error(e2); }
    }

    function tmdbId(item) {
        var value = String(item.TmdbId || item.tmdbId || '').trim();
        if (!value) {
            var fallback = String(item.ContentId || item.contentId || '').trim();
            if (/^\d+$/.test(fallback)) value = fallback;
        }
        return value;
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
        var isSerial = item.IsSerial !== undefined ? !!item.IsSerial : (item.isSerial !== undefined ? !!item.isSerial : true);

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

    function showActions(item, card) {
        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') return;

        var id = String(item.Id || item.id || '');
        var title = item.Title || item.title || 'Подписка';
        var watched = Number(item.CurrentEpisode || item.currentEpisode || 0) || 0;
        var available = Number(item.LastEpisode || item.lastEpisode || 0) || 0;
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
                syncWatched(function () { refreshPage(); });
            }
        });

        actions.push({
            title: 'Удалить подписку',
            onclick: function () {
                if (!id) return;
                request('POST', '/translationsub/remove?id=' + encodeURIComponent(id), function () {
                    notify('Подписка удалена');
                    refreshPage();
                }, function () {
                    notify('Не удалось удалить подписку');
                });
            }
        });

        Lampa.Select.show({
            title: title,
            items: actions,
            onSelect: function (action) {
                if (action && typeof action.onclick === 'function') action.onclick();
            },
            onBack: function () {
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
            var id = String(item.Id || item.id || '');
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
                showActions(item, card);
            });
        });
    }

    function start() {
        addSetting();

        try {
            if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') addSetting();
                });
            }
        } catch (e) {}

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
            } else if (attempts > 80) clearInterval(wait);
        }, 250);
    }
})();
