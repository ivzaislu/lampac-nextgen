
// ===== Variants cache (localStorage) =====
var VARIANTS_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
var VARIANTS_CACHE_PREFIX = "transsubscribe_variants_cache_v2:";

function nowMs() { return Date.now ? Date.now() : (new Date()).getTime(); }

function buildVariantsCacheKey(userKey, contentId, season, source) {
    return VARIANTS_CACHE_PREFIX + String(userKey||"") + "|" + String(contentId||"") + "|" + String(season||"") + "|" + String(source||"");
}

function loadVariantsCache(key) {
    try {
        var raw = localStorage.getItem(key);
        if (!raw) return null;

        var obj = null;
        try { obj = JSON.parse(raw); } catch (e0) { return null; }

        // Если ts отсутствует или некорректный — не считаем кэш протухшим,
        // просто вернём data (лучше иметь что-то, чем сбрасывать из-за кривого времени на ТВ).
        if (!obj) return null;
        if (typeof obj.ts !== 'number') return (obj && obj.data) ? obj.data : null;

        var age = nowMs() - obj.ts;

        // Если системное время "скачет" назад/вперёд (часто на SmartTV) — не инвалидируем кэш.
        if (age < 0) return obj.data;

        if (age > VARIANTS_CACHE_TTL_MS) {
            localStorage.removeItem(key);
            return null;
        }

        return obj.data;
    } catch (e) { return null; }
}

function saveVariantsCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({ ts: nowMs(), data: data }));
    } catch(e){
        // На некоторых SmartTV localStorage может быть недоступен/очищаться — не падаем молча
        try { console.log('[TranslationSub] variants cache save failed', e); } catch(e2){}
    }
}

function invalidateVariantsCacheForContent(userKey, contentId) {
    try {
        var prefix = VARIANTS_CACHE_PREFIX + String(userKey||"") + "|" + String(contentId||"");
        for (var i = localStorage.length-1; i>=0; i--) {
            var k = localStorage.key(i);
            if (k && k.indexOf(prefix) === 0) localStorage.removeItem(k);
        }
    } catch(e){}
}
(function () {
    'use strict';

    // защита от двойной загрузки скрипта
    if (window.__TranslationSubInit) return;
    window.__TranslationSubInit = true;

    // ========= НАСТРОЙКИ =========
    var HOST = window.LampacHost || (window.location && window.location.origin) || '';

    // ========= API эндпоинты =========
    var API = {
        toggle: '/transsubscribe/toggle',
        list: '/transsubscribe/list',
        updates: '/transsubscribe/updates',
        variants: '/transsubscribe/variants',
        progress: '/transsubscribe/progress',
    };

    function toQS(params) {
        params = params || {};
        return Object.keys(params)
            .filter(function (k) {
                var v = params[k];
                return v !== null && v !== undefined && v !== '';
            })
            .map(function (k) {
                return (
                    encodeURIComponent(k) +
                    '=' +
                    encodeURIComponent(params[k])
                );
            })
            .join('&');
    }

    // ВАЖНО: механизм игнорирования балансеров перенесён на сервер.
    // Клиент отображает ровно то, что вернул /transsubscribe/variants.

    // userKey завяжем на client_uid
    function getUserKey() {
        try {
            return localStorage.getItem('client_uid') || 'local';
        } catch (e) {
            return 'local';
        }
    }

    // UID аккаунта Лампы (тот, что нужен accsdb)
    function getUid() {
        try {
            return localStorage.getItem('client_uid') || null;
        } catch (e) {
            return null;
        }
    }

    // Добавляем ?uid=... ко всем запросам на HOST
    function addUidToUrl(url) {
        try {
            if (typeof url !== 'string') return url;

            if (HOST && url.indexOf(HOST) === 0) {
                var uid = getUid();
                if (uid) {
                    url += (url.indexOf('?') === -1 ? '?' : '&') + 'uid=' + encodeURIComponent(uid);
                }
            }
        } catch (e) {}

        return url;
    }

    // ========= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =========
    function normalizeRequestBody(body) {
        // Возвращает { str, obj }:
        // - str: строка для fetch / Utils.request
        // - obj: объект для Reguest.send (там удобнее data как объект)
        if (body == null) return { str: null, obj: null };

        // если уже объект — сериализуем
        if (typeof body === 'object') {
            try {
                return { str: JSON.stringify(body), obj: body };
            } catch (e) {
                return { str: null, obj: null };
            }
        }

        // если строка — попробуем распарсить
        if (typeof body === 'string') {
            var txt = body;
            try {
                var parsed = txt ? JSON.parse(txt) : null;
                return { str: txt, obj: parsed };
            } catch (e) {
                return { str: txt, obj: null };
            }
        }

        // прочие типы — приводим к строке
        try {
            return { str: String(body), obj: null };
        } catch (e) {
            return { str: null, obj: null };
        }
    }

    function request(opts, onSuccess, onError) {
        opts = opts || {};
        opts.url = addUidToUrl(opts.url);

        onSuccess = onSuccess || function () {};
        onError = onError || function () {};

        var data = opts.body == null ? null : opts.body;

        // если вдруг передали строку — попробуем распарсить
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {}
        }

        var headers = Object.assign(
            {
                'Content-Type': 'application/json; charset=utf-8',
            },
            opts.headers || {}
        );

        // 1) Через Lampa.Reguest
        if (window.Lampa && Lampa.Reguest && typeof Lampa.Reguest.send === 'function') {
            Lampa.Reguest.send(
                opts.url,
                function (result) {
                    onSuccess(result || {});
                },
                function (error) {
                    console.log('[TranslationSub] request error (Reguest.send)', error);
                    onError(error);
                },
                {
                    method: opts.method || 'GET',
                    data: data, // объект или null
                    headers: headers,
                }
            );
            return;
        }

        // 2) Lampa.Utils.request
        if (window.Lampa && Lampa.Utils && typeof Lampa.Utils.request === 'function') {
            Lampa.Utils.request(
                {
                    url: opts.url,
                    method: opts.method || 'GET',
                    body: data ? JSON.stringify(data) : null,
                    headers: headers,
                    timeout: opts.timeout || 15000,
                },
                function (result) {
                    onSuccess(result || {});
                },
                function (error) {
                    console.log('[TranslationSub] request error (Utils.request)', error);
                    onError(error);
                }
            );
            return;
        }

        // 3) Фолбэк: fetch
        if (typeof fetch === 'function') {
            fetch(opts.url, {
                method: opts.method || 'GET',
                headers: headers,
                body: data ? JSON.stringify(data) : null,
            })
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.text();
                })
                .then(function (txt) {
                    try {
                        onSuccess(txt ? JSON.parse(txt) : {});
                    } catch (e) {
                        onSuccess({});
                    }
                })
                .catch(function (err) {
                    console.log('[TranslationSub] request error (fetch)', err);
                    onError(err);
                });

            return;
        }

        console.log('[TranslationSub] нет ни Lampa.Reguest, ни Lampa.Utils.request, ни fetch');
    }

    
// ========= УВЕДОМЛЕНИЯ (Lampa.Noty) + МИНИ-CSS =========
// Полностью переходим на ламповские оповещения. Самописные toast'ы удалены.

// CSS для бейджа обновлений в хедере
var ts_badge_styles_injected = false;

function injectBadgeStyles() {
    if (ts_badge_styles_injected) return;
    ts_badge_styles_injected = true;

    var css =
        '' +
        '.translation-sub-head-btn{' +
        ' position:relative;' +
        '}' +
        '.translation-sub-badge{' +
        ' position:absolute;' +
        ' top:-4px;' +
        ' right:-4px;' +
        ' min-width:18px;' +
        ' height:18px;' +
        ' padding:0 4px;' +
        ' border-radius:9px;' +
        ' background:#e53935;' +
        ' color:#fff;' +
        ' font-size:11px;' +
        ' display:flex;' +
        ' align-items:center;' +
        ' justify-content:center;' +
        ' pointer-events:none;' +
        '}';

    var style = document.createElement('style');
    style.type = 'text/css';
    style.className = 'translation-sub-badge-style';
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(style);
}

// Подсветка выбранной озвучки в селекте (если используется)
var ts_select_styles_injected = false;

function injectTranslationSelectStyles() {
    if (ts_select_styles_injected) return;
    ts_select_styles_injected = true;

    var css =
        '' +
        '.translation-sub-subscribed .selectbox-item__title{' +
        ' display:inline-block;' +
        ' padding:2px 8px;' +
        ' border-radius:6px;' +
        ' border:1px solid rgba(255,255,255,0.6);' +
        ' box-sizing:border-box;' +
        '}';

    var style = document.createElement('style');
    style.type = 'text/css';
    style.className = 'translation-sub-select-style';
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(style);
}

