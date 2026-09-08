(function () {
    'use strict';

    if (window.__TranslationSubCardFlowStarted) return;
    window.__TranslationSubCardFlowStarted = true;

    var API = {
        list: '/translationsub/list',
        variants: '/translationsub/variants',
        add: '/translationsub/add',
        remove: '/translationsub/remove',
        externalids: '/externalids'
    };

    var SETTINGS = {
        flixcdn: 'translationsub_flixcdn',
        phantom: 'translationsub_phantom',
        zetflixdb: 'translationsub_zetflixdb',
        videohub: 'translationsub_videohub'
    };

    var SOURCE_NAMES = {
        flixcdn: 'FlixCDN',
        phantom: 'Phantom',
        zetflixdb: 'ZetflixDB',
        cdnvideohub: 'VideoHUB',
        multi: 'Несколько источников'
    };

    var WATCHED_PERCENT = 60;
    var FALLBACK_EPISODES_SCAN = 250;
    var lastEvent = null;
    var applyTimer = null;
    var busy = false;

    function bellSvg() {
        return '<svg viewBox="0 0 25 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7367 27 9.27804 25.6961 9.03542 24H6.01892Z" fill="currentColor"></path>' +
            '<path d="M3.81972 14.5957V10.2679C3.81972 5.41336 7.7181 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.2106 22.9392 23.5 20.9098 23.5H4.09021C2.06084 23.5 0.792282 21.2106 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z" stroke="currentColor" stroke-width="2.6"></path>' +
        '</svg>';
    }

    function injectStyles() {
        if (document.getElementById('translationsub-card-flow-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-card-flow-style';
        style.textContent =
            '.translationsub-full-button{position:relative}' +
            '.translationsub-full-button>svg{width:1.2em;height:1.35em;flex-shrink:0}' +
            '.translationsub-full-button__progress{display:none!important}' +
            '.translationsub-full-button[data-translationsub-card-flow="1"]{gap:.55em}' +
            '.translationsub-full-button[data-translationsub-card-flow="1"] span{white-space:nowrap}' +
            '.translationsub-full-button--subscribed:after{' +
                'content:"";position:absolute;width:.42em;height:.42em;border-radius:50%;background:#f47a42;' +
                'right:.36em;top:.34em;box-shadow:0 0 0 .12em rgba(0,0,0,.16)' +
            '}' +
            '.translationsub-full-button--subscribed.focus:after{box-shadow:0 0 0 .12em rgba(255,255,255,.45)}';

        (document.head || document.documentElement).appendChild(style);
    }

    function detectHost() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');

            var scripts = document.getElementsByTagName('script');
            for (var i = scripts.length - 1; i >= 0; i--) {
                var src = scripts[i].src || '';
                if (src.indexOf('/translationsub.js') !== -1 && typeof URL === 'function')
                    return new URL(src, window.location.href).origin;
            }
        } catch (e) {}

        try { return window.location.origin || ''; } catch (e2) { return ''; }
    }

    var HOST = detectHost();

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

    function storageSet(name, value) {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.set === 'function') {
                Lampa.Storage.set(name, value);
                return;
            }
        } catch (e) {}

        try { localStorage.setItem(name, value); } catch (e2) {}
    }

    function settingBool(name, fallback) {
        var value = storageGet(name, fallback);
        if (value === true || value === 1 || value === '1' || value === 'true') return true;
        if (value === false || value === 0 || value === '0' || value === 'false') return false;
        return !!fallback;
    }

    function enabledSources() {
        var result = [];
        if (settingBool(SETTINGS.flixcdn, true)) result.push('flixcdn');
        if (settingBool(SETTINGS.phantom, true)) result.push('phantom');
        if (settingBool(SETTINGS.zetflixdb, true)) result.push('zetflixdb');
        if (settingBool(SETTINGS.videohub, true)) result.push('cdnvideohub');
        return result;
    }

    function sourcesQuery() {
        var sources = enabledSources();
        return sources.length ? sources.join(',') : 'none';
    }

    function lampacUid() {
        var uid = String(storageGet('lampac_unic_id', '') || '');
        if (uid) return uid;

        try {
            if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.uid === 'function')
                uid = String(Lampa.Utils.uid(8) || '').toLowerCase();
        } catch (e) {}

        if (!uid) uid = Math.random().toString(36).slice(2, 10).toLowerCase();
        storageSet('lampac_unic_id', uid);
        return uid;
    }

    function userKey() {
        return String(storageGet('client_uid', '') || lampacUid() || 'local');
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(text);
                return;
            }
        } catch (e) {}

        try { console.log('[TranslationSub]', text); } catch (e2) {}
    }

    function parseJson(value) {
        if (value === null || value === undefined || value === '') return {};
        if (typeof value === 'object') return value;
        try { return JSON.parse(value); } catch (e) { return {}; }
    }

    function query(params) {
        var parts = [];
        params = params || {};

        Object.keys(params).forEach(function (key) {
            var value = params[key];
            if (value === null || value === undefined || value === '') return;
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
        });

        return parts.join('&');
    }

    function request(method, path, params, body, success, error) {
        success = success || function () {};
        error = error || function () {};

        var qs = query(params);
        var url = HOST + path + (qs ? (path.indexOf('?') === -1 ? '?' : '&') + qs : '');

        if (typeof fetch === 'function') {
            var options = {
                method: method,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            };
            if (body && method !== 'GET') options.body = JSON.stringify(body);

            fetch(url, options)
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) { success(parseJson(text)); })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) success(parseJson(xhr.responseText));
                else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(body && method !== 'GET' ? JSON.stringify(body) : null);
        } catch (e) {
            error(e);
        }
    }

    function normalizeFull(object) {
        object = object || {};
        var card = object.movie || object.card || object.data || object;
        var method = object.method || card.method || '';
        var source = String(object.source || card.source || card.card_source || '').toLowerCase();
        var isSerial = method === 'tv' || method === 'serial' || !!card.first_air_date || !!card.name || !!card.number_of_seasons;

        var explicitTmdbId = card.tmdb_id || card.tmdbId || '';
        var cardId = card.id || object.id || '';
        var tmdbId = explicitTmdbId || ((source && source !== 'tmdb' && source !== 'themoviedb') ? '' : cardId);
        var kpId = card.kinopoisk_id || card.kp_id || card.kpId || (card.external_ids && card.external_ids.kinopoisk_id) || '';
        var imdbId = card.imdb_id || card.imdbId || (card.external_ids && card.external_ids.imdb_id) || '';
        var title = card.title || card.name || object.title || '';
        var originalTitle = card.original_title || card.original_name || '';
        var date = card.release_date || card.first_air_date || '';
        var year = date && String(date).length >= 4 ? String(date).slice(0, 4) : (card.year || '');
        var poster = card.poster_path || card.poster || card.img || card.image || '';
        var contentId = card.content_id || card.contentId || tmdbId || kpId || imdbId || cardId || title || '';

        return {
            raw: object,
            card: card,
            source: source,
            contentId: String(contentId || ''),
            title: String(title || ''),
            originalTitle: String(originalTitle || ''),
            tmdbId: String(tmdbId || ''),
            kpId: String(kpId || ''),
            imdbId: String(imdbId || ''),
            year: String(year || ''),
            poster: String(poster || ''),
            isSerial: !!isSerial,
            season: Number(object.season || card.season || 0) || 0
        };
    }

    function ensureExternalIds(context, done) {
        if (!context) {
            done(context);
            return;
        }

        if (context.tmdbId && context.kpId && context.imdbId) {
            done(context);
            return;
        }

        request('GET', API.externalids, {
            id: context.tmdbId || context.contentId,
            serial: context.isSerial ? 1 : 0,
            imdb_id: context.imdbId,
            kinopoisk_id: context.kpId,
            account_email: storageGet('account_email', ''),
            uid: lampacUid(),
            nws_id: storageGet('lampac_nws_id', '')
        }, null, function (ids) {
            ids = ids || {};
            context.kpId = String(ids.kinopoisk_id || ids.kp_id || context.kpId || '');
            context.imdbId = String(ids.imdb_id || context.imdbId || '');
            if (ids.tmdb_id) context.tmdbId = String(ids.tmdb_id);
            done(context);
        }, function () {
            done(context);
        });
    }

    function sourceName(source) {
        source = String(source || '').toLowerCase();
        return SOURCE_NAMES[source] || source || 'Источник';
    }

    function variantSources(variant) {
        var sources = variant.Sources || variant.sources || [];
        if (Array.isArray(sources) && sources.length) return sources;

        return [{
            Source: variant.source || variant.Source || '',
            Path: variant.path || variant.Path || '',
            TranslationId: variant.translation_id || variant.Id || variant.id || '',
            TranslationName: variant.translation || variant.Name || variant.name || '',
            Season: variant.season || 0,
            Episode: variant.episode || 0,
            Quality: variant.quality || ''
        }];
    }

    function sourceSummary(variant) {
        var names = [];
        variantSources(variant).forEach(function (item) {
            var name = sourceName(item.Source || item.source || '');
            if (name && names.indexOf(name) === -1) names.push(name);
        });
        return names.join(', ');
    }

    function voiceName(variant) {
        var id = String(variant.Id || variant.id || variant.translation_id || '');
        return String(variant.Name || variant.name || variant.translation || ('Озвучка ' + id));
    }

    function voiceId(variant) {
        return String(variant.Id || variant.id || variant.translation_id || '');
    }

    function normalizeVoice(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^a-zа-я0-9]+/gi, '')
            .trim();
    }

    function value(item, pascal, camel, fallback) {
        if (!item) return fallback;
        if (item[pascal] !== undefined && item[pascal] !== null) return item[pascal];
        if (item[camel] !== undefined && item[camel] !== null) return item[camel];
        return fallback;
    }

    function sameContent(item, context) {
        var itemContent = String(value(item, 'ContentId', 'contentId', '') || '');
        var itemTmdb = String(value(item, 'TmdbId', 'tmdbId', '') || '');
        var itemImdb = String(value(item, 'ImdbId', 'imdbId', '') || '');
        var itemKp = String(value(item, 'KpId', 'kpId', '') || '');

        if (itemContent && context.contentId && itemContent === String(context.contentId)) return true;
        if (itemTmdb && context.tmdbId && itemTmdb === String(context.tmdbId)) return true;
        if (itemImdb && context.imdbId && itemImdb.toLowerCase() === String(context.imdbId).toLowerCase()) return true;
        if (itemKp && context.kpId && itemKp === String(context.kpId)) return true;
        return false;
    }

    function findExisting(subscriptions, context, variant, season) {
        var id = voiceId(variant);
        var name = normalizeVoice(voiceName(variant));

        for (var i = 0; i < subscriptions.length; i++) {
            var item = subscriptions[i];
            if (!sameContent(item, context)) continue;

            var itemSeason = Number(value(item, 'CurrentSeason', 'currentSeason', 1) || 1);
            if (itemSeason !== Number(season || 1)) continue;

            var itemId = String(value(item, 'TranslationId', 'translationId', '') || '');
            var itemName = normalizeVoice(value(item, 'TranslationName', 'translationName', ''));

            if (id && itemId && id === itemId) return item;
            if (name && itemName && name === itemName) return item;
        }

        return null;
    }

    function timelineCard(context) {
        var card = context && context.card ? context.card : {};
        var original = card.original_name || card.original_title || context.originalTitle || context.title || '';
        return { original_name: original, original_title: original };
    }

    function episodePercent(context, season, episode) {
        try {
            if (!window.Lampa || !Lampa.Timeline || typeof Lampa.Timeline.watchedEpisode !== 'function') return 0;
            return Number(Lampa.Timeline.watchedEpisode(timelineCard(context), season, episode) || 0);
        } catch (e) {
            return 0;
        }
    }

    function watchedEpisode(context, season, knownEpisodes) {
        if (!context.isSerial) return 0;

        var limit = Number(knownEpisodes || 0) || FALLBACK_EPISODES_SCAN;
        limit = Math.max(1, Math.min(FALLBACK_EPISODES_SCAN, limit));
        var highest = 0;

        for (var episode = 1; episode <= limit; episode++) {
            if (episodePercent(context, season, episode) >= WATCHED_PERCENT) highest = episode;
        }

        return highest;
    }

    function seasonMetadata(context) {
        var card = context && context.card ? context.card : {};
        var map = {};
        var list = [];

        if (Array.isArray(card.seasons)) {
            card.seasons.forEach(function (season) {
                var number = Number(season && (season.season_number !== undefined ? season.season_number : season.number) || 0);
                if (number <= 0) return;
                map[number] = {
                    number: number,
                    episodeCount: Number(season.episode_count || season.episodes_count || 0) || 0,
                    airDate: season.air_date || ''
                };
            });
        }

        var total = Number(card.number_of_seasons || card.seasons_count || 0) || 0;
        for (var i = 1; i <= total; i++) {
            if (!map[i]) map[i] = { number: i, episodeCount: 0, airDate: '' };
        }

        var last = Number(card.last_episode_to_air && card.last_episode_to_air.season_number || 0) || 0;
        var next = Number(card.next_episode_to_air && card.next_episode_to_air.season_number || 0) || 0;
        if (last > 0 && !map[last]) map[last] = { number: last, episodeCount: 0, airDate: '' };
        if (next > 0 && !map[next]) map[next] = { number: next, episodeCount: 0, airDate: '' };

        Object.keys(map).forEach(function (key) { list.push(map[key]); });
        list.sort(function (a, b) { return b.number - a.number; });
        return list;
    }

    function actualSeason(context, seasons) {
        var card = context.card || {};
        var last = Number(card.last_episode_to_air && card.last_episode_to_air.season_number || 0) || 0;
        if (last > 0) return last;

        var now = Date.now ? Date.now() : new Date().getTime();
        for (var i = 0; i < seasons.length; i++) {
            if (!seasons[i].airDate) continue;
            var time = new Date(seasons[i].airDate).getTime();
            if (!isNaN(time) && time <= now) return seasons[i].number;
        }

        return seasons.length ? seasons[0].number : 1;
    }

    function seasonProgress(context) {
        var seasons = seasonMetadata(context);
        if (!seasons.length) seasons = [{ number: 1, episodeCount: 0, airDate: '' }];

        var watched = {};
        var lastWatchedSeason = 0;

        seasons.forEach(function (season) {
            watched[season.number] = watchedEpisode(context, season.number, season.episodeCount);
            if (watched[season.number] > 0 && season.number > lastWatchedSeason) lastWatchedSeason = season.number;
        });

        var current = lastWatchedSeason || actualSeason(context, seasons) || 1;

        return {
            seasons: seasons,
            watched: watched,
            preferredSeason: current
        };
    }

    function showSelect(title, items, onBack) {
        items = items || [];

        if (!items.length) {
            notify('Нечего показывать');
            return;
        }

        if (window.Lampa && Lampa.Select && typeof Lampa.Select.show === 'function') {
            Lampa.Select.show({
                title: title,
                items: items,
                onSelect: function (item) {
                    if (item && typeof item.onclick === 'function') item.onclick();
                },
                onBack: onBack || function () {
                    try { Lampa.Controller.toggle('content'); } catch (e) {}
                }
            });
            return;
        }

        notify(title);
    }

    function loadVariants(context, season, success, error) {
        request('GET', API.variants, {
            userKey: userKey(),
            contentId: context.contentId,
            title: context.title,
            originalTitle: context.originalTitle,
            kpId: context.kpId,
            imdbId: context.imdbId,
            tmdbId: context.tmdbId,
            year: context.year,
            isSerial: context.isSerial,
            season: context.isSerial ? Number(season || 0) : 0,
            serial: context.isSerial,
            sources: sourcesQuery()
        }, null, success, error);
    }

    function loadSubscriptions(success, error) {
        request('GET', API.list, { userKey: userKey() }, null, function (list) {
            success(Array.isArray(list) ? list : []);
        }, error);
    }

    function actionSuffix(context, season) {
        if (!context.isSerial) return '';
        return ' · ' + Number(season || 1) + ' сезон';
    }

    function syncAfterChange() {
        try {
            if (window.TranslationSub && typeof window.TranslationSub.checkUpdates === 'function')
                window.TranslationSub.checkUpdates();
        } catch (e) {}

        try {
            if (window.TranslationSubNotice && typeof window.TranslationSubNotice.refresh === 'function')
                window.TranslationSubNotice.refresh();
        } catch (e2) {}

        setTimeout(function () {
            try {
                if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function')
                    window.TranslationSubWatch.sync();
            } catch (e) {}
        }, 350);

        scheduleApply(lastEvent, 420);
    }

    function subscribe(context, variant, season, done) {
        if (busy) return;
        busy = true;

        var sources = variantSources(variant);
        var bodySources = sources.map(function (source) {
            return {
                source: source.Source || source.source || '',
                path: source.Path || source.path || '',
                translationId: String(source.TranslationId || source.translationId || voiceId(variant)),
                translationName: source.TranslationName || source.translationName || voiceName(variant)
            };
        });

        var latestEpisode = Number(variant.episode || 0) || 0;
        var watched = watchedEpisode(context, season, Math.max(latestEpisode + 8, 32));
        var mainSource = bodySources.length > 1 ? 'multi' :
            (bodySources.length ? bodySources[0].source : (variant.source || 'multi'));

        request('POST', API.add, null, {
            userKey: userKey(),
            contentId: context.contentId,
            title: context.title,
            originalTitle: context.originalTitle,
            kpId: context.kpId,
            imdbId: context.imdbId,
            tmdbId: context.tmdbId,
            poster: context.poster,
            year: context.year,
            isSerial: context.isSerial,
            source: mainSource,
            translationId: voiceId(variant),
            translationName: voiceName(variant),
            currentSeason: String(context.isSerial ? Number(season || 1) : 1),
            currentEpisode: String(latestEpisode),
            availableEpisode: String(latestEpisode),
            watchedEpisode: String(watched),
            sources: bodySources
        }, function () {
            busy = false;
            notify('Подписка оформлена · ' + voiceName(variant) + actionSuffix(context, season));
            syncAfterChange();
            if (done) done(true);
        }, function () {
            busy = false;
            notify('Не удалось оформить подписку · ' + voiceName(variant));
            if (done) done(false);
        });
    }

    function unsubscribe(context, variant, season, existing, done) {
        if (busy) return;
        busy = true;

        var id = String(value(existing, 'Id', 'id', '') || '');
        if (!id) {
            busy = false;
            notify('Не удалось определить подписку для удаления');
            if (done) done(false);
            return;
        }

        request('POST', API.remove, { id: id }, null, function () {
            busy = false;
            notify('Вы отписались · ' + voiceName(variant) + actionSuffix(context, season));
            syncAfterChange();
            if (done) done(true);
        }, function () {
            busy = false;
            notify('Не удалось отписаться · ' + voiceName(variant));
            if (done) done(false);
        });
    }

    function openVoices(context, season) {
        season = Number(season || 1) || 1;

        loadSubscriptions(function (subscriptions) {
            loadVariants(context, season, function (response) {
                var variants = response.Translations || response.translations || [];
                variants = Array.isArray(variants) ? variants.slice() : [];

                if (context.isSerial) {
                    variants = variants.filter(function (variant) {
                        var itemSeason = Number(variant.season || season || 1) || 1;
                        return itemSeason === season;
                    });
                }

                if (!variants.length) {
                    notify(context.isSerial
                        ? ('Озвучки для ' + season + ' сезона пока не найдены')
                        : 'Озвучки пока не найдены');
                    return;
                }

                variants.sort(function (a, b) {
                    var aSub = findExisting(subscriptions, context, a, season) ? 1 : 0;
                    var bSub = findExisting(subscriptions, context, b, season) ? 1 : 0;
                    if (aSub !== bSub) return bSub - aSub;
                    return voiceName(a).localeCompare(voiceName(b), 'ru');
                });

                var items = variants.map(function (variant) {
                    var existing = findExisting(subscriptions, context, variant, season);
                    var sources = sourceSummary(variant);
                    var latest = Number(variant.episode || 0) || 0;
                    var quality = String(variant.quality || '').trim();
                    var subtitle = [];

                    if (existing) {
                        subtitle.push('Подписка активна');
                        subtitle.push('нажмите, чтобы отписаться');
                    } else if (context.isSerial && latest > 0) {
                        subtitle.push('Доступно до ' + latest + ' серии');
                    } else {
                        subtitle.push('Нажмите, чтобы подписаться');
                    }

                    if (sources) subtitle.push(sources);
                    if (quality) subtitle.push(quality);

                    return {
                        title: (existing ? '✓ ' : '') + voiceName(variant),
                        subtitle: subtitle.join(' · '),
                        selected: !!existing,
                        onclick: function () {
                            var after = function (changed) {
                                if (!changed) return;
                                setTimeout(function () { openVoices(context, season); }, 180);
                            };

                            if (existing) unsubscribe(context, variant, season, existing, after);
                            else subscribe(context, variant, season, after);
                        }
                    };
                });

                showSelect(context.isSerial ? ('Озвучки · ' + season + ' сезон') : 'Озвучки', items, function () {
                    if (context.isSerial) openSeasonMenu(context);
                    else {
                        try { Lampa.Controller.toggle('content'); } catch (e) {}
                    }
                });
            }, function () {
                notify('Не удалось загрузить список озвучек');
            });
        }, function () {
            notify('Не удалось загрузить ваши подписки');
        });
    }

    function openSeasonMenu(context) {
        var progress = seasonProgress(context);
        var seasons = progress.seasons;

        if (!context.isSerial) {
            openVoices(context, 1);
            return;
        }

        if (context.season > 0) {
            openVoices(context, context.season);
            return;
        }

        if (seasons.length === 1) {
            openVoices(context, seasons[0].number);
            return;
        }

        var items = seasons.map(function (season) {
            var watched = Number(progress.watched[season.number] || 0);
            var subtitle;

            if (watched > 0) subtitle = 'Просмотрено до ' + watched + ' серии';
            else if (season.number === progress.preferredSeason) subtitle = 'Актуальный сезон';
            else subtitle = 'Не начат';

            if (season.episodeCount > 0) subtitle += ' · всего ' + season.episodeCount + ' серий';

            return {
                title: season.number + ' сезон',
                subtitle: subtitle,
                selected: season.number === progress.preferredSeason,
                onclick: function () { openVoices(context, season.number); }
            };
        });

        showSelect('Выберите сезон', items);
    }

    function openForItem(object) {
        var context = object && object.card && object.contentId ? object : normalizeFull(object || {});
        if (!context.contentId && !context.title) {
            notify('Не удалось определить карточку');
            return;
        }

        if (!enabledSources().length) {
            notify('Включите хотя бы один балансер в настройках');
            return;
        }

        ensureExternalIds(context, function (resolved) {
            if (!resolved) {
                notify('Не удалось подготовить карточку');
                return;
            }

            openSeasonMenu(resolved);
        });
    }

    function buttonRoot(event) {
        var root = null;
        try {
            if (event && event.object && event.object.activity && typeof event.object.activity.render === 'function')
                root = event.object.activity.render();
        } catch (e) {}

        if (!root || !root.length) {
            root = $('.full-start').first();
            if (!root.length) root = $('.full-start-new').first();
        }

        return root;
    }

    function ensureButton(event) {
        if (typeof $ !== 'function') return null;

        var root = buttonRoot(event);
        if (!root || !root.length) return null;

        var button = root.find('.translationsub-full-button').first();
        if (button.length) return button;

        var row = root.find('.full-start-new__buttons').first();
        if (!row.length) row = root.find('.full-start__buttons').first();
        if (!row.length) return null;

        button = $('<div class="full-start__button selector translationsub-full-button"></div>');
        row.append(button);
        return button;
    }

    function applyButton(event) {
        if (typeof $ !== 'function') return;

        var payload = event && (event.data || event.object) || {};
        var context = normalizeFull(payload);
        if (!context.contentId && !context.title) return;

        var button = ensureButton(event);
        if (!button || !button.length) return;

        button.off('hover:enter');
        button.off('hover:long');
        button.empty();
        button.append(bellSvg());
        button.append('<span>Озвучки</span>');
        button.find('.translationsub-full-button__progress').remove();
        button.attr('data-translationsub-card-flow', '1');
        button.attr('title', 'Подписки на озвучки');
        button.removeAttr('data-subtitle');

        button.on('hover:enter', function () {
            openForItem(context);
        });

        button.on('hover:long', function () {
            try {
                if (window.TranslationSub && typeof window.TranslationSub.openSubscriptions === 'function')
                    window.TranslationSub.openSubscriptions();
            } catch (e) {}
        });

        loadSubscriptions(function (subscriptions) {
            var active = subscriptions.some(function (item) { return sameContent(item, context); });
            button.toggleClass('translationsub-full-button--subscribed', active);
            button.attr('title', active ? 'Озвучки · есть активные подписки' : 'Подписки на озвучки');
        }, function () {});
    }

    function scheduleApply(event, delay) {
        lastEvent = event || lastEvent;
        clearTimeout(applyTimer);
        applyTimer = setTimeout(function () {
            if (lastEvent) applyButton(lastEvent);
        }, typeof delay === 'number' ? delay : 140);
    }

    function expose() {
        try {
            if (!window.TranslationSub) return false;
            window.TranslationSub.openForItem = openForItem;
            window.TranslationSub.cardFlow = {
                open: openForItem,
                refreshButton: function () { scheduleApply(lastEvent, 0); }
            };
            return true;
        } catch (e) {
            return false;
        }
    }

    function bind() {
        if (!window.Lampa || !Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return;

        Lampa.Listener.follow('full', function (event) {
            if (!event || event.type !== 'complite') return;
            scheduleApply(event, 140);
        });

        try {
            if (Lampa.Timeline && Lampa.Timeline.listener && typeof Lampa.Timeline.listener.follow === 'function') {
                Lampa.Timeline.listener.follow('update', function () {
                    scheduleApply(lastEvent, 240);
                });
            }
        } catch (e) {}
    }

    function start() {
        if (!window.Lampa) return;

        injectStyles();
        bind();

        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (expose() || attempts > 40) clearInterval(wait);
        }, 100);
        expose();
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
