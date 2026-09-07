(function () {
    'use strict';

    if (window.__TranslationSubNoticeStarted) return;
    window.__TranslationSubNoticeStarted = true;

    var refreshTimer = null;
    var bindTimer = null;
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

    function userKey() {
        return String(storageGet('client_uid', '') || storageGet('lampac_unic_id', '') || 'local');
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
            fetch(url, { method: 'GET' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    try { success(text ? JSON.parse(text) : []); }
                    catch (e) { success([]); }
                })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { success(xhr.responseText ? JSON.parse(xhr.responseText) : []); }
                    catch (e) { success([]); }
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
            if (Lampa.Modal && typeof Lampa.Modal.close === 'function' && Lampa.Modal.opened && Lampa.Modal.opened())
                Lampa.Modal.close();
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
        if (!id || !window.Lampa || !Lampa.Activity) return;

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
            '.translationsub-menu-badge{margin-left:auto;min-width:1.65em;height:1.65em;padding:0 .38em;border-radius:1em;background:#e45e2c;color:#fff;font-size:.7em;font-weight:700;display:flex;align-items:center;justify-content:center;box-sizing:border-box}' +
            '.translationsub-notice .notice{margin-bottom:.55em}' +
            '.translationsub-notice .notice:last-child{margin-bottom:0}' +
            '.translationsub-notice .notice__descr{line-height:1.45}' +
            '.translationsub-notice .notice__footer{display:flex;gap:.45em;flex-wrap:wrap;margin-top:.42em}' +
            '.translationsub-notice .notice__footer>div{padding:.22em .45em;border-radius:.35em;background:rgba(255,255,255,.08);font-size:.84em;opacity:.78}' +
            '.translationsub-notice .notice.focus .notice__footer>div{background:rgba(0,0,0,.08)}' +
            '.translationsub-notice__empty{padding:1.1em 0;opacity:.72}' +
            '.translationsub-menu-item .menu__ico svg{width:100%;height:100%;fill:currentColor}';

        (document.head || document.documentElement).appendChild(style);
    }

    function updateBadges(count) {
        count = Number(count) || 0;

        try {
            var headBadge = $('.translationsub-head .translationsub-badge').first();
            if (!headBadge.length && count > 0) {
                headBadge = $('<div class="translationsub-badge"></div>');
                $('.translationsub-head').first().append(headBadge);
            }

            if (headBadge.length) {
                if (count > 0) headBadge.text(count > 99 ? '99+' : String(count)).show();
                else headBadge.hide();
            }
        } catch (e) {}

        try {
            var menuBadge = $('.translationsub-menu-item .translationsub-menu-badge').first();
            if (!menuBadge.length && count > 0) {
                menuBadge = $('<div class="translationsub-menu-badge"></div>');
                $('.translationsub-menu-item').first().append(menuBadge);
            }

            if (menuBadge.length) {
                if (count > 0) menuBadge.text(count > 99 ? '99+' : String(count)).show();
                else menuBadge.hide();
            }
        } catch (e2) {}
    }

    function loadUpdates(done) {
        request('/translationsub/updates?userKey=' + encodeURIComponent(userKey()), function (updates) {
            updates = Array.isArray(updates) ? updates : [];
            lastUpdates = updates;
            updateBadges(updates.length);
            done(updates);
        }, function () {
            done(lastUpdates || []);
        });
    }

    function sourceLabels(item) {
        var sources = value(item, 'Sources', 'sources', []);
        var names = [];
        var map = {
            flixcdn: 'FlixCDN',
            phantom: 'Phantom',
            zetflixdb: 'ZetflixDB',
            cdnvideohub: 'VideoHUB'
        };

        if (Array.isArray(sources)) {
            sources.forEach(function (source) {
                var key = String(value(source, 'Source', 'source', '') || '').toLowerCase();
                var name = map[key] || key;
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
        item.find('.notice__title').text('Новых серий пока нет');
        item.find('.notice__descr').text('Когда в выбранной озвучке появится продолжение, оно будет показано здесь.');

        try {
            item.find('.notice__img').html(Lampa.Template.string('icon_bell_plus'));
        } catch (e2) {}

        return item;
    }

    function closeModal() {
        try {
            if (Lampa.Modal && typeof Lampa.Modal.close === 'function') Lampa.Modal.close();
        } catch (e) {}

        try { Lampa.Controller.toggle('head'); } catch (e2) {}
    }

    function openDrawer() {
        if (!window.Lampa || !Lampa.Modal || typeof Lampa.Modal.open !== 'function') {
            openSubscriptionsPage();
            return;
        }

        loadUpdates(function (updates) {
            var html = $('<div class="translationsub-notice"></div>');

            if (updates.length) {
                updates.forEach(function (item, index) {
                    html.append(noticeCard(item, index));
                });
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
                buttons: [
                    {
                        name: 'Все подписки на озвучки',
                        onSelect: function () {
                            try { Lampa.Modal.close(); } catch (e) {}
                            openSubscriptionsPage();
                        }
                    }
                ],
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
        });
    }

    function menuIcon() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.4 2.4 0 0 0 2.35-2h-4.7A2.4 2.4 0 0 0 12 22Zm7-5-2-2v-5a5 5 0 0 0-4-4.9V4a1 1 0 0 0-2 0v1.1A5 5 0 0 0 7 10v5l-2 2v1h14v-1Z"/></svg>';
    }

    function addMenuItem() {
        if (typeof $ !== 'function') return;

        var menu = $('.menu .menu__list').eq(0);
        if (!menu.length || menu.find('.translationsub-menu-item').length) return;

        var button = $('<li class="menu__item selector translationsub-menu-item" data-action="translationsub">' +
            '<div class="menu__ico">' + menuIcon() + '</div>' +
            '<div class="menu__text">Подписки на озвучки</div>' +
        '</li>');

        button.on('hover:enter', function () {
            openSubscriptionsPage();
        });

        var anchor = menu.find('[data-action="subscribes"]').last();
        if (!anchor.length) anchor = menu.find('[data-action="timetable"]').last();
        if (!anchor.length) anchor = menu.find('[data-action="history"]').last();

        if (anchor.length) anchor.after(button);
        else menu.append(button);

        updateBadges(lastUpdates.length);
    }

    function bindHeadButton() {
        if (typeof $ !== 'function') return;
        var button = $('.translationsub-head').first();
        if (!button.length) return;

        if (button.attr('data-translationsub-notice-bound') === '1') return;

        button.off('hover:enter');
        button.on('hover:enter.translationsubNotice', openDrawer);
        button.attr('data-translationsub-notice-bound', '1');
        button.attr('title', 'Уведомления озвучек');
    }

    function bindUi() {
        clearTimeout(bindTimer);
        bindTimer = setTimeout(function () {
            addMenuItem();
            bindHeadButton();
        }, 80);
    }

    function refresh() {
        loadUpdates(function () {});
        bindUi();
    }

    function start() {
        addStyles();
        bindUi();
        refresh();

        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') {
                        bindUi();
                        setTimeout(refresh, 1200);
                    }
                });
            }
        } catch (e) {}

        try {
            var observer = new MutationObserver(function () { bindUi(); });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e2) {}

        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(refresh, 60 * 1000);

        window.TranslationSubNotice = {
            open: openDrawer,
            refresh: refresh,
            openPage: openSubscriptionsPage
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