// Единая функция уведомлений: Lampa.Noty (fallback в console)
// ВАЖНО (TV/пульт): при появлении тостов у некоторых оболочек теряется фокус контроллера.
// Поэтому сохраняем активный элемент/контроллер и пытаемся восстановить после показа.
function noty(text, title, type) {
    var prevActiveEl = null;
    var hadFocus = true;

    try {
        prevActiveEl = document.activeElement;
        // На ТВ иногда activeElement = body -> считаем, что фокуса как бы нет
        hadFocus = !!(prevActiveEl && prevActiveEl !== document.body);
    } catch (e) {}

    try {
        if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
            var prefix = type === 'error' ? '⚠ ' : type === 'success' ? '✅ ' : '';
            var msg = title ? prefix + title + ': ' + text : prefix + text;

            Lampa.Noty.show(msg);

            // Мягко восстанавливаем фокус/контроллер после тоста.
            // Не трогаем состояние, если фокус не потерян (чтобы не сбивать Select/Popup).
            (function restoreControllerAndFocus(){
                try {
                    // Если после тоста фокус ушёл в body/никуда — вернём на прежний элемент
                    var now = null;
                    try { now = document.activeElement; } catch (e2) {}

                    var lost =
                        !now ||
                        now === document.body ||
                        (hadFocus && prevActiveEl && now !== prevActiveEl && now === document.body);

                    if (lost && prevActiveEl && prevActiveEl.focus) {
                        // focus({preventScroll:true}) поддерживается не везде — поэтому безопасно
                        try { prevActiveEl.focus({ preventScroll: true }); } catch (e7) { try { prevActiveEl.focus(); } catch(e8){} }
                    }

                    // Доп. страховка: если контроллер оказался выключен/сброшен — мягко «пере-тогглим» текущий контекст
                    if (window.Lampa && Lampa.Controller && typeof Lampa.Controller.toggle === 'function') {
                        // Если открыт Select — возвращаем управление ему, иначе — контенту/хедеру по наличию.
                        if (typeof $ === 'function' && $('.selectbox:visible').length) {
                            try { Lampa.Controller.toggle('select'); } catch (e3) {}
                        } else if (typeof $ === 'function' && $('.head:visible').length && $('.head__actions:visible').length) {
                            try { Lampa.Controller.toggle('head'); } catch (e4) {}
                        } else {
                            try { Lampa.Controller.toggle('content'); } catch (e5) {}
                        }
                    }
                } catch (e6) {}
            })();

            // На некоторых ТВ тост забирает фокус в следующем кадре — продублируем восстановление без заметной задержки
            try { requestAnimationFrame(function(){ 
                try {
                    if (prevActiveEl && prevActiveEl.focus) {
                        try { prevActiveEl.focus({ preventScroll: true }); } catch (e9) { try { prevActiveEl.focus(); } catch(e10){} }
                    }
                    if (window.Lampa && Lampa.Controller && typeof Lampa.Controller.toggle === 'function') {
                        if (typeof $ === 'function' && $('.selectbox:visible').length) {
                            try { Lampa.Controller.toggle('select'); } catch (e11) {}
                        } else if (typeof $ === 'function' && $('.head:visible').length && $('.head__actions:visible').length) {
                            try { Lampa.Controller.toggle('head'); } catch (e12) {}
                        } else {
                            try { Lampa.Controller.toggle('content'); } catch (e13) {}
                        }
                    }
                } catch (e14) {}
            }); } catch (e15) {}


            return;
        }
    } catch (e) {}

    console.log('[TranslationSub] NOTY:', title ? title + ': ' + text : text);
}

// ========= ОСНОВНАЯ ЛОГИКА =========
    function buildContentId(item) {
        if (!item) return null;

        var cid =
            item._id ||
            item.id ||
            (item.movie && item.movie.id) ||
            item.movie_id ||
            item.kp_id ||
            item.imdb_id ||
            item.tmdb_id ||
            null;

        if (!cid) {
            console.log('[TranslationSub] buildContentId: no id in item', item);
            return null;
        }

        return String(cid);
    }

    // Получаем tmdb id из Activity.active().url вида "tv/123" или "movie/123"
    function getContentIdFromActive(active) {
        try {
            if (!active || typeof active.url !== 'string') return null;
            var u = String(active.url || '').replace(/^\//, '').split('?')[0];
            var m = u.match(/(?:^|\/)(tv|movie)\/(\d+)/i);
            return m ? String(m[2]) : null;
        } catch (e) {
            return null;
        }
    }

    // Показываем кнопку подписки только для сериалов.
    // В разных местах Lampa отдаёт данные по-разному (card/data/movie), поэтому
    // проверяем несколько признаков и приоритетно используем Activity.
    function detectMediaType(active, item) {
        try {
            if (active) {
                if (active.method === 'tv') return 'tv';
                if (active.method === 'movie') return 'movie';

                if (typeof active.url === 'string') {
                    var u = String(active.url).replace(/^\//, '').split('?')[0];

                    if (u.indexOf('tv/') === 0 || u.indexOf('/tv/') !== -1) return 'tv';
                    if (u.indexOf('movie/') === 0 || u.indexOf('/movie/') !== -1) return 'movie';
                }
            }

            var movie = (item && (item.movie || item.card || item.data || item)) || {};

            if (movie.media_type === 'tv' || movie.type === 'tv') return 'tv';
            if (movie.number_of_seasons) return 'tv';
            if (Array.isArray(movie.seasons) && movie.seasons.length) return 'tv';
            if (movie.first_air_date) return 'tv';
            if (item && item.is_serial) return 'tv';
            if (movie && movie.is_serial) return 'tv';

            if (movie.media_type === 'movie' || movie.type === 'movie') return 'movie';
            if (movie.release_date && !movie.first_air_date && !movie.number_of_seasons) return 'movie';

            return null;
        } catch (e) {
            return null;
        }
    }

    // Показываем кнопку подписки только для сериалов.
    function isSerialItem(item, active) {
        return detectMediaType(active, item) === 'tv';
    }

function getImdbIdFromItem(item) {
    if (!item) return '';

    var movie = item.movie || item;

    var imdbId =
        item.imdb_id ||
        movie.imdb_id ||
        (movie.ids && (movie.ids.imdb || movie.ids.imdb_id)) ||
        '';

    return imdbId ? String(imdbId).trim() : '';
}

    function buildBaseBody(item) {
        var movie = (item && (item.movie || item.card || item.data || item)) || {};

        return {
            userKey: getUserKey(),
            contentId: buildContentId(item || movie),
            title: (item && (item.title || item.name)) || movie.title || movie.name || '',
            originalTitle:
                (item && (item.original_title || item.original_name)) ||
                movie.original_title ||
                movie.original_name ||
                '',
            kpId:
                (item && (item.kp_id || item.kinopoisk_id)) ||
                movie.kp_id ||
                movie.kinopoisk_id ||
                '',
            imdbId: getImdbIdFromItem(item || movie),
            year:
                (item && item.year) ||
                (movie.first_air_date && movie.first_air_date.slice(0, 4)) ||
                (movie.release_date && movie.release_date.slice(0, 4)) ||
                null,
            isSerial: true,
        };
    }


    // ========= определение последней просмотренной серии через online_watched_last =========
    function detectLastWatched(ctx) {
        try {
            if (!ctx) return { season: null, episode: null };

            var movie = ctx.movie || ctx;
            var title =
                movie.original_name ||
                movie.original_title ||
                movie.name ||
                movie.title ||
                '';

            if (!title) return { season: null, episode: null };

            var history = {};

            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function') {
                // важно: по умолчанию объект, а не строка '{}'
                history = Lampa.Storage.get('online_watched_last', {}) || {};
            } else {
                try {
                    history = JSON.parse(localStorage.getItem('online_watched_last') || '{}');
                } catch (e) {
                    history = {};
                }
            }

            var hash =
                window.Lampa &&
                Lampa.Utils &&
                typeof Lampa.Utils.hash === 'function'
                    ? Lampa.Utils.hash(title)
                    : title;

            var filed = history[hash];

            if (filed && filed.episode) {
                return {
                    season: filed.season || null,
                    episode: filed.episode || null,
                };
            }

            return {
                season: null,
                episode: null,
            };
        } catch (e) {
            console.log('[TranslationSub] detectLastWatched error', e);
            return { season: null, episode: null };
        }
    }

    // Подписка НА ОЗВУЧКУ (по группе, сразу на все балансеры)
    function buildVoiceSubscriptionBody(group, item) {
    var base = buildBaseBody(item);

    // собираем массив источников для этой озвучки
    var sources = (group.variants || [])
        .map(function (v) {
            return {
                source: v.source || '',
                // сначала пробуем v.path, потом уже url/player на будущее
                path: v.path || v.url || v.player || '',
                translationId:
                    v.translation_id ||
                    v.translate_id ||
                    v.voice_id ||
                    v.id ||
                    '',
                translationName: group.displayName || v.name || '',
            };
        })
        .filter(function (s) {
            return s.source && s.translationId;
        });

    var first = sources[0] || {};
    var watch = detectLastWatched(item);

    return Object.assign({}, base, {
        // "основной" источник / id – для совместимости и отображения
        source: first.source || '',
        translationId: first.translationId || '',
        translationName: group.displayName || '',
        currentSeason: watch.season,
        currentEpisode: watch.episode,
        // массив всех источников с этой озвучкой
        sources: sources,
    });
}

    // Включить/выключить подписку на ОЗВУЧКУ (на всех балансерах)
    function toggleVoiceSubscription(group, item, cb) {
        var body = buildVoiceSubscriptionBody(group, item);

        if (!body.userKey) {
            noty('Не найден userKey для Lampac');
            return;
        }

        if (!body.contentId) {
            noty(
                'Не удалось определить ID тайтла (contentId)',
                body.title || body.name || ''
            );
            console.log(
                '[TranslationSub] toggleVoiceSubscription: no contentId for item',
                item
            );
            return;
        }

        request(
            {
                url: HOST + API.toggle,
                method: 'POST',
                body: body,
            },
            function (result) {
                // Не доверяем result, а смотрим реальное состояние через обновлённый кэш (/list)
                // после toggle обязателен force-refresh /list (иначе можем попасть в гонку)
                subscriptionsCache = null;
                subscriptionsCacheUpdatedAt = 0;

                setTimeout(function () {
                    refreshSubscriptionsCache(true, function () {
                    // После изменения подписок сразу обновим бейдж/список обновлений
                    // (сервер отдаст кеш, но он уже будет очищен от мусора).
                    try { setTimeout(function(){ checkUpdates(); }, 400); } catch (e) {}
                    checkVoiceSubscriptionState(body, function (isSubscribed) {
                    if (isSubscribed === null) {
                        // не смогли узнать состояние – покажем нейтральное сообщение
                        noty('Подписка на озвучку переключена', body.title);
                    } else if (isSubscribed) {
                        noty('Подписка на озвучку включена', body.title);
                    } else {
                        noty('Подписка на озвучку отключена', body.title);
                    }

                    cb && cb({ isSubscribed: !!isSubscribed, raw: result });
                    });
                });
                }, 350);
            },
            function () {
                noty('Ошибка подписки на озвучку', body.title, 'error');
            }
        );
    }

    // ========= АВТО-ОТПИСКА (когда сезон досмотрен) перенесена на сервер =========
    // Сервер сам удаляет подписки, когда получает /progress и видит, что сезон завершён.
    // Клиент больше не делает лишние запросы (/list + /toggle) и не хранит эту логику.

    // ========= ОТПРАВКА ПРОГРЕССА (/progress) =========
    var lastProgressKey = null;
    var lastAutoUnsubToastKey = window.__ts_lastAutoUnsubToastKey || null;



// ======= "прочитанность" апдейтов =======
// Бейдж должен гореть, пока пользователь не посмотрит последнюю доступную серию.
// Поэтому считаем "непрочитанные" апдейты, сравнивая их с последним просмотренным эпизодом для contentId.
function watchedKeyForContent(contentId) {
    return 'ts_last_watched:' + String(getUserKey() || 'local') + ':' + String(contentId || '');
}

function getWatchedForContent(contentId) {
    try {
        var raw = localStorage.getItem(watchedKeyForContent(contentId));
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj) return null;
        return { season: obj.season || null, episode: obj.episode || null };
    } catch (e) { return null; }
}

