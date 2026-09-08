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
    var MAX_EPISODE_SCAN = 250;
    var lastEvent = null;
    var applyTimer = null;
    var busy = false;
    var flowToken = 0;

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

    function parseJson(value, fallback) {
        if (value === null || value === undefined || value === '') return fallback;
        if (typeof value === 'object') return value;
        try { return JSON.parse(value); } catch (e) { return fallback; }
    }

    function request(method, path, params, body, success, error) {
        success = success || function () {};
        error = error || function () {};
        var qs = query(params);
        var url = HOST + path + (qs ? (path.indexOf('?') === -1 ? '?' : '&') + qs : '');
        var options = {
            method: method,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            cache: 'no-store'
        };
        if (body && method !== 'GET') options.body = JSON.stringify(body);

        if (typeof fetch === 'function') {
            fetch(url, options)
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) { success(parseJson(text, {})); })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) success(parseJson(xhr.responseText, {}));
                else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(body && method !== 'GET' ? JSON.stringify(body) : null);
        } catch (e2) {
            error(e2);
        }
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

    function bellSvg() {
        return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '<path d="M10 21h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>' +
        '</svg>';
    }

    function injectStyles() {
        if (document.getElementById('translationsub-card-flow-style')) return;
        var style = document.createElement('style');
        style.id = 'translationsub-card-flow-style';
        style.textContent =
            '.translationsub-full-button{position:relative}' +
            '.translationsub-full-button>svg{width:1.2em;height:1.35em;flex-shrink:0}' +
            '.translationsub-full-button[data-translationsub-card-flow="1"]{gap:.55em}' +
            '.translationsub-full-button[data-translationsub-card-flow="1"] span{white-space:nowrap}' +
            '.translationsub-full-button--subscribed:after{' +
                'content:"";position:absolute;width:.42em;height:.42em;border-radius:50%;background:#f47a42;' +
                'right:.36em;top:.34em;box-shadow:0 0 0 .12em rgba(0,0,0,.16)' +
            '}' +
            '.translationsub-full-button--subscribed.focus:after{box-shadow:0 0 0 .12em rgba(255,255,255,.45)}';
        (document.head || document.documentElement).appendChild(style);
    }

    function lower(value) {
        return String(value || '').toLowerCase().trim();
    }

    function detectSerialCard(object, card) {
        object = object || {};
        card = card || {};

        var method = lower(object.method || card.method);
        var mediaType = lower(object.media_type || card.media_type || object.type || card.type);

        if (method === 'movie' || method === 'film' || mediaType === 'movie' || mediaType === 'film') return false;
        if (method === 'tv' || method === 'serial' || mediaType === 'tv' || mediaType === 'serial') return true;

        if (card.first_air_date) return true;
        if (Number(card.number_of_seasons || card.seasons_count || 0) > 0) return true;
        if (card.last_episode_to_air || card.next_episode_to_air) return true;
        if (Array.isArray(card.seasons)) {
            for (var i = 0; i < card.seasons.length; i++) {
                var season = card.seasons[i] || {};
                if (Number(season.season_number !== undefined ? season.season_number : season.number) > 0) return true;
            }
        }

        if (card.release_date || card.original_title) return false;
        return !!(card.original_name && !card.title);
    }

    function normalizeFull(object) {
        object = object || {};
        var card = object.movie || object.card || object.data || object;
        var source = lower(object.source || card.source || card.card_source);
        var isSerial = detectSerialCard(object, card);
        var explicitTmdbId = card.tmdb_id || card.tmdbId || '';
        var cardId = card.id || object.id || '';
        var tmdbId = explicitTmdbId || ((source && source !== 'tmdb' && source !== 'themoviedb') ? '' : cardId);
        var kpId = card.kinopoisk_id || card.kp_id || card.kpId || (card.external_ids && card.external_ids.kinopoisk_id) || '';
        var imdbId = card.imdb_id || card.imdbId || (card.external_ids && card.external_ids.imdb_id) || '';
        var title = card.title || card.name || object.title || '';
        var originalTitle = card.original_title || card.original_name || '';
        var date = card.first_air_date || card.release_date || '';
        var year = date && String(date).length >= 4 ? String(date).slice(0, 4) : (card.year || '');
        var poster = card.poster_path || card.poster || card.img || card.image || '';
        var contentId = card.content_id || card.contentId || tmdbId || kpId || imdbId || cardId || title || '';

        return {
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
        if (!context || !context.isSerial) return done(context);
        if (context.tmdbId && context.kpId && context.imdbId) return done(context);

        request('GET', API.externalids, {
            id: context.tmdbId || context.contentId,
            serial: 1,
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
        }, function () { done(context); });
    }

    function value(item, pascal, camel, fallback) {
        if (!item) return fallback;
        if (item[pascal] !== undefined && item[pascal] !== null) return item[pascal];
        if (item[camel] !== undefined && item[camel] !== null) return item[camel];
        return fallback;
    }

    function normalizeVoice(value) {
        return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, '').trim();
    }

    function voiceName(variant) {
        var id = String(variant.Id || variant.id || variant.translation_id || '');
        return String(variant.Name || variant.name || variant.translation || ('Озвучка ' + id));
    }

    function voiceId(variant) {
        return String(variant.Id || variant.id || variant.translation_id || '');
    }

    function sourceName(source) {
        source = lower(source);
        return SOURCE_NAMES[source] || source || 'Источник';
    }

    function variantSources(variant) {
        var sources = variant.Sources || variant.sources || [];
        if (Array.isArray(sources) && sources.length) return sources;
        return [{
            Source: variant.source || variant.Source || '',
            Path: variant.path || variant.Path || '',
            TranslationId: variant.translation_id || variant.Id || variant.id || '',
            TranslationName: variant.translation || variant.Name || variant.name || ''
        }];
    }

    function sourceSummary(variant) {
        var names = [];
        variantSources(variant).forEach(function (source) {
            var name = sourceName(source.Source || source.source || '');
            if (name && names.indexOf(name) === -1) names.push(name);
        });
        return names.join(', ');
    }

    function sameContent(item, context) {
        var content = String(value(item, 'ContentId', 'contentId', '') || '');
        var tmdb = String(value(item, 'TmdbId', 'tmdbId', '') || '');
        var imdb = String(value(item, 'ImdbId', 'imdbId', '') || '');
        var kp = String(value(item, 'KpId', 'kpId', '') || '');
        if (content && context.contentId && content === context.contentId) return true;
        if (tmdb && context.tmdbId && tmdb === context.tmdbId) return true;
        if (imdb && context.imdbId && imdb.toLowerCase() === context.imdbId.toLowerCase()) return true;
        return !!(kp && context.kpId && kp === context.kpId);
    }

    function findExisting(subscriptions, context, variant, season) {
        var id = voiceId(variant);
        var name = normalizeVoice(voiceName(variant));
        for (var i = 0; i < subscriptions.length; i++) {
            var item = subscriptions[i];
            if (!sameContent(item, context)) continue;
            if (Number(value(item, 'CurrentSeason', 'currentSeason', 1) || 1) !== Number(season || 1)) continue;
            var itemId = String(value(item, 'TranslationId', 'translationId', '') || '');
            var itemName = normalizeVoice(value(item, 'TranslationName', 'translationName', ''));
            if ((id && itemId && id === itemId) || (name && itemName && name === itemName)) return item;
        }
        return null;
    }

    function timelineCard(context) {
        var card = context.card || {};
        var original = card.original_name || card.original_title || context.originalTitle || context.title || '';
        return { original_name: original, original_title: original };
    }

    function watchedEpisode(context, season, knownEpisodes) {
        if (!context.isSerial) return 0;
        var limit = Number(knownEpisodes || 0) || MAX_EPISODE_SCAN;
        limit = Math.max(1, Math.min(MAX_EPISODE_SCAN, limit));
        var highest = 0;

        try {
            if (!window.Lampa || !Lampa.Timeline || typeof Lampa.Timeline.watchedEpisode !== 'function') return 0;
            for (var episode = 1; episode <= limit; episode++) {
                var percent = Number(Lampa.Timeline.watchedEpisode(timelineCard(context), season, episode) || 0);
                if (percent >= WATCHED_PERCENT) highest = episode;
            }
        } catch (e) {}
        return highest;
    }

    function seasonMetadata(context) {
        var card = context.card || {};
        var map = {};
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
        for (var i = 1; i <= total; i++) if (!map[i]) map[i] = { number: i, episodeCount: 0, airDate: '' };

        var last = Number(card.last_episode_to_air && card.last_episode_to_air.season_number || 0) || 0;
        var next = Number(card.next_episode_to_air && card.next_episode_to_air.season_number || 0) || 0;
        if (last > 0 && !map[last]) map[last] = { number: last, episodeCount: 0, airDate: '' };
        if (next > 0 && !map[next]) map[next] = { number: next, episodeCount: 0, airDate: '' };

        var list = Object.keys(map).map(function (key) { return map[key]; });
        list.sort(function (a, b) { return b.number - a.number; });
        return list;
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

        var preferred = lastWatchedSeason;
        if (!preferred)
            preferred = Number(context.card && context.card.last_episode_to_air && context.card.last_episode_to_air.season_number || 0) || 0;

        if (!preferred) {
            var now = Date.now ? Date.now() : new Date().getTime();
            for (var i = 0; i < seasons.length; i++) {
                var time = seasons[i].airDate ? new Date(seasons[i].airDate).getTime() : NaN;
                if (!isNaN(time) && time <= now) {
                    preferred = seasons[i].number;
                    break;
                }
            }
        }

        if (!preferred) preferred = seasons[0].number || 1;
        return { seasons: seasons, watched: watched, preferredSeason: preferred };
    }

    function activeComponent() {
        try {
            if (!window.Lampa || !Lampa.Activity || typeof Lampa.Activity.active !== 'function') return '';
            var active = Lampa.Activity.active() || {};
            return lower(active.component ||
                (active.object && active.object.component) ||
                (active.activity && active.activity.component) || '');
        } catch (e) {
            return '';
        }
    }

    function isFullActive() {
        var component = activeComponent();
        if (component) return component === 'full';
        try {
            return typeof $ === 'function' && $('.full-start:visible,.full-start-new:visible').length > 0;
        } catch (e) {
            return false;
        }
    }

    function validFlow(token) {
        return token === flowToken && isFullActive();
    }

    function restoreContentController() {
        setTimeout(function () {
            try {
                if (window.Lampa && Lampa.Controller && typeof Lampa.Controller.toggle === 'function')
                    Lampa.Controller.toggle('content');
            } catch (e) {}
        }, 0);
    }

    function closeSelectAndRestore() {
        try {
            if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') Lampa.Select.close();
        } catch (e) {}
        restoreContentController();
    }

    function showSelect(title, items, token) {
        items = items || [];
        if (!validFlow(token)) return;
        if (!items.length) return notify('Нечего показывать');
        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') return notify(title);

        Lampa.Select.show({
            title: title,
            items: items,
            onSelect: function (item) {
                closeSelectAndRestore();
                if (item && typeof item.onclick === 'function') {
                    setTimeout(function () {
                        if (token === flowToken) item.onclick();
                    }, 0);
                }
            },
            onBack: function () {
                flowToken++;
                closeSelectAndRestore();
            }
        });
    }

    function loadSubscriptions(success, error) {
        request('GET', API.list, { userKey: userKey() }, null, function (list) {
            success(Array.isArray(list) ? list : []);
        }, error);
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
            isSerial: true,
            season: Number(season || 0),
            serial: true,
            sources: enabledSources().join(',')
        }, null, success, error);
    }

    function refreshState() {
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function')
                window.TranslationSubBadgeState.refresh();
        } catch (e) {}
        try {
            if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function')
                window.TranslationSubWatch.sync();
        } catch (e2) {}
        scheduleApply(lastEvent, 0);
    }

    function subscribe(context, variant, season) {
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
            isSerial: true,
            source: mainSource,
            translationId: voiceId(variant),
            translationName: voiceName(variant),
            currentSeason: String(Number(season || 1)),
            currentEpisode: String(latestEpisode),
            availableEpisode: String(latestEpisode),
            watchedEpisode: String(watched),
            sources: bodySources
        }, function () {
            busy = false;
            notify('Подписка оформлена · ' + voiceName(variant) + ' · ' + Number(season || 1) + ' сезон');
            refreshState();
        }, function () {
            busy = false;
            notify('Не удалось оформить подписку · ' + voiceName(variant));
        });
    }

    function unsubscribe(context, variant, season, existing) {
        if (busy) return;
        var id = String(value(existing, 'Id', 'id', '') || '');
        if (!id) return notify('Не удалось определить подписку для удаления');
        busy = true;

        request('POST', API.remove, { id: id }, null, function () {
            busy = false;
            notify('Вы отписались · ' + voiceName(variant) + ' · ' + Number(season || 1) + ' сезон');
            refreshState();
        }, function () {
            busy = false;
            notify('Не удалось отписаться · ' + voiceName(variant));
        });
    }

    function openVoices(context, season, token) {
        if (!context || !context.isSerial || !validFlow(token)) return;
        season = Number(season || 1) || 1;

        loadSubscriptions(function (subscriptions) {
            if (!validFlow(token)) return;

            loadVariants(context, season, function (response) {
                if (!validFlow(token)) return;

                var variants = response.Translations || response.translations || [];
                variants = Array.isArray(variants) ? variants.slice() : [];
                variants = variants.filter(function (variant) {
                    return Number(variant.season || season || 1) === season;
                });

                if (!variants.length) {
                    notify('Озвучки для ' + season + ' сезона пока не найдены');
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

                    if (existing) subtitle.push('Подписка активна · нажмите, чтобы отписаться');
                    else if (latest > 0) subtitle.push('Доступно до ' + latest + ' серии');
                    else subtitle.push('Нажмите, чтобы подписаться');
                    if (sources) subtitle.push(sources);
                    if (quality) subtitle.push(quality);

                    return {
                        title: (existing ? '✓ ' : '') + voiceName(variant),
                        subtitle: subtitle.join(' · '),
                        selected: !!existing,
                        onclick: function () {
                            if (existing) unsubscribe(context, variant, season, existing);
                            else subscribe(context, variant, season);
                        }
                    };
                });

                showSelect('Озвучки · ' + season + ' сезон', items, token);
            }, function () {
                if (validFlow(token)) notify('Не удалось загрузить список озвучек');
            });
        }, function () {
            if (validFlow(token)) notify('Не удалось загрузить ваши подписки');
        });
    }

    function openSeasonMenu(context, token) {
        if (!context || !context.isSerial || !validFlow(token)) return;
        if (context.season > 0) return openVoices(context, context.season, token);

        var progress = seasonProgress(context);
        var seasons = progress.seasons;
        if (seasons.length === 1) return openVoices(context, seasons[0].number, token);

        var items = seasons.map(function (season) {
            var watched = Number(progress.watched[season.number] || 0);
            var subtitle = watched > 0
                ? ('Просмотрено до ' + watched + ' серии')
                : (season.number === progress.preferredSeason ? 'Актуальный сезон' : 'Не начат');
            if (season.episodeCount > 0) subtitle += ' · всего ' + season.episodeCount + ' серий';

            return {
                title: season.number + ' сезон',
                subtitle: subtitle,
                selected: season.number === progress.preferredSeason,
                onclick: function () { openVoices(context, season.number, token); }
            };
        });

        showSelect('Выберите сезон', items, token);
    }

    function openForItem(object) {
        var context = object && object.card && object.contentId ? object : normalizeFull(object || {});
        if (!context.isSerial) return;
        if (!context.contentId && !context.title) return notify('Не удалось определить карточку сериала');
        if (!enabledSources().length) return notify('Включите хотя бы один балансер в настройках');

        var token = ++flowToken;
        ensureExternalIds(context, function (resolved) {
            if (!resolved || !validFlow(token)) return;
            openSeasonMenu(resolved, token);
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

    function removeButton(event) {
        if (typeof $ !== 'function') return;
        var root = buttonRoot(event);
        if (root && root.length) root.find('.translationsub-full-button').remove();
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

        if (!context.isSerial) {
            removeButton(event);
            return;
        }

        if (!context.contentId && !context.title) {
            removeButton(event);
            return;
        }

        var button = ensureButton(event);
        if (!button || !button.length) return;
        button.off('.translationsubCardFlow');
        button.empty().append(bellSvg()).append('<span>Озвучки</span>');
        button.attr('data-translationsub-card-flow', '1').attr('title', 'Подписки на озвучки');

        button.on('hover:enter.translationsubCardFlow', function () { openForItem(context); });
        button.on('hover:long.translationsubCardFlow', function () {
            try {
                if (window.TranslationSub && typeof window.TranslationSub.openSubscriptions === 'function')
                    window.TranslationSub.openSubscriptions();
            } catch (e) {}
        });

        loadSubscriptions(function (subscriptions) {
            if (!button.closest('body').length) return;
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
        }, typeof delay === 'number' ? delay : 100);
    }

    function expose() {
        if (!window.TranslationSub) return false;
        window.TranslationSub.openForItem = openForItem;
        window.TranslationSub.cardFlow = {
            open: openForItem,
            refreshButton: function () { scheduleApply(lastEvent, 0); }
        };
        return true;
    }

    function bind() {
        if (!window.Lampa || !Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return;

        Lampa.Listener.follow('full', function (event) {
            if (!event) return;
            if (event.type === 'complite') {
                flowToken++;
                scheduleApply(event, 100);
            }
            if (event.type === 'destroy' || event.type === 'close') {
                flowToken++;
                clearTimeout(applyTimer);
            }
        });

        try {
            if (Lampa.Timeline && Lampa.Timeline.listener && typeof Lampa.Timeline.listener.follow === 'function') {
                Lampa.Timeline.listener.follow('update', function () {
                    if (lastEvent) scheduleApply(lastEvent, 220);
                });
            }
        } catch (e) {}
    }

    function start() {
        if (!window.Lampa) return;
        injectStyles();
        bind();
        expose();

        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (expose() || attempts > 40) clearInterval(wait);
        }, 100);
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