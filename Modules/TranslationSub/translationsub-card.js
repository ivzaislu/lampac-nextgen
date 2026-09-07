(function () {
    'use strict';

    if (window.__TranslationSubCardStarted) return;
    window.__TranslationSubCardStarted = true;

    var WATCHED_PERCENT = 60;
    var FALLBACK_EPISODES_SCAN = 250;
    var enhanceTimer = null;
    var lastContext = null;

    function bellSvg() {
        return '<svg viewBox="0 0 25 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7367 27 9.27804 25.6961 9.03542 24H6.01892Z" fill="currentColor"></path>' +
            '<path d="M3.81972 14.5957V10.2679C3.81972 5.41336 7.7181 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.2106 22.9392 23.5 20.9098 23.5H4.09021C2.06084 23.5 0.792282 21.2106 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z" stroke="currentColor" stroke-width="2.6"></path>' +
        '</svg>';
    }

    function injectStyles() {
        if (document.getElementById('translationsub-card-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-card-style';
        style.textContent =
            '.translationsub-full-button{position:relative}' +
            '.translationsub-full-button>svg{width:1.2em;height:1.35em;flex-shrink:0}' +
            '.translationsub-full-button__progress{margin-left:.42em;padding:.16em .42em;border-radius:.45em;background:rgba(255,255,255,.12);font-size:.7em;font-weight:600;line-height:1.25;white-space:nowrap;opacity:.9}' +
            '.translationsub-full-button.focus .translationsub-full-button__progress{background:rgba(0,0,0,.1);opacity:.82}' +
            '.translationsub-season-current{font-weight:600}' +
            '@media(max-width:700px){.translationsub-full-button__progress{display:none}}';
        (document.head || document.documentElement).appendChild(style);
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(text);
                return;
            }
        } catch (e) {}
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

    function timelineCard(context) {
        var card = context && context.card ? context.card : {};
        var originalName = card.original_name || card.original_title || context.originalTitle || context.title || '';
        return {
            original_name: originalName,
            original_title: originalName
        };
    }

    function episodePercent(context, season, episode) {
        try {
            if (!window.Lampa || !Lampa.Timeline || typeof Lampa.Timeline.watchedEpisode !== 'function') return 0;
            return Number(Lampa.Timeline.watchedEpisode(timelineCard(context), season, episode) || 0);
        } catch (e) {
            return 0;
        }
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

        var lastAired = Number(card.last_episode_to_air && card.last_episode_to_air.season_number || 0) || 0;
        var nextAired = Number(card.next_episode_to_air && card.next_episode_to_air.season_number || 0) || 0;
        if (lastAired > 0 && !map[lastAired]) map[lastAired] = { number: lastAired, episodeCount: 0, airDate: '' };
        if (nextAired > 0 && !map[nextAired]) map[nextAired] = { number: nextAired, episodeCount: 0, airDate: '' };

        Object.keys(map).forEach(function (key) { list.push(map[key]); });
        list.sort(function (a, b) { return b.number - a.number; });
        return list;
    }

    function watchedInSeason(context, season) {
        var limit = Number(season.episodeCount || 0) || FALLBACK_EPISODES_SCAN;
        limit = Math.max(1, Math.min(FALLBACK_EPISODES_SCAN, limit));
        var highest = 0;

        for (var episode = 1; episode <= limit; episode++) {
            if (episodePercent(context, season.number, episode) >= WATCHED_PERCENT) highest = episode;
        }

        return highest;
    }

    function actualAiredSeason(context, seasons) {
        var card = context.card || {};
        var lastAired = Number(card.last_episode_to_air && card.last_episode_to_air.season_number || 0) || 0;
        if (lastAired > 0) return lastAired;

        var now = Date.now ? Date.now() : new Date().getTime();
        var aired = seasons.filter(function (season) {
            if (!season.airDate) return false;
            var time = new Date(season.airDate).getTime();
            return !isNaN(time) && time <= now;
        });
        if (aired.length) return aired[0].number;

        return seasons.length ? seasons[0].number : 1;
    }

    function calculateProgress(context) {
        var seasons = seasonMetadata(context);
        if (!seasons.length) seasons = [{ number: 1, episodeCount: 0, airDate: '' }];

        var lastWatchedSeason = 0;
        var lastWatchedEpisode = 0;
        var progress = {};

        seasons.forEach(function (season) {
            var episode = watchedInSeason(context, season);
            progress[season.number] = episode;
            if (episode > 0 && season.number > lastWatchedSeason) {
                lastWatchedSeason = season.number;
                lastWatchedEpisode = episode;
            }
        });

        var actualSeason = actualAiredSeason(context, seasons);
        var preferredSeason = lastWatchedSeason > 0 ? lastWatchedSeason : actualSeason;
        if (!progress[preferredSeason]) progress[preferredSeason] = 0;

        return {
            seasons: seasons,
            bySeason: progress,
            lastWatchedSeason: lastWatchedSeason,
            lastWatchedEpisode: lastWatchedEpisode,
            actualSeason: actualSeason,
            preferredSeason: preferredSeason,
            preferredEpisode: Number(progress[preferredSeason] || 0)
        };
    }

    function openVoice(context, season) {
        if (!window.TranslationSub || typeof window.TranslationSub.openForItem !== 'function') {
            notify('TranslationSub ещё не готов');
            return;
        }

        var next = {};
        Object.keys(context).forEach(function (key) { next[key] = context[key]; });
        next.season = Number(season || 1) || 1;
        window.TranslationSub.openForItem(next);

        // После возможной подписки быстро пересинхронизируем просмотренный эпизод.
        setTimeout(function () {
            try {
                if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function')
                    window.TranslationSubWatch.sync();
            } catch (e) {}
        }, 4000);
        setTimeout(function () {
            try {
                if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function')
                    window.TranslationSubWatch.sync();
            } catch (e) {}
        }, 12000);
    }

    function openSeasonMenu(context, progress) {
        if (!context.isSerial) {
            openVoice(context, 1);
            return;
        }

        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') {
            openVoice(context, progress.preferredSeason || 1);
            return;
        }

        var seasons = progress.seasons.slice();
        if (!seasons.length) {
            openVoice(context, progress.preferredSeason || 1);
            return;
        }

        if (seasons.length === 1) {
            openVoice(context, seasons[0].number);
            return;
        }

        var items = seasons.map(function (season) {
            var watched = Number(progress.bySeason[season.number] || 0);
            var parts = [];

            if (season.number === progress.lastWatchedSeason && watched > 0)
                parts.push('Последний просмотр · серия ' + watched);
            else if (watched > 0)
                parts.push('Просмотрено до серии ' + watched);
            else if (season.number === progress.actualSeason)
                parts.push('Актуальный сезон');
            else
                parts.push('Не начат');

            if (season.episodeCount > 0) parts.push('всего ' + season.episodeCount);

            return {
                title: season.number + ' сезон',
                subtitle: parts.join(' · '),
                season: season.number,
                selected: season.number === progress.preferredSeason
            };
        });

        var title = 'Озвучки';
        if (progress.lastWatchedSeason > 0)
            title += ' · просмотр S' + progress.lastWatchedSeason + ' E' + progress.lastWatchedEpisode;
        else
            title += ' · сезон ' + progress.preferredSeason;

        Lampa.Select.show({
            title: title,
            items: items,
            onSelect: function (item) {
                if (item) openVoice(context, item.season);
            },
            onBack: function () {
                try { Lampa.Controller.toggle('content'); } catch (e) {}
            }
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

    function enhanceButton(event) {
        if (typeof $ !== 'function') return;

        var payload = event && (event.data || event.object) || {};
        var context = normalizeFull(payload);
        if (!context.contentId && !context.title) return;
        if (!context.isSerial) return;

        var root = buttonRoot(event);
        if (!root || !root.length) return;

        var button = root.find('.translationsub-full-button').first();
        if (!button.length) return;

        var progress = calculateProgress(context);
        lastContext = { context: context, progress: progress };

        var badge = progress.lastWatchedSeason > 0
            ? ('S' + progress.lastWatchedSeason + ' E' + progress.lastWatchedEpisode)
            : ('S' + progress.preferredSeason);
        var subtitle = progress.lastWatchedSeason > 0
            ? ('Последний просмотр: ' + progress.lastWatchedSeason + ' сезон, ' + progress.lastWatchedEpisode + ' серия')
            : ('Актуальный сезон: ' + progress.preferredSeason);

        button.off('hover:enter');
        button.off('hover:long');
        button.empty();
        button.append(bellSvg());
        button.append('<span>Озвучки</span>');
        button.append('<small class="translationsub-full-button__progress">' + badge + '</small>');
        button.attr('data-subtitle', subtitle);
        button.attr('title', subtitle);

        button.on('hover:enter', function () {
            openSeasonMenu(context, calculateProgress(context));
        });

        button.on('hover:long', function () {
            if (window.TranslationSub && typeof window.TranslationSub.openSubscriptions === 'function')
                window.TranslationSub.openSubscriptions();
        });
    }

    function scheduleEnhance(event, delay) {
        clearTimeout(enhanceTimer);
        enhanceTimer = setTimeout(function () { enhanceButton(event); }, typeof delay === 'number' ? delay : 40);
    }

    function bind() {
        if (!window.Lampa || !Lampa.Listener || typeof Lampa.Listener.follow !== 'function') return;

        Lampa.Listener.follow('full', function (event) {
            if (!event || event.type !== 'complite') return;
            scheduleEnhance(event, 50);
        });

        try {
            if (Lampa.Timeline && Lampa.Timeline.listener && typeof Lampa.Timeline.listener.follow === 'function') {
                Lampa.Timeline.listener.follow('update', function () {
                    if (lastContext) scheduleEnhance({ data: lastContext.context.raw }, 150);
                });
            }
        } catch (e) {}
    }

    function start() {
        if (!window.Lampa) return;
        injectStyles();
        bind();
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