function setWatchedForContent(contentId, season, episode) {
    try {
        if (!contentId || !season || !episode) return;
        localStorage.setItem(
            watchedKeyForContent(contentId),
            JSON.stringify({ season: season, episode: episode, ts: nowMs() })
        );
    } catch (e) {}
}

function isUpdateUnread(u) {
    try {
        if (!u || !u.contentId) return false;
        var s = parseInt(u.season || u.Season || 0, 10) || 0;
        var e = parseInt(u.episode || u.Episode || 0, 10) || 0;
        if (!s || !e) return true;

        var w = getWatchedForContent(u.contentId);
        if (!w || !w.season || !w.episode) return true;

        var ws = parseInt(w.season, 10) || 0;
        var we = parseInt(w.episode, 10) || 0;

        if (s > ws) return true;
        if (s < ws) return false;
        return e > we;
    } catch (e2) { return true; }
}

function countUnreadUpdates(list) {
    try {
        if (!Array.isArray(list) || !list.length) return 0;
        var c = 0;
        for (var i = 0; i < list.length; i++) if (isUpdateUnread(list[i])) c++;
        return c;
    } catch (e) { return 0; }
}
    function syncProgressForItem() {
        try {
            if (!window.Lampa || !Lampa.Storage) return;

            // берём текущую активность (full-карточка)
            var activity = Lampa.Storage.get('activity', {}) || {};
            var full =
                activity.movie || activity.card || window.__last_full_data || null;

            if (!full) return;

            var movie = full.movie || full;
            var last = detectLastWatched(movie);

            if (!last.season || !last.episode) return;

            var contentId = buildContentId(movie);
            if (!contentId) return;

            // чтобы не спамить одинаковыми запросами
            var key =
                contentId + ':' + last.season + 'x' + last.episode;
            if (lastProgressKey === key) return;

            lastProgressKey = key;

            

            // сохраняем последнее просмотренное для корректного бейджа апдейтов
            setWatchedForContent(contentId, last.season, last.episode);
var body = {
                userKey: getUserKey(),
                contentId: contentId,
                lastSeason: last.season,
                lastEpisode: last.episode,
            };

            console.log('[TranslationSub] syncProgressForItem:', body);

            request(
                {
                    url: HOST + API.progress,
                    method: 'POST',
                    body: body,
                },
                function (res) {
                    console.log('[TranslationSub] progress updated', res);

                    // Сервер может авто-отписать при завершении сезона.
                    // В этом случае нужно обновить список подписок (кэш) и бейдж.
                    
if (res && (res.autoUnsubscribed || res.AutoUnsubscribed)) {
                        var s = (res.season || res.Season || '');
                        var e = (res.episode || res.Episode || '');
                        var k = body.contentId + ':' + s + 'x' + e;

                        // не показываем одно и то же уведомление дважды (если /progress улетел повторно)
                        if (lastAutoUnsubToastKey === k) return;
                        lastAutoUnsubToastKey = k;
                        window.__ts_lastAutoUnsubToastKey = k;

                        noty('Сезон досмотрен — подписка снята', '', 'success');

                        // сбросим кэш и перезагрузим /list
                        subscriptionsCacheUpdatedAt = 0;
                        refreshSubscriptionsCache(true, function () {
                            // обновим бейдж обновлений (если используется)
                            checkUpdates();
                        
        // refresh bell badge from updates
        checkUpdates();
    });
                    }},
                function (err) {
                    console.log(
                        '[TranslationSub] progress update error',
                        err
                    );
                }
            );
        } catch (e) {
            console.log('[TranslationSub] syncProgressForItem error', e);
        }
    }

    // ========= ОБЩАЯ ЗАГРУЗКА ОБНОВЛЕНИЙ + БЕЙДЖ В ХЕДЕРЕ =========
    // кэш списка подписок (обновляется только вручную/по интервалу)
    var subscriptionsCache = null;

    // Склеиваем параллельные обновления подписок (чтобы не спамить /list)
    var subsRefreshInFlight = false;
    var subsRefreshQueue = [];

    // Кэш подписок: чтобы не дергать /list на каждое действие
    var SUBS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут
    var subscriptionsCacheUpdatedAt = 0;

    function updateSubscriptionsCache(list) {
        if (Array.isArray(list)) {
            subscriptionsCache = list.slice(); // копия
            subscriptionsCacheUpdatedAt = Date.now();
        }
    }

    function isSubscriptionsCacheFresh() {
        return (
            Array.isArray(subscriptionsCache) &&
            subscriptionsCacheUpdatedAt &&
            Date.now() - subscriptionsCacheUpdatedAt < SUBS_CACHE_TTL_MS
        );
    }

    // force=true: гарантированно делаем новый запрос к /list (важно после toggle)
    var subsForceRefreshPending = false;

    function refreshSubscriptionsCache(force, cb) {
        if (typeof force === 'function') {
            cb = force;
            force = false;
        }

        if (cb) subsRefreshQueue.push(cb);

        // если уже идёт обновление — просто ждём результат
        // но если force=true — ставим флаг и после завершения сделаем ещё один запрос,
        // чтобы не попасть в гонку (когда /list ушёл до toggle и вернул старый список)
        if (subsRefreshInFlight) {
            if (force) subsForceRefreshPending = true;
            return;
        }
        subsRefreshInFlight = true;

        var userKey = getUserKey();
        if (!userKey) {
            updateSubscriptionsCache([]);
            subsRefreshInFlight = false;

            var q0 = subsRefreshQueue.splice(0);
            q0.forEach(function (fn) {
                try { fn([]); } catch (e) {}
            });
            return;
        }

        request(
            {
                url: HOST + API.list + "?userKey=" + encodeURIComponent(userKey) + (force ? "&_ts=" + Date.now() : ""),
                method: 'GET',
            },
            function (list) {
                if (!Array.isArray(list)) list = [];

                updateSubscriptionsCache(list);
                subsRefreshInFlight = false;

                var q = subsRefreshQueue.splice(0);
                q.forEach(function (fn) {
                    try { fn(list); } catch (e) {}
                });

                // если во время запроса кто-то попросил force-refresh — делаем ещё один проход
                if (subsForceRefreshPending) {
                    subsForceRefreshPending = false;
                    refreshSubscriptionsCache(true);
                }
            },
            function (err) {
                console.log('[TranslationSub] refreshSubscriptionsCache error', err);

                subsRefreshInFlight = false;
                var fallback = Array.isArray(subscriptionsCache) ? subscriptionsCache : [];

                var q = subsRefreshQueue.splice(0);
                q.forEach(function (fn) {
                    try { fn(fallback); } catch (e) {}
                });

                // даже если упало — не зацикливаемся на force
                subsForceRefreshPending = false;
            }
        );
    }

    // гарантируем, что кэш есть (и достаточно свежий)
    function ensureSubscriptionsCache(cb) {
        if (isSubscriptionsCacheFresh()) {
            cb && cb(subscriptionsCache);
            return;
        }
        refreshSubscriptionsCache(false, cb);
    }

    var lastUpdatesList = [];
    var currentUpdatesCount = 0;


    // Склеиваем параллельные запросы /updates и слегка троттлим
    var updatesInFlight = false;
    var updatesQueue = [];
    var updatesLastAt = 0;
    var UPDATES_THROTTLE_MS = 3000;


