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
        } catch (e2) { return fallback; }
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

        var navigation = item && item.navigation && typeof item.navigation === 'object'
            ? item.navigation
            : null;
        var id = String(navigation && navigation.id || '').trim();
        if (!id || !window.Lampa || !Lampa.Activity || typeof Lampa.Activity.push !== 'function') return;

        var source = String(storageGet('translationsub_card_source', 'tmdb') || 'tmdb').toLowerCase() === 'cub' ? 'cub' : 'tmdb';
        var numericId = /^\d+$/.test(id) ? Number(id) : id;
        Lampa.Activity.push({
            url: '',
            component: 'full',
            source: source,
            id: numericId,
            method: String(navigation.method || 'tv'),
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

        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function') {
                window.TranslationSubBadgeState.refresh(function (updates) {
                    lastUpdates = Array.isArray(updates) ? updates.slice() : [];
                    done(lastUpdates.slice());
                });
                return;
            }
        } catch (e) {}

        var api = window.TranslationSubApi;
        if (!api || typeof api.snapshot !== 'function') {
            done(lastUpdates.slice());
            return;
        }

        api.snapshot(function (snapshot) {
            lastUpdates = snapshot && Array.isArray(snapshot.updates) ? snapshot.updates.slice() : [];
            done(lastUpdates.slice());
        }, function () {
            done(lastUpdates.slice());
        });
    }

    function noticeCard(item, index) {
        var card;
        try {
            card = Lampa.Template.get('notice_card', {});
        } catch (e) {
            card = $('<div class="notice notice--card selector"><div class="notice__left"><div class="notice__img"><img /></div></div><div class="notice__body"><div class="notice__head"><div class="notice__title"></div><div class="notice__time"></div></div><div class="notice__descr"></div></div></div>');
        }

        item = item || {};
        var display = item.display && typeof item.display === 'object' ? item.display : {};
        var title = String(item.title || 'Сериал');
        var voice = String(item.translationName || 'Озвучка');
        var poster = posterUrl(item.poster || '');
        var labels = Array.isArray(display.sourceLabels) ? display.sourceLabels : [];

        card.attr('data-translationsub-update', String(index));
        card.addClass('image--poster');
        card.find('.notice__title').text(title);
        card.find('.notice__time').text(String(display.noticeTime || ''));

        var descr = card.find('.notice__descr');
        descr.empty();
        descr.append($('<div></div>').text(voice));
        if (display.noticeRange)
            descr.append($('<div></div>').text(String(display.noticeRange)));

        if (labels.length) {
            var footer = $('<div class="notice__footer"></div>');
            labels.forEach(function (label) { footer.append($('<div></div>').text(String(label || ''))); });
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
