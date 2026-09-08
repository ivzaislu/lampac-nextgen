(function () {
    'use strict';

    if (window.__TranslationSubCardActionsStarted) return;
    window.__TranslationSubCardActionsStarted = true;

    var patched = false;
    var busy = {};

    function injectStyles() {
        if (document.getElementById('translationsub-card-actions-style')) return;

        var style = document.createElement('style');
        style.id = 'translationsub-card-actions-style';
        style.textContent =
            '.translationsub-card{position:relative}' +
            '.translationsub-card__unsubscribe{' +
                'position:absolute;right:.62em;bottom:.55em;z-index:7;' +
                'display:flex;align-items:center;justify-content:center;gap:.38em;' +
                'min-width:2.25em;height:2.25em;padding:0 .62em;box-sizing:border-box;' +
                'border-radius:.62em;border:1px solid rgba(255,255,255,.13);' +
                'background:rgba(0,0,0,.20);color:rgba(255,255,255,.72);' +
                'font-size:.76em;line-height:1;transition:background .15s,color .15s,border-color .15s,transform .15s;' +
            '}' +
            '.translationsub-card__unsubscribe svg{' +
                'width:1.2em;height:1.2em;display:block;fill:none;stroke:currentColor;stroke-width:1.9;' +
                'stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto;' +
            '}' +
            '.translationsub-card__unsubscribe.focus,' +
            '.translationsub-card__unsubscribe:hover{' +
                'background:#fff;color:#171717;border-color:#fff;transform:scale(1.06);' +
            '}' +
            '.translationsub-card__unsubscribe--busy{opacity:.48;pointer-events:none}' +
            '.translationsub-card--removing{opacity:.45;transform:scale(.985)!important;transition:opacity .18s,transform .18s}' +
            '.translationsub-tmdb-v2__state{padding-right:7.2em}' +
            '@media(max-width:700px){' +
                '.translationsub-card__unsubscribe{' +
                    'right:.48em;bottom:.45em;width:2.45em;min-width:2.45em;height:2.45em;padding:0;border-radius:.62em;' +
                '}' +
                '.translationsub-card__unsubscribe span{display:none}' +
                '.translationsub-tmdb-v2__state{padding-right:3.1em}' +
            '}';
        (document.head || document.documentElement).appendChild(style);
    }

    function host() {
        try {
            if (window.LampacHost) return String(window.LampacHost).replace(/\/$/, '');
            return window.location.origin || '';
        } catch (e) {
            return '';
        }
    }

    function notify(text) {
        try {
            if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(text);
                return;
            }
        } catch (e) {}
        try { console.log('[TranslationSub]', text); } catch (e2) {}
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
                if (xhr.status >= 200 && xhr.status < 300) success({});
                else error(new Error('HTTP ' + xhr.status));
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

    function unsubscribeIcon() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h12"></path>' +
            '<path d="M10 21h4"></path>' +
            '<path d="M16 16l5 5"></path>' +
            '<path d="M21 16l-5 5"></path>' +
        '</svg>';
    }

    function refreshAfterChange() {
        try {
            if (typeof window.TranslationSubPageRefresh === 'function') window.TranslationSubPageRefresh();
        } catch (e) {}

        try {
            if (window.TranslationSubBadgeState && typeof window.TranslationSubBadgeState.refresh === 'function')
                window.TranslationSubBadgeState.refresh();
        } catch (e2) {}
    }

    function removeSubscription(item, card, action) {
        var id = String(value(item, 'Id', 'id', '') || '');
        if (!id || busy[id]) return;

        var voice = String(value(item, 'TranslationName', 'translationName', 'Озвучка') || 'Озвучка');
        var season = Number(value(item, 'CurrentSeason', 'currentSeason', 1) || 1);
        var isSerial = value(item, 'IsSerial', 'isSerial', true) !== false;

        busy[id] = true;
        action.addClass('translationsub-card__unsubscribe--busy');

        request('POST', '/translationsub/remove?id=' + encodeURIComponent(id), function () {
            delete busy[id];
            card.addClass('translationsub-card--removing');
            notify('Вы отписались · ' + voice + (isSerial ? (' · ' + season + ' сезон') : ''));
            setTimeout(refreshAfterChange, 140);
        }, function () {
            delete busy[id];
            action.removeClass('translationsub-card__unsubscribe--busy');
            notify('Не удалось отписаться · ' + voice);
        });
    }

    function decorate(root, list) {
        if (typeof $ !== 'function') return;
        root = root && root.jquery ? root : $(root);
        list = Array.isArray(list) ? list : [];
        if (!root.length) return;

        var byId = {};
        list.forEach(function (item) {
            var id = String(value(item, 'Id', 'id', '') || '');
            if (id) byId[id] = item;
        });

        root.find('.translationsub-card').each(function () {
            var card = $(this);
            var id = String(card.attr('data-subscription-id') || '');
            var item = byId[id];
            if (!item) return;

            var action = card.children('.translationsub-card__unsubscribe').first();
            if (!action.length) {
                action = $('<div class="translationsub-card__unsubscribe selector" title="Отписаться">' +
                    unsubscribeIcon() + '<span>Отписаться</span></div>');
                card.append(action);
            }

            action.off('.translationsubUnsubscribe');
            action.on('click.translationsubUnsubscribe hover:focus.translationsubUnsubscribe', function (event) {
                event.stopPropagation();
            });
            action.on('hover:enter.translationsubUnsubscribe', function (event) {
                event.stopPropagation();
                removeSubscription(item, card, action);
            });
        });
    }

    function patchSource() {
        if (patched || !window.TranslationSubCardSource || typeof window.TranslationSubCardSource.bindPage !== 'function')
            return false;

        var source = window.TranslationSubCardSource;
        var original = source.bindPage;
        source.bindPage = function (root, list) {
            var result = original.apply(source, arguments);
            decorate(root, list);
            return result;
        };
        source.bindPage.__translationsubCardActionsPatched = true;
        patched = true;
        return true;
    }

    function start() {
        injectStyles();

        if (patchSource()) return;
        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (patchSource() || attempts > 40) clearInterval(wait);
        }, 100);
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