// Кэш апдейтов (localStorage) на 20 минут — чтобы бейдж появлялся мгновенно после перезапуска
var UPDATES_CACHE_TTL_MS = 20 * 60 * 1000;
var UPDATES_CACHE_PREFIX = 'transsubscribe_updates_cache_v1:';

function updatesCacheKey(userKey) {
    return UPDATES_CACHE_PREFIX + String(userKey || 'local');
}

function loadUpdatesCache(userKey) {
    try {
        var raw = localStorage.getItem(updatesCacheKey(userKey));
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || !Array.isArray(obj.data)) return null;

        if (typeof obj.ts !== 'number') return obj.data;

        var age = nowMs() - obj.ts;
        if (age < 0) return obj.data;
        if (age > UPDATES_CACHE_TTL_MS) {
            localStorage.removeItem(updatesCacheKey(userKey));
            return null;
        }
        return obj.data;
    } catch (e) { return null; }
}

function saveUpdatesCache(userKey, list) {
    try {
        localStorage.setItem(updatesCacheKey(userKey), JSON.stringify({ ts: nowMs(), data: list || [] }));
    } catch (e) {}
}
    function updateHeadBadge(count) {
        currentUpdatesCount = count || 0;
        injectBadgeStyles();

        if (typeof $ !== 'function') return;

        var btn = $('.translation-sub-head-btn').first();
        if (!btn.length) return;

        var badge = btn.find('.translation-sub-badge');
        if (!badge.length) {
            badge = $('<div class="translation-sub-badge"></div>');
            btn.append(badge);
        }

        if (currentUpdatesCount > 0) {
            var text =
                currentUpdatesCount > 99 ? '99+' : String(currentUpdatesCount);
            badge.text(text);
            badge.show();
        } else {
            badge.hide();
        }
    }

    
function fetchUpdates(showToasts, cb) {
        var userKey = getUserKey();
        if (!userKey) {
            try { updateHeadBadge(0); } catch (e0) {}
            cb && cb([]);
            return;
        }


        // пробуем быстрый кэш, если ещё ничего не загружали
        if (!Array.isArray(lastUpdatesList) || !lastUpdatesList.length) {
            var cached = loadUpdatesCache(userKey);
            if (cached && Array.isArray(cached)) {
                lastUpdatesList = cached;
                try { updateHeadBadge(countUnreadUpdates(cached)); } catch (e1) {}
            }
        }
        if (cb) updatesQueue.push(cb);

        if (updatesInFlight) return;

        var t = Date.now();
        if (updatesLastAt && (t - updatesLastAt < UPDATES_THROTTLE_MS) && Array.isArray(lastUpdatesList)) {
            try { updateHeadBadge(countUnreadUpdates(lastUpdatesList)); } catch (e1) {}
            var q0 = updatesQueue.splice(0);
            q0.forEach(function (fn) { try { fn(lastUpdatesList); } catch (e2) {} });
            return;
        }

        updatesInFlight = true;
        updatesLastAt = t;

        request(
            {
                url:
                    HOST +
                    API.updates + '?userKey=' +
                    encodeURIComponent(userKey),
                method: 'GET',
            },
            function (list) {
                if (!Array.isArray(list)) list = [];

                lastUpdatesList = list;



                try { saveUpdatesCache(userKey, list); } catch (e9) {}
                updatesInFlight = false;
                try { updateHeadBadge(countUnreadUpdates(list)); } catch (e) {}

                var q = updatesQueue.splice(0);
                q.forEach(function(fn){ try { fn(list); } catch(e2){} });
},
            function (err) {
                console.log('[TranslationSub] fetchUpdates error', err);

                updatesInFlight = false;
                try { updateHeadBadge(0); } catch (e0) {}

                var q = updatesQueue.splice(0);
                q.forEach(function(fn){ try { fn([]); } catch(e2){} });
}
        );
    }

    // Реальная проверка (сервер делает on-demand refresh и обновляет кеш).
    // Требует поддержки на сервере: /transsubscribe/updates?userKey=...&force=1
    function fetchUpdatesForce(showToasts, cb) {
        var userKey = getUserKey();
        if (!userKey) {
            updateHeadBadge(0);
        cb && cb([]);
            return;
        }

        request(
            {
                url:
                    HOST +
                    API.updates +
                    '?userKey=' +
                    encodeURIComponent(userKey) +
                    '&force=1',
                method: 'GET',
                timeout: 60000,
            },
            function (list) {
                if (!Array.isArray(list)) list = [];

                lastUpdatesList = list;
                try { saveUpdatesCache(userKey, list); } catch (e9) {}
                try { updateHeadBadge(countUnreadUpdates(list)); } catch (e) {}
                cb && cb(list);
            },
            function (err) {
                console.log('[TranslationSub] fetchUpdatesForce error', err);
                cb && cb([]);
            }
        );
    }

    // ========= ПРОВЕРКА ОБНОВЛЕНИЙ (РАЗОВАЯ, ВСЕ СРАЗУ) =========
    function checkUpdates() {
        // тихо обновляем бейдж и lastUpdatesList, без noty
        fetchUpdates(false);
    }

    // Запустить реальную проверку и показать результат пользователю
    function forceCheckUpdatesUI() {
        try {
            if (window.Lampa && Lampa.Noty) Lampa.Noty.show('Проверяем обновления…');
        } catch (e) {}

        fetchUpdatesForce(true, function (list) {
            if (!Array.isArray(list)) list = [];

            if (!list.length) {
                noty('Новых серий не найдено');
                return;
            }

            // Показать найденные обновления отдельным списком
            if (!window.Lampa || !Lampa.Select) {
                noty('Найдено обновлений: ' + list.length);
                return;
            }

            var items = list.map(function (u) {
                var se = u.season && u.episode ? 'S' + u.season + 'E' + u.episode : '';
                var subtitle = [];
                if (se) subtitle.push(se);
                if (u.translationName) subtitle.push('Озвучка: ' + u.translationName);
                if (u.source) subtitle.push('Балансер: ' + u.source);

                return {
                    title: u.title,
                    subtitle: subtitle.join(' • '),
                    onclick: function () {
                        openTitleCard(u);
                    },
                };
            });

            Lampa.Select.show({
                title: 'Новые серии',
                items: items,
                onSelect: function (a) {
                    a.onclick && a.onclick();
                },
                onBack: function () {
                    if (Lampa.Controller) Lampa.Controller.toggle('content');
                },
            });
        });
    }

    // ========= ФОНОВЫЕ ОПРОСЫ ОТКЛЮЧЕНЫ =========
    // Раньше клиент запускал интервалы (каждую минуту / каждые 12 часов), чтобы проверять подписки.
    // Теперь кеш обновляет сервер (раз в 6 часов), а фронт только читает готовый результат.
    // Поэтому любые client-side polling/intervals убраны.
    function scheduleBackgroundUpdates() {}

    function extendEpisodeMenu(menu, episode, item, source) {
        // Подписка по озвучке теперь делается из окна выбора озвучек,
        // в меню эпизода ничего не добавляем.
    }

