(function () {
    'use strict';

    if (window.__TranslationSubNoticeStarted) return;
    window.__TranslationSubNoticeStarted = true;

    function posterUrl(path) {
        try {
            if (window.TranslationSubUi && typeof window.TranslationSubUi.posterUrl === 'function')
                return window.TranslationSubUi.posterUrl(path);
        } catch (e) {}
        return '';
    }

    function openSubscriptionsPage() {
        try {
            if (Lampa.Modal && typeof Lampa.Modal.close === 'function') Lampa.Modal.close();
        } catch (e) {}

        try {
            if (window.TranslationSub && typeof window.TranslationSub.openSubscriptions === 'function')
                window.TranslationSub.openSubscriptions();
        } catch (e2) {}
    }

    function openUpdate(item) {
        try {
            if (window.TranslationSubCardSource && typeof window.TranslationSubCardSource.open === 'function') {
                window.TranslationSubCardSource.open(item);
                return;
            }
        } catch (e) {}
        openSubscriptionsPage();
    }

    function addStyles() {
        if (document.getElementById('translationsub-notice-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-notice-style';
        style.textContent =
            '.translationsub-notice{padding:0!important}' +
            '.translationsub-notice .notice{margin:0 0 .45em!important;padding:.65em!important;min-height:4.7em!important;border-radius:.55em!important}' +
            '.translationsub-notice .notice:last-child{margin-bottom:0!important}' +
            '.translationsub-notice .notice__left{width:3.15em!important;min-width:3.15em!important}' +
            '.translationsub-notice .notice__img{width:3.15em!important;height:4.55em!important;border-radius:.38em!important}' +
            '.translationsub-notice .notice__body{padding-left:.72em!important;min-width:0!important}' +
            '.translationsub-notice .notice__title{font-size:1em!important;line-height:1.2!important;font-weight:650!important}' +
            '.translationsub-notice .notice__time{font-size:.72em!important;opacity:.55!important;margin-left:.55em!important}' +
            '.translationsub-notice .notice__descr{font-size:.82em!important;line-height:1.3!important;opacity:.8!important;margin-top:.22em!important}' +
            '.translationsub-notice .notice__footer{display:flex;gap:.3em!important;flex-wrap:nowrap!important;margin-top:.3em!important;white-space:nowrap!important;overflow:hidden!important}' +
            '.translationsub-notice .notice__footer>div{padding:.16em .34em!important;border-radius:.3em!important;background:rgba(255,255,255,.07)!important;font-size:.72em!important;opacity:.65!important;overflow:hidden!important;text-overflow:ellipsis!important}' +
            '.translationsub-notice .notice.focus .notice__footer>div{background:rgba(0,0,0,.07)!important}' +
            '.translationsub-notice__empty{padding:1.1em 0;opacity:.72}' +
            '.translationsub-notice__empty .notice__time{display:none!important}';
        (document.head || document.documentElement).appendChild(style);
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

        renderDrawer(Array.isArray(preloadedUpdates) ? preloadedUpdates : []);
    }

    function start() {
        addStyles();
        window.TranslationSubNotice = {
            open: openDrawer
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
