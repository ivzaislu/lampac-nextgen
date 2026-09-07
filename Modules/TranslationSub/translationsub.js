(function () {
    'use strict';

    if (window.__TranslationSubPluginStarted) return;
    window.__TranslationSubPluginStarted = true;

    var META = {
        component: 'translationsub',
        name: 'Подписки на озвучки',
        version: '2.0.0',
        description: 'Подписки на озвучки и уведомления о новых сериях',
        type: 'other'
    };

    var API = {
        list: '/translationsub/list',
        updates: '/translationsub/updates',
        variants: '/translationsub/variants',
        toggle: '/translationsub/toggle',
        remove: '/translationsub/remove',
        notified: '/translationsub/notified',
        externalids: '/externalids'
    };

    var SETTINGS = {
        component: 'translationsub_settings',
        flixcdn: 'translationsub_flixcdn',
        phantom: 'translationsub_phantom',
        zetflixdb: 'translationsub_zetflixdb',
        videohub: 'translationsub_videohub',
        interval: 'translationsub_interval'
    };

    var SOURCE_NAMES = {
        flixcdn: 'FlixCDN',
        phantom: 'Phantom',
        zetflixdb: 'ZetflixDB',
        cdnvideohub: 'VideoHUB',
        multi: 'Несколько источников'
    };

    var state = {
        started: false,
        current: null,
        updates: [],
        headButton: null,
        badge: null,
        network: null,
        pollTimer: null,
        variantsCache: {}
    };

    var VARIANTS_CACHE_TTL = 10 * 60 * 1000;

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[TranslationSub]');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function escapeHtml(value) {
        try {
            if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.escape === 'function')
                return Lampa.Utils.escape(String(value || ''));
        } catch (e) {}

        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function detectHost() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');

            var script = document.currentScript;
            if (!script || !script.src) {
                var scripts = document.getElementsByTagName('script');
                for (var i = scripts.length - 1; i >= 0; i--) {
                    if (scripts[i].src && scripts[i].src.indexOf('/translationsub.js') !== -1) {
                        script = scripts[i];
                        break;
                    }
                }
            }

            if (script && script.src && typeof URL === 'function')
                return new URL(script.src, window.location.href).origin;
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

    function checkIntervalMinutes() {
        var value = parseInt(storageGet(SETTINGS.interval, '15'), 10);
        return [5, 10, 15, 30, 60].indexOf(value) >= 0 ? value : 15;
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

    function parseJson(value) {
        if (value === null || value === undefined || value === '') return {};
        if (typeof value === 'object') return value;
        try { return JSON.parse(value); } catch (e) { return {}; }
    }

    function request(method, path, params, body, onSuccess, onError) {
        onSuccess = onSuccess || function () {};
        onError = onError || function () {};

        var qs = query(params);
        var url = HOST + path + (qs ? (path.indexOf('?') === -1 ? '?' : '&') + qs : '');

        if (method === 'GET') {
            try {
                if (window.Lampa && Lampa.Reguest) {
                    if (!state.network && typeof Lampa.Reguest === 'function') state.network = new Lampa.Reguest();
                    if (state.network && typeof state.network.silent === 'function') {
                        state.network.silent(url, function (result) { onSuccess(parseJson(result)); }, onError);
                        return;
                    }
                }
            } catch (e) { log('Lampa.Reguest fallback', e); }
        }

        if (typeof fetch === 'function') {
            var options = { method: method, headers: { 'Content-Type': 'application/json; charset=utf-8' } };
            if (body && method !== 'GET') options.body = JSON.stringify(body);

            fetch(url, options)
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) { onSuccess(parseJson(text)); })
                .catch(onError);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) onSuccess(parseJson(xhr.responseText));
                else onError(new Error('HTTP ' + xhr.status));
            };
            xhr.send(body && method !== 'GET' ? JSON.stringify(body) : null);
        } catch (e2) { onError(e2); }
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(text);
                return;
            }
        } catch (e) {}
        log(text);
    }

    function bellSvg() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.4 2.4 0 0 0 2.35-2h-4.7A2.4 2.4 0 0 0 12 22Zm7-5-2-2v-5a5 5 0 0 0-4-4.9V4a1 1 0 0 0-2 0v1.1A5 5 0 0 0 7 10v5l-2 2v1h14v-1Z"/></svg>';
    }

    function registerManifest() {
        try {
            if (!window.Lampa) return;
            if (!Lampa.Manifest) Lampa.Manifest = {};

            var plugins = Lampa.Manifest.plugins;
            if (Array.isArray(plugins)) {
                var exists = plugins.some(function (plugin) { return plugin && plugin.component === META.component; });
                if (!exists) plugins.push(META);
                return;
            }

            if (!plugins || typeof plugins !== 'object') {
                plugins = {};
                Lampa.Manifest.plugins = plugins;
            }
            plugins[META.component] = META;
        } catch (e) { log('manifest registration failed', e); }
    }

    function injectStyles() {
        if (document.getElementById('translationsub-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-style';
        style.textContent =
            '.translationsub-head{position:relative}' +
            '.translationsub-head svg,.translationsub-full-button svg{width:1.35em;height:1.35em;fill:currentColor}' +
            '.translationsub-badge{position:absolute;right:-.25em;top:-.25em;min-width:1.5em;height:1.5em;padding:0 .3em;border-radius:1em;background:#e53935;color:#fff;font-size:.7em;display:flex;align-items:center;justify-content:center;box-sizing:border-box}' +
            '.translationsub-page{padding:1.2em 1.5em 3em;box-sizing:border-box;max-width:76em}' +
            '.translationsub-page__title{font-size:2em;font-weight:500;margin-bottom:.15em}' +
            '.translationsub-page__subtitle{opacity:.65;margin-bottom:1.2em}' +
            '.translationsub-toolbar{display:flex;gap:.7em;flex-wrap:wrap;margin-bottom:1.2em}' +
            '.translationsub-toolbar__item{padding:.75em 1em;border-radius:.55em;background:rgba(255,255,255,.09);display:flex;align-items:center;gap:.55em}' +
            '.translationsub-toolbar__item.focus{background:#fff;color:#111}' +
            '.translationsub-toolbar__item svg{width:1.2em;height:1.2em;fill:currentColor}' +
            '.translationsub-list{display:flex;flex-direction:column;gap:.65em}' +
            '.translationsub-card{display:flex;align-items:stretch;min-height:8.4em;border-radius:.7em;background:rgba(255,255,255,.075);overflow:hidden;position:relative}' +
            '.translationsub-card.focus{background:#fff;color:#111;transform:scale(1.01)}' +
            '.translationsub-card__poster{width:5.6em;min-width:5.6em;background:rgba(0,0,0,.2);overflow:hidden}' +
            '.translationsub-card__poster img{width:100%;height:100%;object-fit:cover;display:block}' +
            '.translationsub-card__poster-empty{width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:.35}' +
            '.translationsub-card__poster-empty svg{width:2em;height:2em;fill:currentColor}' +
            '.translationsub-card__body{padding:.85em 1em;min-width:0;display:flex;flex-direction:column;justify-content:center}' +
            '.translationsub-card__title{font-size:1.2em;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.translationsub-card__voice{margin-top:.3em;opacity:.85}' +
            '.translationsub-card__meta{margin-top:.45em;font-size:.9em;opacity:.58}' +
            '.translationsub-card__new{position:absolute;right:.7em;top:.7em;padding:.3em .55em;border-radius:1em;background:#e53935;color:#fff;font-size:.72em;font-weight:600}' +
            '.translationsub-empty{padding:2em 1em;opacity:.6;text-align:center}' +
            '@media(max-width:700px){.translationsub-page{padding:1em}.translationsub-card__poster{width:4.8em;min-width:4.8em}.translationsub-card{min-height:7em}}';
        (document.head || document.documentElement).appendChild(style);
    }

    function setBadge(count) {
        count = Number(count) || 0;
        if (!state.headButton || !state.headButton.length) return;

        if (!state.badge || !state.badge.length) {
            state.badge = $('<div class="translationsub-badge"></div>');
            state.headButton.append(state.badge);
        }

        if (count > 0) state.badge.text(count > 99 ? '99+' : String(count)).show();
        else state.badge.hide();
    }

    function openSubscriptionsPage() {
        if (!window.Lampa || !Lampa.Activity) return;
        Lampa.Activity.push({
            url: '',
            title: META.name,
            component: 'translationsub_list',
            page: 1
        });
    }

    function injectHeadButton() {
        if (typeof $ !== 'function') return;
        var row = $('.head__actions').first();
        if (!row.length) return;

        var existing = row.find('.translationsub-head').first();
        if (existing.length) {
            state.headButton = existing;
            setBadge(state.updates.length);
            return;
        }

        var button = $('<div class="head__action selector translationsub-head" title="' + META.name + '">' + bellSvg() + '</div>');
        button.on('hover:enter', openSubscriptionsPage);
        row.append(button);

        state.headButton = button;
        setBadge(state.updates.length);
    }

    function posterUrl(path) {
        path = String(path || '');
        if (!path) return '';
        if (/^https?:\/\//i.test(path)) return path;

        try {
            if (window.Lampa && Lampa.Api && typeof Lampa.Api.img === 'function')
                return Lampa.Api.img(path, 'w300');
        } catch (e) {}

        if (path.charAt(0) === '/') return 'https://image.tmdb.org/t/p/w300' + path;
        return path;
    }

    function normalizeFull(object) {
        object = object || {};
        var card = object.movie || object.card || object.data || object;
        var method = object.method || card.method || '';
        var isSerial = method === 'tv' || method === 'serial' || !!card.first_air_date || !!card.name || !!card.number_of_seasons;

        var tmdbId = card.tmdb_id || card.tmdbId || card.id || '';
        var kpId = card.kinopoisk_id || card.kp_id || card.kpId || (card.external_ids && card.external_ids.kinopoisk_id) || '';
        var imdbId = card.imdb_id || card.imdbId || (card.external_ids && card.external_ids.imdb_id) || '';
        var title = card.title || card.name || object.title || '';
        var originalTitle = card.original_title || card.original_name || '';
        var date = card.release_date || card.first_air_date || '';
        var year = date && String(date).length >= 4 ? String(date).slice(0, 4) : (card.year || '');
        var poster = card.poster_path || card.poster || card.img || card.image || '';

        return {
            raw: object,
            card: card,
            contentId: String(tmdbId || kpId || imdbId || title || ''),
            title: title,
            originalTitle: originalTitle,
            tmdbId: String(tmdbId || ''),
            kpId: String(kpId || ''),
            imdbId: String(imdbId || ''),
            year: String(year || ''),
            poster: String(poster || ''),
            isSerial: isSerial,
            season: 0
        };
    }

    function ensureExternalIds(context, done) {
        if (!context || (!context.tmdbId && !context.contentId)) {
            done(context);
            return;
        }

        if (context.kpId && context.imdbId) {
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
        }, function () { done(context); });
    }

    function injectFullButton(event) {
        if (typeof $ !== 'function') return;

        var payload = event && (event.data || event.object) || {};
        var context = normalizeFull(payload);
        if (!context.contentId && !context.title) return;
        state.current = context;

        var root = null;
        try {
            if (event && event.object && event.object.activity && typeof event.object.activity.render === 'function')
                root = event.object.activity.render();
        } catch (e) {}

        if (!root || !root.length) {
            root = $('.full-start').first();
            if (!root.length) root = $('.full-start-new').first();
        }
        if (!root || !root.length) return;

        root.find('.translationsub-full-button').remove();

        var row = root.find('.full-start-new__buttons').first();
        if (!row.length) row = root.find('.full-start__buttons').first();
        if (!row.length) return;

        var button = $('<div class="full-start__button selector translationsub-full-button"><div class="full-start__button-icon">' + bellSvg() + '</div><span>Озвучки</span></div>');
        button.on('hover:enter', function () { openForItem(context); });
        row.append(button);
    }

    function cacheKey(context) {
        return [context.contentId, context.season, context.kpId, context.imdbId, sourcesQuery()].join('|');
    }

    function clearVariantCache() {
        state.variantsCache = {};
    }

    function loadVariants(context, done, fail) {
        var key = cacheKey(context);
        var cached = state.variantsCache[key];
        var now = Date.now ? Date.now() : new Date().getTime();

        if (cached && now - cached.time < VARIANTS_CACHE_TTL) {
            done(cached.data);
            return;
        }

        if (!enabledSources().length) {
            fail && fail(new Error('no sources'));
            return;
        }

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
            season: context.season,
            serial: context.isSerial,
            sources: sourcesQuery()
        }, null, function (result) {
            state.variantsCache[key] = { time: now, data: result || {} };
            done(result || {});
        }, fail);
    }

    function subscriptionKey(item) {
        return [
            String(item.ContentId || item.contentId || ''),
            String(item.TranslationId || item.translationId || ''),
            String(item.CurrentSeason || item.currentSeason || 1)
        ].join('|');
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

    function sourceName(source) {
        source = String(source || '').toLowerCase();
        return SOURCE_NAMES[source] || source || 'Источник';
    }

    function sourceSummary(variant) {
        var names = [];
        variantSources(variant).forEach(function (item) {
            var name = sourceName(item.Source || item.source || '');
            if (name && names.indexOf(name) === -1) names.push(name);
        });
        return names.join(', ');
    }

    function openForItem(context) {
        context = context && context.card ? context : normalizeFull(context || state.current || {});
        if (!context.title && !context.contentId) {
            notify('Не удалось определить карточку');
            return;
        }

        if (!enabledSources().length) {
            notify('Включите хотя бы один балансер в настройках');
            return;
        }

        ensureExternalIds(context, function (resolved) {
            state.current = resolved;
            if (resolved.isSerial && (!resolved.season || resolved.season <= 0)) openSeasonSelect(resolved);
            else openVoiceSelect(resolved);
        });
    }

    function showSelect(title, items, onBack) {
        items = items || [];
        if (!items.length) {
            notify('Список пуст');
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

        notify(title + ': ' + items.length);
    }

    function openSeasonSelect(context) {
        notify('Ищу сезоны и озвучки…');
        loadVariants(context, function (response) {
            var seasons = response.Seasons || response.seasons || [];
            if (!Array.isArray(seasons) || !seasons.length) {
                var variants = response.Translations || response.translations || [];
                seasons = [];
                (Array.isArray(variants) ? variants : []).forEach(function (variant) {
                    var season = Number(variant.season || 0);
                    if (season > 0 && seasons.indexOf(season) === -1) seasons.push(season);
                });
                seasons.sort(function (a, b) { return a - b; });
            }

            if (!seasons.length) {
                notify('Сезоны или озвучки не найдены');
                return;
            }

            var items = seasons.map(function (season) {
                return {
                    title: season + ' сезон',
                    onclick: function () {
                        openVoiceSelect(Object.assign({}, context, { season: Number(season) }));
                    }
                };
            });
            showSelect('Выберите сезон', items);
        }, function () { notify('Не удалось получить сезоны'); });
    }

    function openVoiceSelect(context) {
        notify('Собираю озвучки…');

        request('GET', API.list, { userKey: userKey() }, null, function (subscriptions) {
            subscriptions = Array.isArray(subscriptions) ? subscriptions : [];
            var subscribed = {};
            subscriptions.forEach(function (item) { subscribed[subscriptionKey(item)] = true; });

            loadVariants(context, function (response) {
                var variants = response.Translations || response.translations || [];
                if (!Array.isArray(variants) || !variants.length) {
                    notify('Озвучки не найдены');
                    return;
                }

                if (context.isSerial && context.season > 0) {
                    variants = variants.filter(function (variant) {
                        return Number(variant.season || 0) === Number(context.season);
                    });
                }

                var items = variants.map(function (variant) {
                    var id = String(variant.Id || variant.id || variant.translation_id || '');
                    var name = variant.Name || variant.name || variant.translation || ('Озвучка ' + id);
                    var season = Number(variant.season || context.season || 1) || 1;
                    var episode = Number(variant.episode || 0) || 0;
                    var quality = variant.quality ? ' · ' + variant.quality : '';
                    var sources = sourceSummary(variant);
                    var isSubscribed = !!subscribed[[context.contentId, id, season].join('|')];

                    return {
                        title: (isSubscribed ? '✓ ' : '') + name + quality,
                        subtitle: (episode > 0 ? ('Серия ' + episode) : '') + (sources ? ((episode > 0 ? ' · ' : '') + sources) : ''),
                        onclick: function () {
                            toggle(context, variant, function (enabled) {
                                notify(enabled ? ('Подписка: ' + name) : ('Подписка удалена: ' + name));
                                openVoiceSelect(context);
                            });
                        }
                    };
                });

                showSelect('Озвучка' + (context.isSerial && context.season > 0 ? ' · ' + context.season + ' сезон' : ''), items);
            }, function () { notify('Не удалось получить список озвучек'); });
        }, function () { notify('Не удалось загрузить подписки'); });
    }

    function toggle(context, variant, done) {
        var bodySources = variantSources(variant).map(function (source) {
            return {
                source: source.Source || source.source || '',
                path: source.Path || source.path || '',
                translationId: String(source.TranslationId || source.translationId || ''),
                translationName: source.TranslationName || source.translationName || variant.translation || variant.Name || ''
            };
        });

        var mainSource = bodySources.length > 1 ? 'multi' : (bodySources.length ? bodySources[0].source : (variant.source || 'multi'));
        var body = {
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
            translationId: String(variant.Id || variant.id || variant.translation_id || ''),
            translationName: variant.Name || variant.name || variant.translation || '',
            currentSeason: String(context.isSerial ? (variant.season || context.season || 1) : 1),
            currentEpisode: String(variant.episode || 0),
            sources: bodySources
        };

        request('POST', API.toggle, null, body, function (result) {
            if (done) done(!!(result && (result.subscribed || result.Subscribed)));
            refreshUpdates(false);
        }, function () { notify('Не удалось изменить подписку'); });
    }

    function markNotified(item, done) {
        var id = item.id || item.Id;
        if (!id) {
            if (done) done();
            return;
        }

        request('POST', API.notified, { id: id }, null, function () {
            if (done) done();
        }, function () {
            if (done) done();
        });
    }

    function refreshUpdates(force, done) {
        request('GET', API.updates, {
            userKey: userKey(),
            force: force ? 'true' : 'false',
            sources: sourcesQuery()
        }, null, function (updates) {
            state.updates = Array.isArray(updates) ? updates : [];
            injectHeadButton();
            setBadge(state.updates.length);
            if (done) done(state.updates);
        }, function () {
            if (done) done([]);
        });
    }

    function forceCheckUpdatesUI(done) {
        if (!enabledSources().length) {
            notify('Включите хотя бы один балансер в настройках');
            if (done) done([]);
            return;
        }

        notify('Проверяю: ' + enabledSources().map(sourceName).join(' · '));
        refreshUpdates(true, function (updates) {
            notify(updates.length ? ('Новых серий: ' + updates.length) : 'Новых серий нет');
            if (done) done(updates);
        });
    }

    function schedulePolling() {
        if (state.pollTimer) clearInterval(state.pollTimer);
        state.pollTimer = setInterval(function () {
            refreshUpdates(true);
        }, checkIntervalMinutes() * 60 * 1000);
    }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi || window.__TranslationSubSettingsAdded) return;
        window.__TranslationSubSettingsAdded = true;

        Lampa.SettingsApi.addComponent({
            component: SETTINGS.component,
            name: META.name,
            icon: bellSvg()
        });

        function addSourceSetting(name, key, description) {
            Lampa.SettingsApi.addParam({
                component: SETTINGS.component,
                param: { name: key, type: 'trigger', values: '', 'default': true },
                field: { name: name, description: description },
                onChange: function () {
                    clearVariantCache();
                    refreshUpdates(false);
                }
            });
        }

        addSourceSetting('FlixCDN', SETTINGS.flixcdn, 'Использовать FlixCDN при поиске озвучек и проверке подписок');
        addSourceSetting('Phantom', SETTINGS.phantom, 'Использовать Phantom при поиске озвучек и проверке подписок');
        addSourceSetting('ZetflixDB', SETTINGS.zetflixdb, 'Использовать ZetflixDB при поиске озвучек и проверке подписок');
        addSourceSetting('VideoHUB', SETTINGS.videohub, 'Использовать VideoHUB при поиске озвучек и проверке подписок');

        Lampa.SettingsApi.addParam({
            component: SETTINGS.component,
            param: {
                name: SETTINGS.interval,
                type: 'select',
                values: {
                    '5': '5 минут',
                    '10': '10 минут',
                    '15': '15 минут',
                    '30': '30 минут',
                    '60': '1 час'
                },
                'default': '15'
            },
            field: {
                name: 'Интервал проверки',
                description: 'Как часто плагин проверяет подписки на новые серии'
            },
            onChange: function () { schedulePolling(); }
        });
    }

    function updateMap() {
        var map = {};
        state.updates.forEach(function (item) {
            var id = item.id || item.Id;
            if (id) map[String(id)] = item;
        });
        return map;
    }

    function SubscriptionComponent(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="translationsub-page"></div>');
        var self = this;
        var destroyed = false;

        this.create = function () {
            scroll.minus();
            scroll.append(html);
            return this.render();
        };

        this.render = function () { return scroll.render(); };
        this.pause = function () {};
        this.stop = function () {};
        this.back = function () { Lampa.Activity.backward(); };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;

            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), html);
                    var focused = html.find('.selector.focus')[0] || html.find('.selector')[0];
                    if (focused) Lampa.Controller.collectionFocus(focused, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { Navigator.move('down'); },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () { Navigator.move('right'); },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };

        this.destroy = function () {
            destroyed = true;
            scroll.destroy();
            html.remove();
        };

        function focusFirst() {
            setTimeout(function () {
                if (destroyed) return;
                try {
                    Lampa.Controller.collectionSet(scroll.render(), html);
                    var first = html.find('.selector')[0];
                    if (first) Lampa.Controller.collectionFocus(first, scroll.render());
                } catch (e) {}
            }, 50);
        }

        function render(list) {
            if (destroyed) return;
            var updates = updateMap();
            var active = enabledSources().map(sourceName).join(' · ') || 'Балансеры отключены';

            html.empty();
            html.append('<div class="translationsub-page__title">' + escapeHtml(META.name) + '</div>');
            html.append('<div class="translationsub-page__subtitle">' + escapeHtml(active) + ' · проверка каждые ' + checkIntervalMinutes() + ' мин.</div>');

            var toolbar = $('<div class="translationsub-toolbar"></div>');
            var refresh = $('<div class="translationsub-toolbar__item selector">' + bellSvg() + '<span>Проверить сейчас</span></div>');
            refresh.on('hover:enter', function () {
                forceCheckUpdatesUI(function () { load(); });
            });
            toolbar.append(refresh);
            html.append(toolbar);

            var container = $('<div class="translationsub-list"></div>');
            if (!list.length) {
                container.append('<div class="translationsub-empty">Подписок пока нет. Откройте сериал, нажмите «Озвучки» и выберите нужную озвучку.</div>');
            }

            list.forEach(function (item) {
                var id = String(item.Id || item.id || '');
                var title = item.Title || item.title || 'Без названия';
                var voice = item.TranslationName || item.translationName || '';
                var season = Number(item.CurrentSeason || item.currentSeason || 1) || 1;
                var episode = Number(item.LastEpisode || item.lastEpisode || item.CurrentEpisode || item.currentEpisode || 0) || 0;
                var poster = posterUrl(item.Poster || item.poster || '');
                var sources = item.Sources || item.sources || [];
                var sourceText = Array.isArray(sources) && sources.length
                    ? sources.map(function (x) { return sourceName(x.Source || x.source); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ')
                    : sourceName(item.Source || item.source);
                var update = updates[id];

                var posterHtml = poster
                    ? '<img src="' + escapeHtml(poster) + '" alt="">'
                    : '<div class="translationsub-card__poster-empty">' + bellSvg() + '</div>';

                var card = $('<div class="translationsub-card selector">' +
                    '<div class="translationsub-card__poster">' + posterHtml + '</div>' +
                    '<div class="translationsub-card__body">' +
                        '<div class="translationsub-card__title">' + escapeHtml(title) + '</div>' +
                        '<div class="translationsub-card__voice">' + escapeHtml(voice || 'Озвучка') + '</div>' +
                        '<div class="translationsub-card__meta">S' + season + (episode ? ' · E' + episode : '') + (sourceText ? ' · ' + escapeHtml(sourceText) : '') + '</div>' +
                    '</div>' +
                    (update ? '<div class="translationsub-card__new">НОВАЯ СЕРИЯ</div>' : '') +
                '</div>');

                card.on('hover:enter', function () {
                    var actions = [];
                    if (update) {
                        actions.push({
                            title: 'Отметить уведомление прочитанным',
                            onclick: function () {
                                markNotified(update, function () {
                                    refreshUpdates(false, function () { load(); });
                                });
                            }
                        });
                    }
                    actions.push({
                        title: 'Удалить подписку',
                        onclick: function () {
                            request('POST', API.remove, { id: id }, null, function () {
                                refreshUpdates(false, function () { load(); });
                                notify('Подписка удалена');
                            }, function () { notify('Не удалось удалить подписку'); });
                        }
                    });
                    showSelect(title, actions, function () { Lampa.Controller.toggle('content'); });
                });

                container.append(card);
            });

            html.append(container);
            Lampa.Controller.enable('content');
            focusFirst();
        }

        function load() {
            self.activity.loader(true);
            request('GET', API.list, { userKey: userKey() }, null, function (list) {
                list = Array.isArray(list) ? list : [];
                self.activity.loader(false);
                render(list);
                self.activity.toggle();
            }, function () {
                self.activity.loader(false);
                render([]);
                self.activity.toggle();
                notify('Не удалось загрузить подписки');
            });
        }

        this.initialize = load;
    }

    function registerComponent() {
        try {
            if (window.Lampa && Lampa.Component && typeof Lampa.Component.add === 'function')
                Lampa.Component.add('translationsub_list', SubscriptionComponent);
        } catch (e) { log('component registration failed', e); }
    }

    function bindLampa() {
        if (!window.Lampa || !Lampa.Listener) return;

        Lampa.Listener.follow('app', function (event) {
            if (!event || event.type !== 'ready') return;
            addSettings();
            injectHeadButton();
            refreshUpdates(false);
        });

        Lampa.Listener.follow('full', function (event) {
            if (!event || event.type !== 'complite') return;
            injectFullButton(event);
        });
    }

    function start() {
        if (state.started || !window.Lampa) return;
        state.started = true;

        registerManifest();
        injectStyles();
        registerComponent();
        addSettings();
        bindLampa();
        injectHeadButton();
        refreshUpdates(false);
        schedulePolling();

        window.TranslationSub = {
            version: META.version,
            openForItem: openForItem,
            openSubscriptions: openSubscriptionsPage,
            checkUpdates: function () { refreshUpdates(false); },
            forceCheckUpdatesUI: forceCheckUpdatesUI,
            refresh: function () {
                clearVariantCache();
                injectHeadButton();
                refreshUpdates(false);
            }
        };

        log('plugin started', META.version, HOST);
    }

    if (window.Lampa) {
        start();
    } else {
        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (window.Lampa) {
                clearInterval(wait);
                start();
            } else if (attempts > 80) {
                clearInterval(wait);
                log('Lampa not found');
            }
        }, 250);
    }
})();