// ======= ХРАНИЛИЩЕ ОЗВУЧЕК ДЛЯ ТАЙТЛОВ =======
// remembered живёт только в памяти, максимум 20 минут (чтобы не раздуваться)
var remembered = {};
var REMEMBERED_TTL_MS = 20 * 60 * 1000;

function cleanupRemembered() {
    try {
        var t = nowMs();
        Object.keys(remembered || {}).forEach(function (k) {
            var v = remembered[k];
            if (!v) { try { delete remembered[k]; } catch(e){} return; }
            if (v._ts && (t - v._ts > REMEMBERED_TTL_MS)) {
                try { delete remembered[k]; } catch(e2){}
            }
        });
    } catch (e) {}
}
    // ========= НОРМАЛИЗАЦИЯ И ГРУППИРОВКА ОЗВУЧЕК =========
    function cleanTranslationName(raw) {
        if (!raw) return '';

        var name = String(raw);

        // убираем html-теги
        name = name.replace(/<[^>]+>/g, '');

        // НЕ трогаем [] и ()
        // name = name.replace(/\[[^\]]*]/g, '');
        // name = name.replace(/\([^)]*\)/g, '');

        name = name.replace(/\s+/g, ' ').trim();
        return name;
    }

    var ts_translation_key_cache = Object.create(null);

    function normalizeTranslationKey(name) {
        if (!name) return '';

        var cacheKey = String(name);
        if (ts_translation_key_cache[cacheKey]) return ts_translation_key_cache[cacheKey];

        // Базовая очистка (теги, лишние пробелы) — оставляем [] и () как ты и хотел
        var key = cleanTranslationName(name).toLowerCase();

        // 1) Убираем из круглых скобок только "тип озвучки" (а студии оставляем)
        key = key.replace(/\(([^)]*)\)/g, function (_, inside) {
            var t = inside.replace(/\s+/g, '').toLowerCase();

            if (
                t.includes('многоголос') ||
                t.includes('двухголос') ||
                t.includes('одноголос') ||
                t.includes('проф') ||
                (t.includes('полн') && t.includes('дубляж')) ||
                t.includes('любитель') ||
                t.includes('amateur') ||
                t.includes('voice')
            ) {
                return '';
            }

            return '(' + inside + ')';
        });

        // 2) Оставляем только буквы/цифры
        key = key.replace(/[^a-zа-яё0-9]+/g, '');

        // 3) Табличные правила (легко расширять)
        // ВАЖНО: порядок имеет значение (более специфичное — выше).
        var rules = [
            // HDrezka / HDrezka 18+
            {
                out: function (k) {
                    // поддержим "18" в любом виде
                    if (k.includes('hdrezka') || k.includes('hdrrezka') || k.includes('резка')) {
                        return k.includes('18') ? 'hdrezka18' : 'hdrezka';
                    }
                    return null;
                },
            },

            // LostFilm
            { out: 'lostfilm', match: ['lostfilm', 'лостфильм'] },

            // NewStudio
            { out: 'newstudio', match: ['newstudio', 'ньюстудио', 'newstud'] },

            // Володарский
            { out: 'володарский', match: ['володарский', 'леонидволодарский'] },

            // Яроцкий
            { out: 'яроцкий', match: ['яроцкий', 'яроцкиймихаил'] },

            // Украинский дубляж
            { out: 'украинский', match: ['украинский', 'ukrdub'] },

            // Сербин
            { out: 'сербин', match: ['сербин', 'юрийсербин'] },

            // Jaskier
            { out: 'jaskier', match: ['jaskier', 'яскер', 'яскъер'] },

            // BaibaKo
            { out: 'baibako', match: ['baibako', 'байбако'] },

            // Good People
            { out: 'goodpeople', match: ['goodpeople', 'гудпипл'] },

            // Original / English original
            { out: 'original', match: ['original', 'оригинал', 'оригинальный'] },

            // TVShows
            { out: 'tvshows', match: ['tvshows', 'твшоу'] },

            // ColdFilm
            { out: 'coldfilm', match: ['coldfilm', 'coldflm', 'coldf1lm', 'cildfilm', 'koldfilm', 'колдфильм', 'колдфилм'] },

            // RedHeadSound
            { out: 'redheadsound', match: ['redheadsound', 'rhs'] },

            // Octopus / Ultradox
            { out: 'octopus', match: ['octopus', 'oktopus', 'octop', 'ultradox', 'ультрадокс', 'октопус'] },

            // LakeFilms
            { out: 'lakefilms', match: ['lakefilms', 'lakefilm'] },

            // RuDub
            { out: 'rudub', match: ['rudub', 'рудуб', 'рудаб'] },

            // NewComers
            { out: 'newcomers', match: ['newcomers', 'newcomer', 'newcomersstudio', 'ньюкамерс', 'ньюкомерс'] },

            // Syncmer
            { out: 'syncmer', match: ['syncmer', 'синкмер'] },

            // Кубик в Кубе / Kubik³
            { out: 'kubikvkube', match: ['кубиквкубе', 'kubikvkube', 'kubik3', 'kubikcubed'] },

            // 1WIN Studio
            { out: '1winstudio', match: ['1win', 'onewin', '1winstudio'] },

            // GoLTFilm
            { out: 'goltfilm', match: ['goltfilm', 'goltf1lm', 'голтфильм'] },

            // ЗаКАДРЫ
            { out: 'zakadry', match: ['закадры', 'zakadry', 'zakadr'] },

            // LE-Production
            { out: 'leproduction', match: ['leproduction', 'leprod', 'леproduction'] },

            // FocusStudio
            { out: 'focusstudio', match: ['focusstudio', 'фокусстудио', 'фокусстуди'] },

            // AMS
            {
                out: function (k) {
                    if (k === 'ams' || k.includes('amsstudio')) return 'ams';
                    return null;
                },
            },

            // Пифагор
            { out: 'пифагор', match: ['пифагор', 'pifagor', 'pythagor'] },

            // Postmodern
            { out: 'postmodern', match: ['postmodern'] },

            // DniproFilm
            { out: 'dniprofilm', match: ['dniprofilm', 'днипрофильм', 'днепрофильм'] },
        ];

        for (var i = 0; i < rules.length; i++) {
            var r = rules[i];

            if (typeof r.out === 'function') {
                var v = r.out(key);
                if (v) {
                    key = v;
                    break;
                }
                continue;
            }

            if (Array.isArray(r.match)) {
                var hit = r.match.some(function (m) {
                    return m && key.includes(m);
                });
                if (hit) {
                    key = r.out;
                    break;
                }
            }
        }

        // 4) Общий "дубляж" (без студии) — строго в конце
        if (
            key.startsWith('дубляж') ||
            key.startsWith('дублированный') ||
            key.startsWith('русскийдубляж') ||
            key.startsWith('русскийполныйдубляж')
        ) {
            key = 'дублированный';
        }

        return key;
    }

    // Проверяем, есть ли сейчас подписка на конкретную озвучку
    function checkVoiceSubscriptionState(body, cb) {
        if (!body) {
            cb && cb(null);
            return;
        }

        ensureSubscriptionsCache(function (list) {
            if (!Array.isArray(list) || !list.length) {
                cb && cb(false);
                return;
            }

            var contentId = String(body.contentId || '');
            var src = body.source || '';
            var normName = normalizeTranslationKey(body.translationName || '');

            var found = list.some(function (sub) {
                if (String(sub.contentId) !== contentId) return false;

                var subSrc = sub.source || '';
                var subName = sub.translationName || sub.translation_name || '';
                var subNorm = normalizeTranslationKey(subName);

                return subSrc === src && subNorm === normName;
            });

            cb && cb(found);
        });
    }

