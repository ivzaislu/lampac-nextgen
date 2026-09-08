(function () {
    'use strict';

    if (window.__TranslationSubPageStarted) return;
    window.__TranslationSubPageStarted = true;

    if (!window.Lampa || !Lampa.Component || typeof Lampa.Component.add !== 'function') return;

    var SOURCE_NAMES = {
        flixcdn: 'FlixCDN',
        phantom: 'Phantom',
        zetflixdb: 'ZetflixDB',
        cdnvideohub: 'VideoHUB',
        multi: 'Несколько источников'
    };

    function storageGet(name, fallback) {
        try {
            if (Lampa.Storage && typeof Lampa.Storage.get === 'function') return Lampa.Storage.get(name, fallback);
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

    function request(method, path, success, error) {
        success = success || function () {};
        error = error || function () {};
        var url = host() + path;

        if (typeof fetch === 'function') {
            fetch(url, { method: method, cache: 'no-store' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    var data = {};
                    try { data = text ? JSON.parse(text) : {}; } catch (e) {}
                    success(data);
                })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    var data = {};
                    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (e) {}
                    success(data);
                } else error(new Error('HTTP ' + xhr.status));
            };
            xhr.send(null);
        } catch (e2) {
            error(e2);
        }
    }

    function sourceName(value) {
        value = String(value || '').toLowerCase();
        return SOURCE_NAMES[value] || value || 'Источник';
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

    function syncWatched(done) {
        done = typeof done === 'function' ? done : function () {};
        try {
            if (window.TranslationSubWatch && typeof window.TranslationSubWatch.sync === 'function') {
                window.TranslationSubWatch.sync(done);
                return;
            }
        } catch (e) {}
        done();
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

        function render(list) {
            if (destroyed) return;
            list = Array.isArray(list) ? list : [];

            var focusedId = String(html.find('.translationsub-card.focus').attr('data-subscription-id') || '');
            html.empty();
            html.append('<div class="translationsub-page__title">Подписки на озвучки</div>');
            html.append('<div class="translationsub-page__subtitle">Прогресс просмотра синхронизируется с Lampac TimeCode · подписок: ' + list.length + '</div>');

            var toolbar = $('<div class="translationsub-toolbar"></div>');
            var check = $('<div class="translationsub-toolbar__item selector"><span>Проверить новые серии</span></div>');
            check.on('hover:enter', function () {
                syncWatched(function () {
                    if (window.TranslationSub && typeof window.TranslationSub.forceCheckUpdatesUI === 'function') {
                        window.TranslationSub.forceCheckUpdatesUI(function () { load(); });
                    } else {
                        load();
                    }
                });
            });
            toolbar.append(check);
            html.append(toolbar);

            var container = $('<div class="translationsub-list"></div>');
            if (!list.length) {
                container.append('<div class="translationsub-empty">Подписок пока нет. Откройте сериал, нажмите «Озвучки» и выберите нужную озвучку.</div>');
            }

            list.forEach(function (item) {
                var id = String(item.Id || item.id || '');
                var title = item.Title || item.title || 'Без названия';
                var voice = item.TranslationName || item.translationName || 'Озвучка';
                var season = Number(item.CurrentSeason || item.currentSeason || 1) || 1;
                var watched = Number(item.CurrentEpisode || item.currentEpisode || 0) || 0;
                var available = Number(item.LastEpisode || item.lastEpisode || 0) || 0;
                var newCount = Math.max(0, available - watched);
                var poster = posterUrl(item.Poster || item.poster || '');
                var sources = item.Sources || item.sources || [];
                var names = [];

                if (Array.isArray(sources)) {
                    sources.forEach(function (source) {
                        var name = sourceName(source.Source || source.source);
                        if (name && names.indexOf(name) === -1) names.push(name);
                    });
                }
                if (!names.length) names.push(sourceName(item.Source || item.source));

                var progressText = 'S' + season + ' · просмотрено E' + watched + ' · озвучка до E' + available;
                if (newCount > 0) {
                    progressText += ' · доступны E' + (watched + 1) + (available > watched + 1 ? '–E' + available : '');
                }
                if (names.length) progressText += ' · ' + names.join(', ');

                var posterHtml = poster
                    ? '<img src="' + escapeHtml(poster) + '" alt="">'
                    : '<div class="translationsub-card__poster-empty"></div>';

                var card = $('<div class="translationsub-card selector" data-subscription-id="' + escapeHtml(id) + '">' +
                    '<div class="translationsub-card__poster">' + posterHtml + '</div>' +
                    '<div class="translationsub-card__body">' +
                        '<div class="translationsub-card__title">' + escapeHtml(title) + '</div>' +
                        '<div class="translationsub-card__voice">' + escapeHtml(voice) + '</div>' +
                        '<div class="translationsub-card__meta">' + escapeHtml(progressText) + '</div>' +
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

        function load() {
            if (destroyed) return;
            var version = ++requestVersion;
            try { self.activity.loader(true); } catch (e) {}

            request('GET', '/translationsub/list?userKey=' + encodeURIComponent(userKey()), function (list) {
                if (destroyed || version !== requestVersion) return;
                try { self.activity.loader(false); } catch (e) {}
                render(Array.isArray(list) ? list : []);
                try { self.activity.toggle(); } catch (e2) {}
            }, function () {
                if (destroyed || version !== requestVersion) return;
                try { self.activity.loader(false); } catch (e) {}
                render([]);
                try { self.activity.toggle(); } catch (e2) {}
                notify('Не удалось загрузить подписки');
            });
        }

        reloadRef = load;
        window.TranslationSubPageRefresh = reloadRef;

        this.initialize = function () {
            // Одна первичная отрисовка: сначала TimeCode, затем list.
            syncWatched(load);
        };
    }

    Lampa.Component.add('translationsub_list', SubscriptionPage);
})();
