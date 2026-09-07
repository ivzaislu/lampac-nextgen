(function () {
    'use strict';

    if (window.__TranslationSubSourceStarted) return;
    window.__TranslationSubSourceStarted = true;

    var SETTINGS_COMPONENT = 'translationsub_settings';
    var SOURCE_SETTING = 'translationsub_card_source';
    var settingsAdded = false;
    var listCache = [];
    var listCacheTime = 0;
    var enhanceTimer = null;

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
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(text);
                return;
            }
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
                    values: {
                        tmdb: 'TMDB',
                        cub: 'CUB'
                    },
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
        } catch (e) {
            return '';
        }
    }

    function userKey() {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function') {
                return String(Lampa.Storage.get('client_uid', '') || Lampa.Storage.get('lampac_unic_id', '') || 'local');
            }
        } catch (e) {}
        return 'local';
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
        } catch (e2) {
            error(e2);
        }
    }

    function normalize(value) {
        return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function itemSeason(item) {
        return Number(item.CurrentSeason || item.currentSeason || 1) || 1;
    }

    function itemTitle(item) {
        return normalize(item.Title || item.title || '');
    }

    function itemVoice(item) {
        return normalize(item.TranslationName || item.translationName || 'Озвучка');
    }

    function cardSeason(card) {
        var text = card.find('.translationsub-card__meta').text();
        var match = String(text || '').match(/S(\d+)/i);
        return match ? (Number(match[1]) || 1) : 1;
    }

    function findItem(card, list, used) {
        var title = normalize(card.find('.translationsub-card__title').text());
        var voice = normalize(card.find('.translationsub-card__voice').text());
        var season = cardSeason(card);
        var index = -1;

        for (var i = 0; i < list.length; i++) {
            if (used[i]) continue;
            if (itemTitle(list[i]) === title && itemVoice(list[i]) === voice && itemSeason(list[i]) === season) {
                index = i;
                break;
            }
        }

        if (index < 0) {
            for (var j = 0; j < list.length; j++) {
                if (used[j]) continue;
                if (itemTitle(list[j]) === title && itemVoice(list[j]) === voice) {
                    index = j;
                    break;
                }
            }
        }

        if (index >= 0) {
            used[index] = true;
            return list[index];
        }

        return null;
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
            card: {
                id: numericId,
                source: source
            }
        });
    }

    function syncWatched() {
        try {
            if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function')
                window.TranslationSubWatch.sync();
        } catch (e) {}
    }

    function showActions(item, card) {
        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') return;

        var id = String(item.Id || item.id || '');
        var title = item.Title || item.title || 'Подписка';
        var watched = Number(item.CurrentEpisode || item.currentEpisode || 0) || 0;
        var available = Number(item.LastEpisode || item.lastEpisode || 0) || 0;
        var actions = [
            {
                title: 'Открыть карточку · ' + sourceTitle(selectedSource()),
                onclick: function () { openCard(item); }
            },
            {
                title: 'Обновить прогресс просмотра',
                onclick: function () {
                    syncWatched();
                    notify('Обновляю прогресс просмотра');
                }
            }
        ];

        if (available > watched) {
            actions.unshift({
                title: 'Доступны серии ' + (watched + 1) + (available > watched + 1 ? '–' + available : ''),
                subtitle: 'Просмотрено до ' + watched + ' серии',
                onclick: function () { openCard(item); }
            });
        }

        actions.push({
            title: 'Удалить подписку',
            onclick: function () {
                if (!id) return;
                request('POST', '/translationsub/remove?id=' + encodeURIComponent(id), function () {
                    listCacheTime = 0;
                    card.remove();
                    notify('Подписка удалена');
                    scheduleEnhance(true);
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

    function bindCards(root, list) {
        var cards = root.find('.translationsub-card');
        var used = {};

        cards.each(function () {
            var card = $(this);
            var item = findItem(card, list, used);
            if (!item) return;

            card.attr('data-translationsub-card-source', selectedSource());
            card.off('hover:enter');
            card.off('hover:long');

            card.on('hover:enter.translationsubSource', function () {
                openCard(item);
            });

            card.on('hover:long.translationsubSource', function () {
                showActions(item, card);
            });
        });
    }

    function loadList(done, force) {
        var now = Date.now ? Date.now() : new Date().getTime();
        if (!force && listCacheTime && now - listCacheTime < 3000) {
            done(listCache);
            return;
        }

        request('GET', '/translationsub/list?userKey=' + encodeURIComponent(userKey()), function (list) {
            listCache = Array.isArray(list) ? list : [];
            listCacheTime = now;
            done(listCache);
        }, function () {
            done(listCache || []);
        });
    }

    function enhancePages(force) {
        if (typeof $ !== 'function') return;
        var pages = $('.translationsub-page');
        if (!pages.length) return;

        loadList(function (list) {
            pages.each(function () {
                bindCards($(this), list);
            });
        }, !!force);
    }

    function scheduleEnhance(force) {
        clearTimeout(enhanceTimer);
        enhanceTimer = setTimeout(function () { enhancePages(force); }, 80);
    }

    function start() {
        addSetting();
        scheduleEnhance(true);

        try {
            if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') {
                        addSetting();
                        scheduleEnhance(true);
                    }
                });
            }
        } catch (e) {}

        try {
            var observer = new MutationObserver(function () { scheduleEnhance(false); });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e2) {
            setInterval(function () { scheduleEnhance(false); }, 1200);
        }

        window.TranslationSubCardSource = {
            get: selectedSource,
            open: openCard,
            refresh: function () { scheduleEnhance(true); }
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