function groupTranslations(list) {
        var map = {};
        var uniq = {};

        (list || []).forEach(function (tr) {
            if (!tr) return;

            var src = tr.source || '';
            var id = tr.id != null ? String(tr.id) : '';

            var uniqKey = src + '|' + id;
            if (id && uniq[uniqKey]) return;
            if (id) uniq[uniqKey] = true;

            var cleanName = cleanTranslationName(
                tr.name || tr.translation_name || tr.voice || ''
            );
            if (!cleanName) return;

            var key = normalizeTranslationKey(cleanName);
            if (!key) key = '__other__' + cleanName.toLowerCase();

            if (!map[key]) {
                map[key] = {
                    key: key,
                    displayName: cleanName,
                    variants: [],
                };
            }

            map[key].variants.push({
                id: id,
                name: cleanName,
                source: src,
                path: tr.path || '',
            });
        });

        return map;
    }

    // ========= ЗАПОМИНАНИЕ ОЗВУЧЕК ОТ ОНЛАЙНОВ =========
    function rememberTranslations(item, source, translations) {
        var contentId = buildContentId(item);
        if (!contentId) {
            console.log(
                '[TranslationSub] rememberTranslations: no contentId for item',
                item
            );
            return;
        }

        var flat = [];
        (translations || []).forEach(function (tr) {
            if (!tr) return;

            flat.push({
                id:
                    tr.id != null
                        ? tr.id
                        : tr.translation_id != null
                        ? tr.translation_id
                        : tr.voice_id != null
                        ? tr.voice_id
                        : tr.uid != null
                        ? tr.uid
                        : '',
                name:
                    tr.name ||
                    tr.title ||
                    tr.translation_name ||
                    tr.translation ||
                    tr.voice ||
                    '',
                source: source || '',
            });
        });

        remembered[contentId] = {
            item: item,
            source: source,
            translations: flat,
        };

        // TTL
        remembered[contentId]._ts = nowMs();
        cleanupRemembered();

        console.log(
            '[TranslationSub] rememberTranslations',
            contentId,
            remembered[contentId]
        );
    }

    // ========= ПОЛУЧЕНИЕ ОЗВУЧЕК С СЕРВЕРА =========
    function _fetchTranslationsFromServer(item, callback) {
        var contentId = buildContentId(item);
        if (!contentId) {
            noty(
                'Не удалось определить ID тайтла (contentId)',
                item.title || item.name || ''
            );
            console.log(
                '[TranslationSub] fetchTranslationsFromServer: no contentId for item',
                item
            );
            callback && callback(null);
            return;
        }

        var movie = item.movie || item || {};

        var title =
            movie.title || movie.name || item.title || item.name || '';
        var originalTitle =
            movie.original_title ||
            movie.original_name ||
            item.original_title ||
            item.original_name ||
            '';

        var kpId =
            movie.kp_id ||
            movie.kinopoisk_id ||
            item.kp_id ||
            item.kinopoisk_id ||
            '';

        var imdbId = getImdbIdFromItem(item || movie);
        var tmdbId = movie.id || item.id || '';

        var year =
            movie.year ||
            (movie.first_air_date &&
                movie.first_air_date.slice(0, 4)) ||
            (movie.release_date && movie.release_date.slice(0, 4)) ||
            item.year ||
            '';

        var isSerial = !!(
            movie.number_of_seasons ||
            movie.first_air_date ||
            movie.seasons ||
            movie.type === 'tv' ||
            item.is_serial
        );

        // берём последний просмотренный сезон (если есть)
        var watch = detectLastWatched(movie);
        var season = (watch && watch.season) ? watch.season : null;

        var params = {
            contentId: contentId,
            title: title,
            originalTitle: originalTitle,
            kpId: kpId,
            imdbId: imdbId,
            tmdbId: tmdbId,
            year: year,
            isSerial: isSerial ? '1' : '0',
            season: season || 1,
        };

        var qs = toQS(params);

        var url = HOST + API.variants + '?' + qs;

        console.log('[TranslationSub] fetchTranslationsFromServer url =', url);

        request(
            {
                url: url,
                method: 'GET',
            },
            function (res) {
                console.log(
                    '[TranslationSub] variants raw response:',
                    res
                );

                var info = {
                    item: item,
                    source: null,
                    translations: [],
                };

                if (Array.isArray(res.items)) {
                    res.items.forEach(function (block) {
                        var src = block.source || '';
                        var path = block.path || '';

                        if (!Array.isArray(block.translations)) return;

                        block.translations.forEach(function (tr) {
                            if (!tr) return;

                            info.translations.push({
                                id: tr.id,
                                name: tr.name,
                                source: src,
                                path: path,
                            });
                        });
                    });
                }

                if (!info.translations.length) {
                    noty('Не удалось найти озвучки', title);
                    callback && callback(null);
                    return;
                }

                remembered[contentId] = info;

                // TTL
                remembered[contentId]._ts = nowMs();
                cleanupRemembered();

                console.log(
                    '[TranslationSub] fetched translations from server',
                    contentId,
                    info
                );

                callback && callback(info);
            },
            function (err) {
                console.log(
                    '[TranslationSub] fetchTranslationsFromServer error',
                    err
                );
                noty(
                    'Ошибка запроса списка озвучек',
                    item.title || item.name || ''
                , 'error');
                callback && callback(null);
            }
        );
    }


