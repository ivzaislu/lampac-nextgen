# FanCDN

Онлайн-источник **FanCDN / FanSeries**. Домен по умолчанию: **`https://1fanserials.org`**, **`streamproxy: true`**. В шаблоне модуль по умолчанию **выключен** (`enable = false`) и включается через `init.conf`.

## Интерфейс

**`IModuleLoaded`**, **`IModuleOnline`**.

## Условие (`Invoke`)

Источник добавляется при **`args.kinopoisk_id > 0`** для фильмов и сериалов.

Для работы нужны включённый Playwright и непустой **`cookie`** авторизованной FanSeries-сессии. Для проверенной пользовательской сессии оказалось достаточно `dle_user_id` и `dle_password`; модуль при этом не фильтрует другие cookie, если они указаны в конфигурации.

## Flow фильмов

Flow подтверждён сохранённой авторизованной страницей фильма, HAR и реальным воспроизведением через Lampac.

1. Поиск выполняется через **`/engine/ajax/msearch.php?q=...`**.
2. Загружается найденная страница фильма с пользовательской cookie.
3. Из iframe извлекаются **`/movies/{kp}?key={token}`**, `kp` и свежий `key`.
4. Выполняется **`/film.php?kp={kp}&key={token}`** с `Referer: /movies/{kp}?key=...`.
5. `film.php` возвращает JSON-массив озвучек с `title` и `file`.
6. `file` разрешается только для `cdn.fancdn.net` / `*.cdn.fancdn.net` и отдаётся через `HostStreamProxy` с `Referer: https://1fanserials.org/` и `Origin: https://1fanserials.org`.

Для movie-token используется cache namespace `fancdn:v3`; поиск кэшируется на один час.

## Flow сериалов

Сериал-flow добавлен на основании авторизованной страницы эпизода и HAR.

1. Поиск сериала выполняется тем же **`msearch.php`** и возвращает страницу сериала.
2. Для выбранного сезона используется URL вида **`/{slug}/{season}-season.html`**.
3. Из страницы сезона извлекаются ссылки **`/{season}-season/{episode}-episode.html`**.
4. Каждая страница эпизода разбирает **`window.cdnData[...]`**.
5. Локальный player URL вида

```text
/player/?file=https://cdn.fancdn.net/tvseries/.../hls.m3u8&...
```

превращается напрямую в HLS без загрузки внутреннего `/player/`.
6. По озвучкам строится `VoiceTpl`, по сериям — `EpisodeTpl`; HLS идёт через `HostStreamProxy` с теми же `Origin`/`Referer`, которые подтверждены HAR.

На проверенной странице «Джентльменов» 9 из 10 вариантов были прямыми `cdn.fancdn.net/tvseries/...`; отдельный вариант «Субтитры» использовал внешний `ylitron.pro`. В текущем serial-flow поддерживаются только прямые FanCDN HLS, поэтому внешний `ylitron.pro` пока пропускается.

Если запрос приходит с `s > 0`, сразу строится выбранный сезон. Если передан `serial=1` и `s <= 0`, модуль пытается извлечь список сезонов из страницы сериала и отдать `SeasonTpl`.

Serial cache namespace: **`fancdn:v4`**.

## Конфигурация

Секция в `init.conf`: **`FanCDN`** (`OnlinesSettings`).

Минимально:

```json
"FanCDN": {
  "enable": true,
  "cookie": "dle_user_id=<value>; dle_password=<value>"
}
```

Не публикуйте значения cookie в GitHub.

По умолчанию: **`displayindex = 520`**, **`imitationHuman = true`**.

## Подпись качества

**`OnlineApiQuality`**: при **`e.balanser == "fancdn"`** → **` ~ 1080p`**.

## HTTP

| Маршрут | Назначение |
|---------|------------|
| **`lite/fancdn`** | Фильмы, сезоны, серии и переключение озвучек. |

Основные serial-параметры: `s` — номер сезона, `voice` — выбранная озвучка, `serial=1` — явный режим сериала.

## Статус

Film-flow подтверждён реальным воспроизведением в Lampac.

Serial-flow реализован по фактическому `window.cdnData` и HAR с прямыми `cdn.fancdn.net/tvseries` HLS, но страницы списка сезонов/эпизодов ещё требуют runtime-проверки на реальном сериале. Внешний `ylitron.pro` в serial-flow пока не поддерживается.
