(function () {
    'use strict';

    if (window.__TranslationSubNoticeStarted) return;
    window.__TranslationSubNoticeStarted = true;

    var lastUpdates = [];

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

    function uid() {
        try {
            if (window.TranslationSub && typeof window.TranslationSub.uid === 'function')
                return String(window.TranslationSub.uid() || '');
        } catch (e) {}
        return String(storageGet('lampac_unic_id', '') || '');
    }

    function profileId() {
        return String(storageGet('lampac_profile_id', '') || '');
    }

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            return window.location.origin || '';
        } catch (e) {
            return '';
        }
    }

    function request(path, success, error) {
        success = success || function () {};
        error = error || function () {};
        var url = host() + path;

        if (typeof fetch === 'function') {
            fetch(url, { method: 'GET', cache: 'no-store' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    var data = [];
                    try { data = text ? JSON.parse(text) : []; } catch (e) {}
                    success(Array.isArray(data) ? data : []);
                })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    var data = [];
                    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : []; } catch (e) {}
                    success(Array.isArray(data) ? data : []);
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

    function posterUrl(path) {
        path = String(path || '');
        if (!path) return '';
        if (/^https?:\/\//i.test(path)) return path;

        try {
            if (window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.image === 'function')
                return Lampa.TMDB.image('t/p/w300/' + path.replace(/^\//, ''));
        } catch (e) {}

        try {
            if (window.Lampa && Lampa.Api && typeof Lampa.Api.img === 'function')
                return Lampa.Api.img(path, 'w300');
        } catch (e2) {}

        return path.charAt(0) === '/' ? 'https://image.tmdb.org/t/p/w300' + path : path;
    }

    function openSubscriptionsPage() {
        try {
            if (Lampa.Modal && typeof Lampa.Modal.close === 'function') Lampa.Modal.close();
        } catch (e) {}

        if (!window.Lampa || !Lampa.Activity || typeof Lampa.Activity.push !== 'function') return;
        Lampa.Activity.push({
            url: '',
            title: 'Подписки на озвучки',
            component: 'translationsub_list',
            page: 1
        });
    }

    function openUpdate(item) {
        try {
            if (window.TranslationSubCardSource && typeof window.TranslationSubCardSource.open === 'function') {
                window.TranslationSubCardSource.open(item);
                return;
            }
        } catch (e) {}

        var id = String(value(item, 'TmdbId', 'tmdbId', value(item, 'ContentId', 'contentId', '')) || '').trim();
        if (!id || !window.Lampa || !Lampa.Activity || typeof Lampa.Activity.push !== 'function') return;

        var source = String(storageGet('translationsub_card_source', 'tmdb') || 'tmdb').toLowerCase() === 'cub' ? 'cub' : 'tmdb';
        var numericId = /^\d+$/.test(id) ? Number(id) : id;
        Lampa.Activity.push({
            url: '',
            component: 'full',
            source: source,
            id: numericId,
            method: 'tv',
            card: { id: numericId, source: source }
        });
    }

    function addStyles() {
        if (document.getElementById('translationsub-notice-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-notice-style';
        style.textContent =
            '.translationsub-notice .notice{margin-bottom:.55em}' +
            '.translationsub-notice .notice:last-child{margin-bottom:0}' +
            '.translationsub-notice .notice__descr{line-height:1.45}' +
            '.translationsub-notice .notice__footer{display:flex;gap:.45em;flex-wrap:wrap;margin-top:.42em}' +
            '.translationsub-notice .notice__footer>div{padding:.22em .45em;border-radius:.35em;background:rgba(255,255,255,.08);font-size:.84em;opacity:.78}' +
            '.translationsub-notice .notice.focus .notice__footer>div{background:rgba(0,0,0,.08)}' +
            '.translationsub-notice__empty{padding:1.1em 0;opacity:.72}' +
            '.translationsub-notice__empty .notice__time{display:none!important}';
        (document.head || document.documentElement).appendChild(style);
    }

    function loadUpdates(done) {
        done = typeof done === 'function' ? done : function () {};
        var path = '/translationsub/updates?uid=' + encodeURIComponent(uid()) + '&force=false';
        var profile = profileId();
        if (profile) path += '&profile_id=' + encodeURIComponent(profile);

        request(path, function (updates) {
            lastUpdates = updates;
            done(updates);
        }, function () {
            done(lastUpdates.slice());
        });
    }

    function sourceLabels(item) {
        var sources = value(item, 'Sources', 'sources', []);
        var names = [];

        if (Array.isArray(sources)) {
            sources.forEach(function (source) {
                var name = String(value(source, 'Source', 'source', '') || '').trim();
                if (name && names.indexOf(name) === -1) names.push(name);
            });
        }
        return names;
    }

    function noticeCard(item, index) {
        var card;
        try {
            card = Lampa.Template.get('notice_card', {});
        } catch (e) {
            card = $('<div class="notice notice--card selector"><div class="notice__left"><div class="notice__img"><img /></div></div><div class="notice__body"><div class="notice__head"><div class="notice__title"></div><div class="notice__time"></div></div><div class="notice__descr"></div></div></div>');
        }

        var title = String(value(item, 'Title', 'title', 'Сериал') || 'Сериал');
        var voice = String(value(item, 'TranslationName', 'translationName', 'Озвучка') || 'Озвучка');
        var season = Number(value(item, 'Season', 'season', value(item, 'CurrentSeason', 'currentSeason', 1)) || 1);
        var watched = Number(value(item, 'WatchedEpisode', 'watchedEpisode', value(item, 'CurrentEpisode', 'currentEpisode', 0)) || 0);
        var from = Number(value(item, 'FromEpisode', 'fromEpisode', watched + 1) || (watched + 1));
        var to = Number(value(item, 'ToEpisode', 'toEpisode', value(item, 'AvailableEpisode', 'availableEpisode', 0)) || 0);
        var count = Number(value(item, 'NewCount', 'newCount', Math.max(0, to - watched)) || 0);
        var poster = posterUrl(value(item, 'Poster', 'poster', ''));
        var labels = sourceLabels(item);

        card.attr('data-translationsub-update', String(index));
        card.addClass('image--poster');
        card.find('.notice__title').text(title);
        card.find('.notice__time').text(count > 0 ? (count + ' новых') : ('S' + season));

        var range = to > 0
            ? ('S' + season + ' · просмотрено E' + watched + ' · доступны E' + from + (to > from ? '–E' + to : ''))
            : ('S' + season + ' · ' + voice);

        var descr = card.find('.notice__descr');
        descr.empty();
        descr.append($('<div></div>').text(voice));
        descr.append($('<div></div>').text(range));

        if (labels.length) {
            var footer = $('<div class="notice__footer"></div>');
            labels.forEach(function (label) { footer.append($('<div></div>').text(label)); });
            descr.append(footer);
        }

        var img = card.find('.notice__img img').first();
        if (poster && img.length) {
            img.on('load', function () { card.addClass('image--loaded'); });
            img.on('error', function () {
                try { this.src = './img/img_broken.svg'; } catch (e) {}
            });
            img.attr('src', poster);
        } else {
            card.addClass('image--none image--loaded');
        }

        return card;
    }

    function emptyCard() {
        var item;
        try {
            item = Lampa.Template.get('notice_card', {});
        } catch (e) {
            item = $('<div class="notice notice--card selector"><div class="notice__body"><div class="notice__head"><div class="notice__title"></div></div><div class="notice__descr"></div></div></div>');
        }

        item.addClass('image--icon image--loaded translationsub-notice__empty');
        item.attr('data-translationsub-empty', '1');
        item.find('.notice__time').remove();
        item.find('.notice__title').text('Новых серий пока нет');
        item.find('.notice__descr').text('Когда в выбранной озвучке появится продолжение, оно будет показано здесь.');

        try { item.find('.notice__img').html(Lampa.Template.string('icon_bell_plus')); } catch (e2) {}
        return item;
    }

    function closeModal() {
        try {
            if (Lampa.Modal && typeof Lampa.Modal.close === 'function') Lampa.Modal.close();
        } catch (e) {}
        try { Lampa.Controller.toggle('head'); } catch (e2) {}
    }

    function renderDrawer(updates) {
        updates = Array.isArray(updates) ? updates : [];
        lastUpdates = updates.slice();

        var html = $('<div class="translationsub-notice"></div>');
        if (updates.length) {
            updates.forEach(function (item, index) { html.append(noticeCard(item, index)); });
        } else {
            html.append(emptyCard());
        }

        var first = html.find('.selector').first()[0];
        Lampa.Modal.open({
            title: 'Уведомления озвучек',
            size: 'medium',
            html: html,
            select: first,
            scroll_to_center: true,
            buttons: [{
                name: 'Все подписки на озвучки',
                onSelect: openSubscriptionsPage
            }],
            buttons_position: 'inside',
            onSelect: function (selected) {
                var node = $(selected);
                var index = parseInt(node.attr('data-translationsub-update'), 10);
                if (isNaN(index) || !updates[index]) return;

                try { Lampa.Modal.close(); } catch (e) {}
                openUpdate(updates[index]);
            },
            onBack: closeModal
        });
    }

    function openDrawer(preloadedUpdates) {
        if (!window.Lampa || !Lampa.Modal || typeof Lampa.Modal.open !== 'function') {
            openSubscriptionsPage();
            return;
        }

        if (Array.isArray(preloadedUpdates)) {
            renderDrawer(preloadedUpdates);
            return;
        }

        loadUpdates(renderDrawer);
    }

    function refresh(done) {
        loadUpdates(function (updates) {
            if (typeof done === 'function') done(updates);
        });
    }

    function start() {
        addStyles();
        window.TranslationSubNotice = {
            open: openDrawer,
            refresh: refresh,
            openPage: openSubscriptionsPage,
            updates: function () { return lastUpdates.slice(); }
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
