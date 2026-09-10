(function () {
    'use strict';

    if (window.__TranslationSubPageStarted) return;
    window.__TranslationSubPageStarted = true;

    if (!window.Lampa || !Lampa.Component || typeof Lampa.Component.add !== 'function') return;

    function escapeHtml(value) {
        try {
            if (Lampa.Utils && typeof Lampa.Utils.escape === 'function') return Lampa.Utils.escape(String(value || ''));
        } catch (e) {}

        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function notify(text) {
        try {
            if (Lampa.Noty && typeof Lampa.Noty.show === 'function') Lampa.Noty.show(text);
        } catch (e) {}
    }

    function posterUrl(path) {
        path = String(path || '');
        if (!path) return '';
        if (/^https?:\/\//i.test(path)) return path;

        try {
            if (Lampa.Api && typeof Lampa.Api.img === 'function') return Lampa.Api.img(path, 'w300');
        } catch (e) {}

        return path.charAt(0) === '/' ? 'https://image.tmdb.org/t/p/w300' + path : path;
    }

    function sourceLabels(item) {
        var names = [];
        var sources = item && Array.isArray(item.sources) ? item.sources : [];
        sources.forEach(function (source) {
            var name = String(source && source.source || '').trim();
            if (name && names.indexOf(name) === -1) names.push(name);
        });
        if (!names.length && item && item.source)
            names.push(String(item.source));
        return names;
    }

    function metaHtml(item) {
        item = item || {};
        var season = Number(item.season || 1) || 1;
        var watched = Number(item.watchedEpisode || 0) || 0;
        var available = Number(item.availableEpisode || 0) || 0;
        var progress = Math.max(0, Math.min(100, Number(item.progressPercent || 0) || 0));
        var names = sourceLabels(item);
        var body = '<div class="translationsub-meta-v2">' +
            '<div class="translationsub-meta-v2__row">' +
                '<span class="translationsub-meta-v2__season">S' + season + '</span>' +
                '<span class="translationsub-meta-v2__pill">Просмотрено <b>E' + watched + '</b></span>' +
                '<span class="translationsub-meta-v2__pill">В озвучке <b>E' + available + '</b></span>' +
            '</div>' +
            '<div class="translationsub-progress-v2"><i style="width:' + progress + '%"></i></div>';

        if (item.hasNewEpisodes) {
            var from = Number(item.fromEpisode || 0) || 0;
            var to = Number(item.toEpisode || 0) || 0;
            body += '<div class="translationsub-meta-v2__next">Можно смотреть E' + from + (to > from ? '–E' + to : '') + '</div>';
        } else {
            body += '<div class="translationsub-meta-v2__ok">Новых серий пока нет</div>';
        }

        if (names.length)
            body += '<div class="translationsub-meta-v2__source">' + escapeHtml(names.join(', ')) + '</div>';

        if (item.schedule && item.schedule.text) {
            var type = String(item.schedule.type || 'plain').replace(/[^a-z0-9-]/gi, '');
            body += '<div class="translationsub-tmdb-v2">' +
                '<div class="translationsub-tmdb-v2__state translationsub-tmdb-v2__state--' + type + '">' +
                    escapeHtml(item.schedule.text) +
                '</div>' +
            '</div>';
        }

        return body + '</div>';
    }

    function loadSnapshot(success, error) {
        success = typeof success === 'function' ? success : function () {};
        error = typeof error === 'function' ? error : function () {};

        try {
            if (window.TranslationSubBadgeState
                && typeof window.TranslationSubBadgeState.refresh === 'function'
                && typeof window.TranslationSubBadgeState.snapshot === 'function') {
                window.TranslationSubBadgeState.refresh(function () {
                    var snapshot = window.TranslationSubBadgeState.snapshot();
                    if (snapshot && typeof snapshot === 'object') success(snapshot);
                    else error();
                });
                return;
            }
        } catch (e) {}

        var api = window.TranslationSubApi;
        if (api && typeof api.snapshot === 'function') {
            api.snapshot(success, error);
            return;
        }

        error();
    }

    function applySnapshot(snapshot) {
        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.applySnapshot === 'function')
                window.TranslationSubBadgeState.applySnapshot(snapshot);
        } catch (e) {}
        return snapshot;
    }

    function SubscriptionPage() {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="translationsub-page"></div>');
        var self = this;
        var initialized = false;
        var destroyed = false;
        var requestVersion = 0;
        var reloadRef = null;

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

            if (!initialized) {
                initialized = true;
                this.initialize();
            }

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
            requestVersion++;
            if (window.TranslationSubPageRefresh === reloadRef) window.TranslationSubPageRefresh = null;
            try { scroll.destroy(); } catch (e) {}
            html.remove();
        };

        function focusAfterRender(subscriptionId) {
            setTimeout(function () {
                if (destroyed) return;
                try {
                    Lampa.Controller.collectionSet(scroll.render(), html);
                    var target = subscriptionId
                        ? html.find('.translationsub-card[data-subscription-id="' + subscriptionId + '"]')[0]
                        : null;
                    if (!target) target = html.find('.selector')[0];
                    if (target) Lampa.Controller.collectionFocus(target, scroll.render());
                } catch (e) {}
            }, 40);
        }

        function render(snapshot) {
            if (destroyed) return;
            snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
            var list = Array.isArray(snapshot.subscriptions) ? snapshot.subscriptions : [];
            var updateCount = snapshot.badge ? Number(snapshot.badge.count || 0) || 0 : 0;

            var focusedId = String(html.find('.translationsub-card.focus').attr('data-subscription-id') || '');
            html.empty();
            html.append('<div class="translationsub-page__title">Подписки на озвучки</div>');
            html.append('<div class="translationsub-page__subtitle">Прогресс просмотра синхронизируется с Lampac TimeCode</div>');

            var summary = $('<div class="translationsub-summary-v2"></div>');
            summary.append('<div class="translationsub-summary-v2__item"><span class="translationsub-summary-v2__dot"></span><span>Подписок <b>' + list.length + '</b></span></div>');
            summary.append('<div class="translationsub-summary-v2__item translationsub-summary-v2__item--new"><span class="translationsub-summary-v2__dot"></span><span>С новыми сериями <b>' + updateCount + '</b></span></div>');
            html.append(summary);

            var toolbar = $('<div class="translationsub-toolbar"></div>');
            var check = $('<div class="translationsub-toolbar__item selector"><span>Проверить новые серии</span></div>');
            check.on('hover:enter', function () {
                var api = window.TranslationSubApi;
                if (!api || typeof api.check !== 'function') {
                    notify('TranslationSub API недоступен');
                    return;
                }

                notify('Проверяю новые серии…');
                api.check(function (result) {
                    if (!result || result.success !== true || !result.snapshot) {
                        notify('Не удалось проверить новые серии');
                        return;
                    }

                    var next = applySnapshot(result.snapshot);
                    render(next);
                    var count = next && next.badge ? Number(next.badge.count || 0) || 0 : 0;
                    notify(count ? ('С новыми сериями: ' + count) : 'Новых серий нет');
                }, function () {
                    notify('Не удалось проверить новые серии');
                });
            });
            toolbar.append(check);
            html.append(toolbar);

            var container = $('<div class="translationsub-list"></div>');
            if (!list.length) {
                container.append('<div class="translationsub-empty">Подписок пока нет. Откройте сериал, нажмите «Озвучки» и выберите нужную озвучку.</div>');
            }

            list.forEach(function (item) {
                item = item || {};
                var id = String(item.id || '');
                var title = String(item.title || 'Без названия');
                var voice = String(item.translationName || 'Озвучка');
                var newCount = Number(item.newCount || 0) || 0;
                var poster = posterUrl(item.poster || '');
                var posterHtml = poster
                    ? '<img src="' + escapeHtml(poster) + '" alt="">'
                    : '<div class="translationsub-card__poster-empty"></div>';

                var card = $('<div class="translationsub-card selector' + (item.hasNewEpisodes ? ' translationsub-card--has-new' : '') + '" data-subscription-id="' + escapeHtml(id) + '" data-translationsub-new-count="' + newCount + '">' +
                    '<div class="translationsub-card__poster">' + posterHtml + '</div>' +
                    '<div class="translationsub-card__body">' +
                        '<div class="translationsub-card__title">' + escapeHtml(title) + '</div>' +
                        '<div class="translationsub-card__voice">' + escapeHtml(voice) + '</div>' +
                        '<div class="translationsub-card__meta">' + metaHtml(item) + '</div>' +
                    '</div>' +
                    (newCount > 0 ? '<div class="translationsub-card__new">' + newCount + ' НОВЫХ</div>' : '') +
                '</div>');

                card.on('hover:focus', function (event) {
                    try { scroll.update($(event.target), true); } catch (e) {}
                });
                container.append(card);
            });

            html.append(container);

            try {
                if (window.TranslationSubCardSource && typeof window.TranslationSubCardSource.bindPage === 'function')
                    window.TranslationSubCardSource.bindPage(html, list);
            } catch (e) {}

            try {
                if (window.TranslationSubUi && typeof window.TranslationSubUi.refresh === 'function')
                    window.TranslationSubUi.refresh();
            } catch (e2) {}

            Lampa.Controller.enable('content');
            focusAfterRender(focusedId);
        }

        function load(done) {
            done = typeof done === 'function' ? done : function () {};
            if (destroyed) return;
            var version = ++requestVersion;
            try { self.activity.loader(true); } catch (e) {}

            loadSnapshot(function (snapshot) {
                if (destroyed || version !== requestVersion) return;
                try { self.activity.loader(false); } catch (e) {}
                render(snapshot);
                try { self.activity.toggle(); } catch (e2) {}
                done(snapshot);
            }, function () {
                if (destroyed || version !== requestVersion) return;
                try { self.activity.loader(false); } catch (e) {}
                render({ subscriptions: [], badge: { count: 0 } });
                try { self.activity.toggle(); } catch (e2) {}
                notify('Не удалось загрузить подписки');
            });
        }

        reloadRef = load;
        window.TranslationSubPageRefresh = reloadRef;

        this.initialize = function () {
            load();
        };
    }

    Lampa.Component.add('translationsub_list', SubscriptionPage);
})();
