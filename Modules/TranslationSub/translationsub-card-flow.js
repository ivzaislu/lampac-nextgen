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

    var lastEvent = null;
    var applyTimer = null;
    var flowToken = 0;
    var busy = false;

    function lower(value) {
        return String(value || '').toLowerCase().trim();
    }

    function truthy(value) {
        return value === true || value === 1 || value === '1' || value === 'true';
    }

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

    function storageSet(name, value) {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.set === 'function') {
                Lampa.Storage.set(name, value);
                return;
            }
        } catch (e) {}
        try { localStorage.setItem(name, value); } catch (e2) {}
    }

    function selectedSources() {
        try {
            if (window.TranslationSub && typeof window.TranslationSub.enabledSources === 'function')
                return window.TranslationSub.enabledSources() || [];
        } catch (e) {}
        return [];
    }

    function lampacUid() {
        try {
            if (window.TranslationSub && typeof window.TranslationSub.uid === 'function')
                return String(window.TranslationSub.uid() || '');
        } catch (e) {}

        var uid = String(storageGet('lampac_unic_id', '') || '');
        if (uid) return uid;
        try {
            if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.uid === 'function')
                uid = String(Lampa.Utils.uid(8) || '').toLowerCase();
        } catch (e2) {}
        if (!uid) uid = Math.random().toString(36).slice(2, 10).toLowerCase();
        storageSet('lampac_unic_id', uid);
        return uid;
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
        } catch (e2) { error(e2); }
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

    function bellSvg(filled) {
        if (filled) {
            return '<svg class="translationsub-full-button__bell" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<path d="M12 22a2.4 2.4 0 0 0 2.35-2h-4.7A2.4 2.4 0 0 0 12 22Zm7-5-2-2v-5a5 5 0 0 0-4-4.9V4a1 1 0 0 0-2 0v1.1A5 5 0 0 0 7 10v5l-2 2v1h14v-1Z"></path>' +
            '</svg>';
        }
        return '<svg class="translationsub-full-button__bell" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
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
            '.translationsub-full-button>.translationsub-full-button__bell{width:1.2em;height:1.35em;flex-shrink:0}' +
            '.translationsub-full-button[data-translationsub-card-flow="1"]{gap:.55em}' +
            '.translationsub-full-button[data-translationsub-card-flow="1"] span{white-space:nowrap}';
        (document.head || document.documentElement).appendChild(style);
    }

    function hasSeasonData(card) {
        if (!card) return false;
        if (Number(card.number_of_seasons || card.seasons_count || 0) > 0) return true;
        if (Number(card.number_of_episodes || card.episodes_count || 0) > 0) return true;
        if (card.first_air_date || card.last_air_date) return true;
        if (card.last_episode_to_air || card.next_episode_to_air) return true;
        if (Array.isArray(card.episode_run_time) && card.episode_run_time.length) return true;
        if (Array.isArray(card.seasons)) {
            for (var i = 0; i < card.seasons.length; i++) {
                var season = card.seasons[i] || {};
                if (Number(season.season_number !== undefined ? season.season_number : season.number) > 0) return true;
            }
        }
        return false;
    }

    function detectSerialCard(object, card) {
        object = object || {};
        card = card || {};
        var method = lower(object.method || card.method);
        var mediaType = lower(object.media_type || card.media_type || object.type || card.type);
        var explicitMovie = method === 'movie' || method === 'film' || mediaType === 'movie' || mediaType === 'film';
        var explicitTv = method === 'tv' || method === 'serial' || mediaType === 'tv' || mediaType === 'serial' || mediaType === 'series';
        if (explicitTv) return true;
        if (truthy(object.serial) || truthy(card.serial) || truthy(object.is_serial) || truthy(card.is_serial) || truthy(card.isSerial)) return true;
        if (Number(object.season || card.season || 0) > 0) return true;
        if (hasSeasonData(card)) return true;
        if (card.original_name && !card.original_title) return true;
        if (explicitMovie) return false;
        if (card.release_date || card.original_title) return false;
        return false;
    }

    function normalizeFull(object) {
        object = object || {};
        var card = object.movie || object.card || object.data || object;
        var source = lower(object.source || card.source || card.card_source);
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
            isSerial: detectSerialCard(object, card),
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

    function normalizeVoice(text) {
        return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, '').trim();
    }

    function voiceName(variant) {
        var id = String(variant.Id || variant.id || variant.translation_id || '');
        return String(variant.Name || variant.name || variant.translation || ('Озвучка ' + id));
    }

    function voiceId(variant) {
        return String(variant.Id || variant.id || variant.translation_id || '');
    }

    function variantSources(variant) {
        var sources = variant.Sources || variant.sources || [];
        if (Array.isArray(sources) && sources.length) return sources;
        return [{
            Source: variant.source || variant.Source || '',
            TranslationId: variant.translation_id || variant.Id || variant.id || '',
            TranslationName: variant.translation || variant.Name || variant.name || ''
        }];
    }

    function sourceSummary(variant) {
        var names = [];
        variantSources(variant).forEach(function (source) {
            var name = String(source.Source || source.source || '').trim();
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

    function activeFull() {
        try { return typeof $ === 'function' && $('.full-start:visible,.full-start-new:visible').length > 0; }
        catch (e) { return false; }
    }

    function validFlow(token) {
        return token === flowToken && activeFull();
    }

    function restoreContentController() {
        setTimeout(function () {
            try {
                if (window.Lampa && Lampa.Controller && typeof Lampa.Controller.toggle === 'function')
                    Lampa.Controller.toggle('content');
            } catch (e) {}
        }, 0);
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
                restoreContentController();
                if (item && typeof item.onclick === 'function') {
                    setTimeout(function () { if (token === flowToken) item.onclick(); }, 0);
                }
            },
            onBack: function () {
                flowToken++;
                restoreContentController();
            }
        });
    }

    function loadSubscriptions(success, error) {
        request('GET', API.list, { uid: lampacUid() }, null, function (list) {
            success(Array.isArray(list) ? list : []);
        }, error);
    }

    function loadVariants(context, season, success, error) {
        request('GET', API.variants, {
            contentId: context.contentId,
            title: context.title,
            originalTitle: context.originalTitle,
            kpId: context.kpId,
            imdbId: context.imdbId,
            tmdbId: context.tmdbId,
            year: context.year,
            isSerial: true,
            season: Number(season || 1),
            serial: true,
            uid: lampacUid()
        }, null, success, error);
    }

    function dateHasAired(value) {
        if (!value) return false;
        var time = new Date(value).getTime();
        if (isNaN(time)) return false;
        return time <= (Date.now ? Date.now() : new Date().getTime());
    }

    function latestAiredSeason(context) {
        var card = context && context.card || {};
        var lastEpisode = card.last_episode_to_air || {};
        var season = Number(lastEpisode.season_number || lastEpisode.season || 0) || 0;
        if (season > 0) return season;

        var bestAired = 0;
        var bestKnown = 0;
        if (Array.isArray(card.seasons)) {
            card.seasons.forEach(function (item) {
                item = item || {};
                var number = Number(item.season_number !== undefined ? item.season_number : item.number) || 0;
                if (number <= 0) return;
                bestKnown = Math.max(bestKnown, number);
                if (dateHasAired(item.air_date)) bestAired = Math.max(bestAired, number);
            });
        }
        if (bestAired > 0) return bestAired;

        var nextEpisode = card.next_episode_to_air || {};
        var nextSeason = Number(nextEpisode.season_number || nextEpisode.season || 0) || 0;
        var nextNumber = Number(nextEpisode.episode_number || nextEpisode.episode || 0) || 0;
        if (nextSeason > 0) {
            if (nextNumber > 1) return nextSeason;
            if (nextSeason > 1) return nextSeason - 1;
        }
        if (bestKnown > 0) return bestKnown;
        var total = Number(card.number_of_seasons || card.seasons_count || 0) || 0;
        if (total > 0) return total;
        if (context && context.season > 0) return context.season;
        return 1;
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

        var bodySources = variantSources(variant).map(function (source) {
            return {
                source: source.Source || source.source || '',
                translationId: String(source.TranslationId || source.translationId || voiceId(variant)),
                translationName: source.TranslationName || source.translationName || voiceName(variant)
            };
        });
        var latestEpisode = Number(variant.episode || 0) || 0;
        var mainSource = bodySources.length > 1 ? 'multi' :
            (bodySources.length ? bodySources[0].source : (variant.source || 'lampac'));

        request('POST', API.add, null, {
            uid: lampacUid(),
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
            watchedEpisode: '0',
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

        request('POST', API.remove, { id: id, uid: lampacUid() }, null, function () {
            busy = false;
            notify('Вы отписались · ' + voiceName(variant) + ' · ' + Number(season || 1) + ' сезон');
            refreshState();
        }, function () {
            busy = false;
            notify('Не удалось отписаться · ' + voiceName(variant));
        });
    }

    function openVoices(context, season, token) {
        season = Number(season || 1) || 1;
        if (!validFlow(token)) return;

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
                    notify(selectedSources().length
                        ? ('Озвучки для ' + season + ' сезона пока не найдены')
                        : 'Выберите балансеры для опроса в настройках TranslationSub');
                    restoreContentController();
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
                    var subtitle = [];
                    if (existing) subtitle.push('Подписка активна · нажмите, чтобы отписаться');
                    else if (latest > 0) subtitle.push('Доступно до ' + latest + ' серии');
                    else subtitle.push('Нажмите, чтобы подписаться');
                    if (sources) subtitle.push(sources);

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
                restoreContentController();
            });
        }, function () {
            if (validFlow(token)) notify('Не удалось загрузить ваши подписки');
            restoreContentController();
        });
    }

    function openForItem(object) {
        var context = object && object.card && object.contentId ? object : normalizeFull(object || {});
        if (!context.isSerial) return;
        if (!context.contentId && !context.title) return notify('Не удалось определить карточку сериала');

        var token = ++flowToken;
        ensureExternalIds(context, function (resolved) {
            if (!resolved || !validFlow(token)) return;
            openVoices(resolved, latestAiredSeason(resolved), token);
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

    function renderButton(button, active) {
        if (!button || !button.length) return;
        button.empty().append(bellSvg(!!active)).append('<span>Озвучки</span>');
        button.toggleClass('translationsub-full-button--subscribed', !!active);
        button.attr('title', active ? 'Озвучки · подписка активна' : 'Подписки на озвучки');
    }

    function applyButton(event) {
        if (typeof $ !== 'function') return;
        var payload = event && (event.data || event.object) || {};
        var context = normalizeFull(payload);
        if (!context.isSerial || (!context.contentId && !context.title)) {
            removeButton(event);
            return;
        }

        var button = ensureButton(event);
        if (!button || !button.length) return;
        button.off('.translationsubCardFlow');
        renderButton(button, false);
        button.attr('data-translationsub-card-flow', '1');
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
            renderButton(button, active);
        }, function () {});
    }

    function scheduleApply(event, delay) {
        lastEvent = event || lastEvent;
        clearTimeout(applyTimer);
        applyTimer = setTimeout(function () {
            if (lastEvent) applyButton(lastEvent);
        }, typeof delay === 'number' ? delay : 80);
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
            if (!event || event.type !== 'complite') return;
            flowToken++;
            scheduleApply(event, 80);
        });
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
            } else if (attempts > 80) clearInterval(wait);
        }, 250);
    }
})();
