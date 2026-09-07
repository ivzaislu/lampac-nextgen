(function () {
    'use strict';

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
            if (Lampa.Storage && typeof Lampa.Storage.get === 'function')
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

    function escapeHtml(value) {
        try {
            if (Lampa.Utils && typeof Lampa.Utils.escape === 'function')
                return Lampa.Utils.escape(String(value || ''));
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
        var url = host() + path;
        success = success || function () {};
        error = error || function () {};

        if (typeof fetch === 'function') {
            fetch(url, { method: method })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function (text) {
                    try { success(text ? JSON.parse(text) : {}); }
                    catch (e) { success({}); }
                })
                .catch(error);
            return;
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { success(xhr.responseText ? JSON.parse(xhr.responseText) : {}); }
                    catch (e) { success({}); }
                } else {
                    error(new Error('HTTP ' + xhr.status));
                }
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

    function showActions(title, items, onBack) {
        if (!Lampa.Select || typeof Lampa.Select.show !== 'function') return;

        Lampa.Select.show({
            title: title,
            items: items,
            onSelect: function (item) {
                if (item && typeof item.onclick === 'function') item.onclick();
            },
            onBack: function () {
                if (onBack) onBack();
                else Lampa.Controller.toggle('content');
            }
        });
    }

    function SubscriptionPage(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="translationsub-page"></div>');
        var self = this;
        var initialized = false;
        var destroyed = false;

        this.create = function () {
            scroll.minus();
            scroll.append(html);
            return this.render();
        };

        this.render = function () {
            return scroll.render();
        };

        this.pause = function () {};
        this.stop = function () {};
        this.back = function () {
            Lampa.Activity.backward();
        };

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
            try { scroll.destroy(); } catch (e) {}
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
            list = Array.isArray(list) ? list : [];

            html.empty();
            html.append('<div class="translationsub-page__title">Подписки на озвучки</div>');
            html.append('<div class="translationsub-page__subtitle">Подписок: ' + list.length + '</div>');

            var toolbar = $('<div class="translationsub-toolbar"></div>');
            var reload = $('<div class="translationsub-toolbar__item selector"><span>Обновить список</span></div>');
            reload.on('hover:enter', load);
            toolbar.append(reload);

            var check = $('<div class="translationsub-toolbar__item selector"><span>Проверить новые серии</span></div>');
            check.on('hover:enter', function () {
                if (window.TranslationSub && typeof window.TranslationSub.forceCheckUpdatesUI === 'function') {
                    window.TranslationSub.forceCheckUpdatesUI(function () { load(); });
                } else {
                    load();
                }
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
                var episode = Number(item.LastEpisode || item.lastEpisode || item.CurrentEpisode || item.currentEpisode || 0) || 0;
                var poster = posterUrl(item.Poster || item.poster || '');
                var sources = item.Sources || item.sources || [];
                var sourceText = '';

                if (Array.isArray(sources) && sources.length) {
                    var names = [];
                    sources.forEach(function (source) {
                        var name = sourceName(source.Source || source.source);
                        if (names.indexOf(name) === -1) names.push(name);
                    });
                    sourceText = names.join(', ');
                } else {
                    sourceText = sourceName(item.Source || item.source);
                }

                var posterHtml = poster
                    ? '<img src="' + escapeHtml(poster) + '" alt="">'
                    : '<div class="translationsub-card__poster-empty"></div>';

                var card = $('<div class="translationsub-card selector">' +
                    '<div class="translationsub-card__poster">' + posterHtml + '</div>' +
                    '<div class="translationsub-card__body">' +
                        '<div class="translationsub-card__title">' + escapeHtml(title) + '</div>' +
                        '<div class="translationsub-card__voice">' + escapeHtml(voice) + '</div>' +
                        '<div class="translationsub-card__meta">S' + season + (episode ? ' · E' + episode : '') + (sourceText ? ' · ' + escapeHtml(sourceText) : '') + '</div>' +
                    '</div>' +
                '</div>');

                card.on('hover:focus', function (event) {
                    try { scroll.update($(event.target), true); } catch (e) {}
                });

                card.on('hover:enter', function () {
                    showActions(title, [
                        {
                            title: 'Удалить подписку',
                            onclick: function () {
                                request('POST', '/translationsub/remove?id=' + encodeURIComponent(id), function () {
                                    notify('Подписка удалена');
                                    load();
                                }, function () {
                                    notify('Не удалось удалить подписку');
                                });
                            }
                        }
                    ], function () { Lampa.Controller.toggle('content'); });
                });

                container.append(card);
            });

            html.append(container);
            Lampa.Controller.enable('content');
            focusFirst();
        }

        function load() {
            if (destroyed) return;
            try { self.activity.loader(true); } catch (e) {}

            request('GET', '/translationsub/list?userKey=' + encodeURIComponent(userKey()), function (list) {
                try { self.activity.loader(false); } catch (e) {}
                render(list);
                try { self.activity.toggle(); } catch (e) {}
            }, function () {
                try { self.activity.loader(false); } catch (e) {}
                render([]);
                try { self.activity.toggle(); } catch (e) {}
                notify('Не удалось загрузить подписки');
            });
        }

        this.initialize = load;
    }

    Lampa.Component.add('translationsub_list', SubscriptionPage);
})();
