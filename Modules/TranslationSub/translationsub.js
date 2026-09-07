(function () {
    'use strict';

    if (window.__TranslationSubPluginStarted) return;
    window.__TranslationSubPluginStarted = true;

    var META = {
        component: 'translationsub',
        name: 'Подписки на озвучки',
        version: '1.1.0',
        description: 'Подписки на озвучки из нескольких источников и уведомления о новых сериях',
        type: 'other'
    };

    var API = {
        list: '/translationsub/list',
        updates: '/translationsub/updates',
        variants: '/translationsub/variants',
        toggle: '/translationsub/toggle',
        notified: '/translationsub/notified',
        externalids: '/externalids'
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

        try {
            return window.location.origin || '';
        } catch (e2) {
            return '';
        }
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

    function lampacUid() {
        var uid = String(storageGet('lampac_unic_id', '') || '');
        if (uid) return uid;

        try {
            if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.uid === 'function')
                uid = String(Lampa.Utils.uid(8) || '').toLowerCase();
        } catch (e) {}

        if (!uid)
            uid = Math.random().toString(36).slice(2, 10).toLowerCase();

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

        try {
            return JSON.parse(value);
        } catch (e) {
            return {};
        }
    }

    function request(method, path, params, body, onSuccess, onError) {
        onSuccess = onSuccess || function () {};
        onError = onError || function () {};

        var qs = query(params);
        var url = HOST + path + (qs ? (path.indexOf('?') === -1 ? '?' : '&') + qs : '');

        if (method === 'GET') {
            try {
                if (window.Lampa && Lampa.Reguest) {
                    if (!state.network && typeof Lampa.Reguest === 'function')
                        state.network = new Lampa.Reguest();

                    if (state.network && typeof state.network.silent === 'function') {
                        state.network.silent(url, function (result) {
                            onSuccess(parseJson(result));
                        }, onError);
                        return;
                    }
                }
            } catch (e) {
                log('Lampa.Reguest fallback', e);
            }
        }

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
        } catch (e2) {
            onError(e2);
        }
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

    function registerManifest() {
        try {
            if (!window.Lampa) return;
            if (!Lampa.Manifest) Lampa.Manifest = {};

            var plugins = Lampa.Manifest.plugins;
            if (Array.isArray(plugins)) {
                var exists = plugins.some(function (plugin) {
                    return plugin && plugin.component === META.component;
                });
                if (!exists) plugins.push(META);
                return;
            }

            if (!plugins || typeof plugins !== 'object') {
                plugins = {};
                Lampa.Manifest.plugins = plugins;
            }

            plugins[META.component] = META;
        } catch (e) {
            log('manifest registration failed', e);
        }
    }

    function injectStyles() {
        if (document.getElementById('translationsub-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-style';
        style.textContent =
            '.translationsub-head{position:relative}' +
            '.translationsub-badge{position:absolute;right:-.25em;top:-.25em;min-width:1.5em;height:1.5em;padding:0 .3em;border-radius:1em;background:#e53935;color:#fff;font-size:.7em;display:flex;align-items:center;justify-content:center;box-sizing:border-box}' +
            '.translationsub-full-button svg,.translationsub-head svg{width:1.35em;height:1.35em;fill:currentColor}';
        (document.head || document.documentElement).appendChild(style);
    }

    function bellSvg() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.4 2.4 0 0 0 2.35-2h-4.7A2.4 2.4 0 0 0 12 22Zm7-5-2-2v-5a5 5 0 0 0-4-4.9V4a1 1 0 0 0-2 0v1.1A5 5 0 0 0 7 10v5l-2 2v1h14v-1Z"/></svg>';
    }

    function setBadge(count) {
        count = Number(count) || 0;

        if (!state.headButton || !state.headButton.length) return;
        if (!state.badge || !state.badge.length) {
            state.badge = $('<div class="translationsub-badge"></div>');
            state.headButton.append(state.badge);
        }

        if (count > 0) {
            state.badge.text(count > 99 ? '99+' : String(count)).show();
        } else {
            state.badge.hide();
        }
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

        var button = $('<div class="head__action selector translationsub-head" title="Подписки на озвучки">' + bellSvg() + '</div>');
        button.on('hover:enter', openHeadMenu);
        row.append(button);

        state.headButton = button;
        setBadge(state.updates.length);
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
        }, function () {
            done(context);
        });
    }

    function injectFullButton(object) {
        if (typeof $ !== 'function') return;

        var context = normalizeFull(object);
        if (!context.contentId && !context.title) return;
        state.current = context;

        var scope = $('.full-start').first();
        if (!scope.length) scope = $('.full-start-new').first();
        if (!scope.length) return;

        scope.find('.translationsub-full-button').remove();

        var row = scope.find('.full-start-new__buttons').first();
        if (!row.length) row = scope.find('.full-start__buttons').first();
        if (!row.length) return;

        var button = $('<div class="full-start__button selector translationsub-full-button"><div class="full-start__button-icon">' + bellSvg() + '</div><span>Озвучки</span></div>');
        button.on('hover:enter', function () { openForItem(context); });
        row.append(button);
    }

    function cacheKey(context) {
        return [context.contentId, context.season, context.kpId, context.imdbId].join('|');
    }

    function loadVariants(context, done, fail) {
        var key = cacheKey(context);
        var cached = state.variantsCache[key];
        var now = Date.now ? Date.now() : new Date().getTime();

        if (cached && now - cached.time < VARIANTS_CACHE_TTL) {
            done(cached.data);
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
            serial: context.isSerial
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
        var sources = variantSources(variant);
        var names = [];

        sources.forEach(function (item) {
            var raw = item.Source || item.source || '';
            var name = sourceName(raw);
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

        ensureExternalIds(context, function (resolved) {
            state.current = resolved;

            if (resolved.isSerial && (!resolved.season || resolved.season <= 0)) {
                openSeasonSelect(resolved);
                return;
            }

            openVoiceSelect(resolved);
        });
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
                        var selected = Object.assign({}, context, { season: Number(season) });
                        openVoiceSelect(selected);
                    }
                };
            });

            showSelect('Сезон', items);
        }, function () {
            notify('Не удалось получить сезоны');
        });
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
                        variant: variant,
                        subscribed: isSubscribed,
                        onclick: function () {
                            toggle(context, variant, function (enabled) {
                                notify(enabled ? ('Подписка: ' + name) : ('Подписка удалена: ' + name));
                                openVoiceSelect(context);
                            });
                        }
                    };
                });

                showSelect('Озвучка', items);
            }, function () {
                notify('Не удалось получить список озвучек');
            });
        }, function () {
            loadVariants(context, function (response) {
                var variants = response.Translations || response.translations || [];
                var items = (Array.isArray(variants) ? variants : []).map(function (variant) {
                    var name = variant.Name || variant.name || variant.translation || 'Озвучка';
                    return {
                        title: name,
                        subtitle: sourceSummary(variant),
                        variant: variant,
                        onclick: function () { toggle(context, variant); }
                    };
                });
                showSelect('Озвучка', items);
            }, function () { notify('Не удалось получить список озвучек'); });
        });
    }

    function toggle(context, variant, done) {
        var sources = variantSources(variant);
        var bodySources = sources.map(function (source) {
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
        }, function () {
            notify('Не удалось изменить подписку');
        });
    }

    function showSelect(title, items) {
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
                onBack: function () {
                    try { Lampa.Controller.toggle('content'); } catch (e) {}
                }
            });
            return;
        }

        notify(title + ': ' + items.length);
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
            force: force ? 'true' : 'false'
        }, null, function (updates) {
            state.updates = Array.isArray(updates) ? updates : [];
            injectHeadButton();
            setBadge(state.updates.length);
            if (done) done(state.updates);
        }, function () {
            if (done) done([]);
        });
    }

    function forceCheckUpdatesUI() {
        notify('Проверяю четыре источника…');
        refreshUpdates(true, function (updates) {
            notify(updates.length ? ('Новых серий: ' + updates.length) : 'Новых серий нет');
        });
    }

    function openSubscriptions() {
        request('GET', API.list, { userKey: userKey() }, null, function (list) {
            list = Array.isArray(list) ? list : [];
            var items = list.map(function (item) {
                var title = item.Title || item.title || 'Без названия';
                var voice = item.TranslationName || item.translationName || '';
                var season = item.CurrentSeason || item.currentSeason || 1;
                var episode = item.LastEpisode || item.lastEpisode || item.CurrentEpisode || item.currentEpisode || 0;
                var sources = item.Sources || item.sources || [];
                var sourceText = Array.isArray(sources) && sources.length
                    ? sources.map(function (x) { return sourceName(x.Source || x.source); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ')
                    : sourceName(item.Source || item.source);

                return {
                    title: title,
                    subtitle: (voice ? voice + ' · ' : '') + 'S' + season + (episode ? ' E' + episode : '') + (sourceText ? ' · ' + sourceText : ''),
                    onclick: function () {
                        notify(title + (voice ? ' · ' + voice : ''));
                    }
                };
            });

            showSelect('Мои подписки', items);
        }, function () { notify('Не удалось загрузить подписки'); });
    }

    function openHeadMenu() {
        var items = [
            { title: 'Проверить обновления', subtitle: 'FlixCDN · Phantom · ZetflixDB · VideoHUB', onclick: forceCheckUpdatesUI },
            { title: 'Мои подписки', onclick: openSubscriptions }
        ];

        if (state.updates.length) {
            state.updates.forEach(function (update) {
                var title = update.title || update.Title || 'Новая серия';
                var voice = update.translationName || update.TranslationName || '';
                var season = update.season || update.Season || 1;
                var episode = update.episode || update.Episode || 0;

                items.push({
                    title: '● ' + title,
                    subtitle: (voice ? voice + ' · ' : '') + 'S' + season + ' E' + episode,
                    onclick: function () {
                        markNotified(update, function () {
                            refreshUpdates(false);
                            notify(title + ': S' + season + ' E' + episode);
                        });
                    }
                });
            });
        }

        showSelect('Подписки на озвучки', items);
    }

    function bindLampa() {
        if (!window.Lampa || !Lampa.Listener) return;

        Lampa.Listener.follow('app', function (event) {
            if (!event || event.type !== 'ready') return;
            injectHeadButton();
            refreshUpdates(false);
        });

        Lampa.Listener.follow('full', function (event) {
            if (!event || event.type !== 'complite') return;
            injectFullButton(event.object || event.data || {});
        });
    }

    function start() {
        if (state.started || !window.Lampa) return;
        state.started = true;

        registerManifest();
        injectStyles();
        bindLampa();
        injectHeadButton();
        refreshUpdates(false);

        state.pollTimer = setInterval(function () {
            refreshUpdates(false);
        }, 5 * 60 * 1000);

        window.TranslationSub = {
            version: META.version,
            openForItem: openForItem,
            openHeadMenu: openHeadMenu,
            checkUpdates: function () { refreshUpdates(false); },
            forceCheckUpdatesUI: forceCheckUpdatesUI,
            refresh: function () {
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