// Обёртка с кэшем вариантов (localStorage)
// Используется из openForItem(): fetchTranslationsFromServer(item, cb, force)
function fetchTranslationsFromServer(item, cb, force) {
    var userKey = getUserKey();
    var contentId = buildContentId(item);

    // если item "тонкий" и нет id — попробуем взять из текущей активности
    if (!contentId) {
        try {
            var active = window.Lampa && Lampa.Activity && Lampa.Activity.active ? Lampa.Activity.active() : null;
            contentId = getContentIdFromActive(active);
        } catch (e) {}
    }

    // сезон — из последнего просмотренного, иначе 1
    var season = 1;
    try {
        var movie = item && (item.movie || item.card || item.data || item) ? (item.movie || item.card || item.data || item) : item;
        var watch = detectLastWatched(movie);
        season = (watch && watch.season) ? watch.season : 1;
    } catch (e2) {}

    // Источник для ключа: у нас на /variants сейчас агрегированный ответ, поэтому фиксируем 'all'
    var source = 'all';

    if (contentId) {
        var cacheKey = buildVariantsCacheKey(userKey, contentId, season, source);

        if (!force) {
            var cached = loadVariantsCache(cacheKey);
            if (cached) {
                cb && cb(cached, true);
                return;
            }
        }

        _fetchTranslationsFromServer(item, function (data) {
            saveVariantsCache(cacheKey, data);
            cb && cb(data, false);
        });
        return;
    }

    // если contentId так и не определили — без кэша
    _fetchTranslationsFromServer(item, function (data) {
        cb && cb(data, false);
    });
}


    // ========= ПЕРВЫЙ ШАГ: ВЫБОР ОЗВУЧКИ (БЕЗ ДУБЛЕЙ) =========
    function markSubscribedInCurrentSelect(subscribedMap) {
        if (typeof $ !== 'function') return;
        subscribedMap = subscribedMap || {};

        try {
            $('.selectbox .selectbox-item').each(function () {
                var $item = $(this);
                var $title = $item.find('.selectbox-item__title');
                var name = ($title.text() || '').trim();
                if (!name) return;

                var key = normalizeTranslationKey(name);
                if (subscribedMap[key]) $item.addClass('translation-sub-subscribed');
                else $item.removeClass('translation-sub-subscribed');
            });
        } catch (e) {
            console.log('[TranslationSub] markSubscribedInCurrentSelect error', e);
        }
    }

    function showTranslationsSelect(info, item, subscribedMap) {
        if (
            !info ||
            !Array.isArray(info.translations) ||
            !info.translations.length
        ) {
            noty('Не удалось найти озвучки');
            return;
        }

        injectTranslationSelectStyles();

        var groupsMap = groupTranslations(info.translations);
        var groups = Object.keys(groupsMap).map(function (k) {
            return groupsMap[k];
        });

        groups.sort(function (a, b) {
            var sa = subscribedMap && subscribedMap[a.key];
            var sb = subscribedMap && subscribedMap[b.key];

            // сначала все подписанные
            if (sa && !sb) return -1;
            if (!sa && sb) return 1;

            // внутри своей группы сортируем по названию
            return a.displayName.localeCompare(b.displayName);
        });

        if (!window.Lampa || !Lampa.Select) {
            console.log('[TranslationSub] Lampa.Select not found');
            return;
        }

        var items = groups.map(function (g) {
            var srcSet = {};
            g.variants.forEach(function (v) {
                if (v.source) srcSet[v.source] = true;
            });

            var srcList = Object.keys(srcSet);

            return {
                title: g.displayName,
                subtitle: srcList.join(', '),
                // g.key нам нужен позже, поэтому сохраним его внутрь объекта
                _tsKey: g.key,
                onclick: function () {
                    // После подписки/отписки обновляем кэш (/list) и
                    // обновляем отметки прямо в текущем списке (без переоткрытия),
                    // чтобы при отписке не "вылезал" список заново.
                    toggleVoiceSubscription(g, item, function () {
                        try {
                            var contentId = buildContentId(item);
                            fetchSubscriptionsForContent(contentId, function (subs) {
                                var m = {};
                                (subs || []).forEach(function (s) {
                                    var k = normalizeTranslationKey(
                                        s.translationName || s.voice || s.name || ''
                                    );
                                    if (k) m[k] = true;
                                });
                                markSubscribedInCurrentSelect(m);
                            });
                        } catch (e) {}
                    });
                },
            };
        });

        Lampa.Select.show({
            title: 'Озвучка',
            items: items,
            onSelect: function (a) {
                a.onclick && a.onclick();
            },
            onBack: function () {
                if (Lampa.Controller) Lampa.Controller.toggle('content');
            },
        });

        // после отрисовки списка помечаем подписанные рамкой
        setTimeout(function () {
            markSubscribedInCurrentSelect(subscribedMap);
        }, 50);
    }

    function openForItem(item) {
        // сохраняем full, чтобы потом syncProgressForItem знал, что за тайтл
        window.__last_full_data = item;

        console.log('[TranslationSub] openForItem item =', item);

        var active = null;
        try { active = window.Lampa && Lampa.Activity && Lampa.Activity.active ? Lampa.Activity.active() : null; } catch(e){}
        var contentId = buildContentId(item);
        if (!contentId) contentId = getContentIdFromActive(active);

        if (!contentId) {
            console.log('[TranslationSub] openForItem: no contentId', item);
            return;
        }

        // если item пустой, соберём минимальный stub, чтобы variants endpoint получил хотя бы id
        if (!item || typeof item !== 'object' || !Object.keys(item).length) {
            item = { id: contentId };
        } else if (!buildContentId(item)) {
            try { item.id = item.id || contentId; } catch(e){}
        }

        // помощник: когда уже есть info по озвучкам
        function proceed(info) {
            if (!info || !info.translations || !info.translations.length) return;

            // грузим подписки по этому тайтлу
            fetchSubscriptionsForContent(contentId, function (subs) {
                var subscribedMap = {};
                (subs || []).forEach(function (s) {
                    var key = normalizeTranslationKey(
                        s.translationName || s.voice || s.name || ''
                    );
                    if (key) subscribedMap[key] = true;
                });

                showTranslationsSelect(info, item, subscribedMap);
            });
        }

        var info = contentId ? remembered[contentId] : null;
        if (info && info.translations && info.translations.length) {
            proceed(info);
            return;
        }

        fetchTranslationsFromServer(item, function (loadedInfo) {
            if (
                !loadedInfo ||
                !loadedInfo.translations ||
                !loadedInfo.translations.length
            )
                return;

            proceed(loadedInfo);
        });
    }

    // ========= ИНИЦИАЛИЗАЦИЯ ПЛАГИНА =========
    function openHeadMenu() {
        if (!window.Lampa || !Lampa.Select) return;

        // просто берём lastUpdatesList (который обновляется в фоне)
        var updates = lastUpdatesList || [];

        var items = [
            {
                title: 'Мои подписки',
                subtitle: 'Список тайтлов',
                onclick: function () {
                    openSubscriptionsList();
                },
            },
            {
                title: 'Проверить обновления',
                subtitle: 'Показать новые серии',
                onclick: function () {
                    if (TranslationSub && TranslationSub.forceCheckUpdatesUI) {
                        TranslationSub.forceCheckUpdatesUI();
                    } else if (TranslationSub && TranslationSub.checkUpdates) {
                        // fallback (если вдруг старый объект)
                        TranslationSub.checkUpdates();
                    }
                },
            },
        ];

        if (updates.length) {
            updates.forEach(function (u) {
                var se =
                    u.season && u.episode
                        ? 'S' + u.season + 'E' + u.episode
                        : '';

                var subtitle = [];
                if (se) subtitle.push(se);
                if (u.translationName)
                    subtitle.push('Озвучка: ' + u.translationName);
                if (u.source) subtitle.push('Балансер: ' + u.source);

                items.push({
                    title: u.title,
                    subtitle: subtitle.join(' • '),
                    onclick: function () {
                        openTitleCard(u);
                    },
                });
            });
        }

        Lampa.Select.show({
            title: 'Озвучка',
            items: items,
            onSelect: function (a) {
                a.onclick && a.onclick();
            },
            onBack: function () {
                if (Lampa.Controller) Lampa.Controller.toggle('head');
            },
        });
    }

    function fetchSubscriptionsForContent(contentId, cb) {
        if (!contentId) {
            cb && cb([]);
            return;
        }

        ensureSubscriptionsCache(function (list) {
            list = Array.isArray(list) ? list : [];

            var filtered = list.filter(function (s) {
                return String(s.contentId) === String(contentId);
            });

            cb && cb(filtered);
        });
    }

    function openSubscriptionsList() {
        ensureSubscriptionsCache(function (list) {
            list = Array.isArray(list) ? list : [];

            if (!list.length) {
                noty('У вас пока нет подписок', 'Мои подписки');
                return;
            }

            if (!window.Lampa || !Lampa.Select) {
                console.log('[TranslationSub] Lampa.Select not found');
                return;
            }

            var items = list.map(function (s) {
                var title = s.title || 'Без названия';
                var sub = s.translationName || '';

                if ((s.lastSeason || s.season) && (s.lastEpisode || s.episode)) {
                    var season = s.lastSeason || s.season;
                    var episode = s.lastEpisode || s.episode;

                    sub += (sub ? ' • ' : '') + ('S' + season + 'E' + episode);
                }

                return {
                    title: title,
                    subtitle: sub || 'Подписка на озвучку',
                    contentId: s.contentId,
                    source: s.source,
                    translationName: s.translationName,
                    onclick: function () {
                        openTitleCard(s);
                    },
                };
            });

            Lampa.Select.show({
                title: 'Мои подписки',
                items: items,
                onSelect: function (a) {
                    a.onclick && a.onclick();
                },
                onBack: function () {
                    if (Lampa.Controller) Lampa.Controller.toggle('head');
                },
            });
        });
    }

    function openTitleCard(sub) {
        if (!sub || !sub.contentId) {
            console.log(
                '[TranslationSub] openTitleCard: нет contentId',
                sub
            );
            return;
        }

        var id = String(sub.contentId);
        console.log('[TranslationSub] открываем карточку:', id);

        Lampa.Activity.push({
            url: 'tv/' + id,
            component: 'full',
            id: id,
            method: 'tv',
            source: 'tmdb',
            card: null,
            page: 1,
        });
    }

    var TranslationSub = {
        // extendEpisodeMenu: extendEpisodeMenu, // больше не используем
        checkUpdates: checkUpdates,
        forceCheckUpdatesUI: forceCheckUpdatesUI,
        openForItem: openForItem,
        openHeadMenu: openHeadMenu,
        rememberTranslations: rememberTranslations, // опционально, но удобно
    };

    window.TranslationSub = TranslationSub;

    // ========= ХУКИ Lampa =========
    try {
        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') {
                    setTimeout(function () {
                        injectHeadButton();
                    }, 500);


                    // быстрый бейдж из localStorage (без сети)
                    setTimeout(function () {
                        try {
                            var uk = getUserKey();
                            var cached = loadUpdatesCache(uk);
                            if (cached && Array.isArray(cached)) {
                                lastUpdatesList = cached;
                                updateHeadBadge(countUnreadUpdates(cached));
                            }
                        } catch (e1) {}
                    }, 900);
                    // разовая проверка всех обновлений (как раньше)
                    setTimeout(function () {
                        if (
                            window.TranslationSub &&
                            TranslationSub.checkUpdates
                        ) {
                            TranslationSub.checkUpdates();
                        }
                    }, 5000);

                    // подогреем кэш подписок (чтобы UI быстрее открывался и меньше /list)
                    setTimeout(function () {
                        refreshSubscriptionsCache();
                    }, 6000);

                    // фоновые интервалы на клиенте отключены — кеш обновляет сервер
                }
            });
        }
    } catch (e) {
        console.log('[TranslationSub] init error', e);
    }

    // ========= КНОПКА В КАРТОЧКЕ FULL =========
    // Вставляем кнопку строго через событие full/complite, чтобы она корректно работала с пультом.
    // renderEl может быть jQuery-объектом (activity.render()), чтобы вставлять кнопку в правильное место карточки
    function injectFullButton(data, renderEl, opts) {
        opts = opts || {};
        var debug = !!opts.debug;

        if (typeof $ !== 'function') return;

        // Важное: кнопку удаляем только в пределах текущей карточки
        var scope = (renderEl && renderEl.find) ? renderEl : $(document);

        // Если не сериал — кнопку не показываем
        var serial = null;
        try { serial = isSerialItem(data, null); } catch (e) { serial = null; }

        if (serial === false) {
            scope.find('.translation-sub-btn').remove();
            if (debug) console.log('[TranslationSub] full btn: not serial -> removed');
            return;
        }

        // Если мы не смогли определить тип (serial === null) — НЕ скрываем кнопку молча.
        // Лучше показать и отладить, чем «пропасть».
        if (serial === null && debug) {
            console.log('[TranslationSub] full btn: cannot detect media type, data=', data);
        }

        // Уже есть наша кнопка в этой карточке – второй раз не вставляем
        if (scope.find('.translation-sub-btn').length) {
            if (debug) console.log('[TranslationSub] full btn: already exists in scope');
            return;
        }

        // Кандидаты на место вставки (важно: вставляем в ГОРИЗОНТАЛЬНЫЙ ряд кнопок,
        // а не в вертикальные списки/меню вроде «Источник»)

        // 1) контейнер кнопок (горизонтальный ряд)
        var row = scope.find('.full-start-new__buttons').first();
        if (!row.length) row = scope.find('.full-start__buttons').first();
        if (!row.length) row = scope.find('.full-start').first(); // самый общий контейнер в full

        // 2) якорь: последняя кнопка в горизонтальном ряду
        var anchor = null;
        try {
            if (row && row.length) {
                anchor = row.find('.full-start__button, .full-start-new__button, .view--online').last();
            }
        } catch (e) {
            anchor = null;
        }

        // если в row нет кнопок — пробуем найти в scope (но всё равно вставим В row)
        if (!anchor || !anchor.length) {
            anchor = scope.find('.full-start__button, .full-start-new__button, .view--online').last();
        }

        if (debug) {
            console.log('[TranslationSub] full btn: scope=', !!(renderEl && renderEl.find));
            console.log('[TranslationSub] full btn: anchor=', anchor.length, 'row=', row.length);
        }

        if (!anchor.length && !row.length) {
            if (debug) console.log('[TranslationSub] full btn: no place to insert');
            return;
        }

        var btn = $(
            '<div class="full-start__button selector translation-sub-btn" data-subtitle="Подписка на озвучку">' +
                '<svg viewBox="0 0 25 30" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7368 27 9.27804 25.6961 9.03542 24H6.01892Z" fill="currentColor"></path>' +
                '<path d="M3.81972 14.5957V10.2679C3.81972 5.41336 7.71811 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.216 22.9392 23.5 20.9092 23.5H4.09078C2.06084 23.5 0.792282 21.216 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z" stroke="currentColor" stroke-width="2.6"></path>' +
                '</svg>' +
                '<span>Озвучка</span>' +
            '</div>'
        );

        btn.on('hover:enter', function () {
            if (debug) console.log('[TranslationSub] full btn: hover:enter');
            if (window.TranslationSub && TranslationSub.openForItem) {
                TranslationSub.openForItem(data || {});
            } else {
                // используем Lampa.Noty напрямую — она всегда есть, если Lampa загружена
                try {
                    if (window.Lampa && Lampa.Noty) Lampa.Noty.show('Модуль подписки не инициализирован');
                } catch (e) {}
            }
        });

        // Вставка: строго в карточку, чтобы фокус/навигация работали стабильно
        // Вставляем именно в горизонтальный ряд (row).
        // Если anchor найден, но он не внутри row — просто append в row.
        if (row && row.length) {
            if (anchor && anchor.length && anchor.closest(row[0]).length) anchor.after(btn);
            else row.append(btn);
        } else {
            // последний фолбэк: куда нашли anchor
            if (anchor && anchor.length) anchor.after(btn);
        }

        if (debug) console.log('[TranslationSub] full btn: inserted');
    }

    // ========= КНОПКА В ВЕРХНЕМ ХЕДЕРЕ =========
    function injectHeadButton() {
        if (typeof $ !== 'function') return;

        var row = $('.head__actions').first();
        if (!row.length) return;

        if (row.find('.translation-sub-head-btn').length) return;

        var btn = $(
            '<div class="head__action selector translation-sub-head-btn" data-title="Озвучка">' +
                '<svg viewBox="0 0 25 30" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7368 27 9.27804 25.6961 9.03542 24H6.01892Z" fill="currentColor"></path>' +
                '<path d="M3.81972 14.5957V10.2679C3.81972 5.41336 7.71811 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.216 22.9392 23.5 20.9092 23.5H4.09078C2.06084 23.5 0.792282 21.216 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z" stroke="currentColor" stroke-width="2.6"></path>' +
                '</svg>' +
                '</div>'
        );

        btn.on('hover:enter', function () {
            TranslationSub && TranslationSub.openHeadMenu && TranslationSub.openHeadMenu();
        });

        row.append(btn);
    }
	
	
	try {
    if (window.Lampa && Lampa.Listener) {
        var lastInjectTime = 0;

        // контекст текущей карточки full (доступен раньше, чем active.card/data)
        var currentFullActive = null;
        var currentFullIsSerial = null;
        var currentFullId = null;

        function updateFullContext(obj) {
            try {
                if (!obj) return;

                currentFullActive = obj;
                currentFullId =
                    getContentIdFromActive(obj) ||
                    (obj.id != null ? String(obj.id) : currentFullId);

                if (obj.method === 'tv') currentFullIsSerial = true;
                else if (obj.method === 'movie') currentFullIsSerial = false;
                else if (typeof obj.url === 'string') {
                    var u = String(obj.url).replace(/^\//, '').split('?')[0];
                    if (u.indexOf('tv/') === 0 || u.indexOf('/tv/') !== -1) currentFullIsSerial = true;
                    if (u.indexOf('movie/') === 0 || u.indexOf('/movie/') !== -1) currentFullIsSerial = false;
                }
            } catch (e) {}
        }

        // Кнопка в full: используем штатный паттерн Lampa для корректной работы с пультом
        // selector + hover:enter, без setInterval/setTimeout-поллинга.
        Lampa.Listener.follow('full', function (e) {
            if (!e || e.type !== 'complite') return;

            try {
                // Обновим контекст (для прогресса/кэшей)
                if (e.object) updateFullContext(e.object);
                else if (Lampa.Activity && Lampa.Activity.active) updateFullContext(Lampa.Activity.active());
            } catch (err) {}

            try {
                var movie = (e.data && (e.data.movie || e.data.card || e.data)) || {};
                if (!isSerialItem(movie, null)) {
                    $('.translation-sub-btn').remove();
                    return;
                }

                var render = null;
                try {
                    render = e.object && e.object.activity && e.object.activity.render ? e.object.activity.render() : null;
                } catch (err2) {}

                // Падение в общий DOM, если render не доступен
                injectFullButton(movie, render);
            } catch (err3) {
                console.log('[TranslationSub] full button inject error', err3);
            }
        });
    }
} catch (err) {
    console.log('[TranslationSub] init error', err);
}

    // ========= ПЕРЕХВАТ ОНЛАЙНОВ (для rememberTranslations) =========
    try {
        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('online', function (e) {
if (!e || !e.data) return;

                var data = e.data;
if (Array.isArray(data.videos)) {
                    data.videos.forEach(function (v) {
                        if (
                            Array.isArray(v.translations) &&
                            v.translations.length > 0
                        ) {
                            var item = data.movie || data;
                            var source = v.source || v.name || '';

                            console.log(
                                '[TranslationSub] remember REAL translations:',
                                source,
                                v.translations
                            );

                            TranslationSub.rememberTranslations(
                                item,
                                source,
                                v.translations
                            );
                        }
                    });
                }
            });
        }
    } catch (err) {
        console.log('[TranslationSub] online listener error', err);
    }

    // ========= ХУК НА ТАЙМЛАЙН ДЛЯ ПРОГРЕССА =========
    try {
        if (window.Lampa && Lampa.Timeline && Lampa.Timeline.listener) {
            Lampa.Timeline.listener.follow('update', function (e) {
                if (!e || !e.data || !e.data.road) return;

                var percent = e.data.road.percent || 0;

                // когда серия почти досмотрена – обновляем LastSeason/LastEpisode
                if (percent >= 80) {
                    syncProgressForItem();
                }
            });
        }
    } catch (err) {
        console.log('[TranslationSub] timeline hook error', err);
    }

    console.log(
        '[TranslationSub] plugin loaded, HOST =',
        HOST,
        'UID =',
        getUid(),
        'userKey =',
        getUserKey()
    );

// ===== Safety block removed (handled above) =====


})();
