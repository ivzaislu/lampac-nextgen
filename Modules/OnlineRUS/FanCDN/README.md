# FanCDN

Онлайн-источник **FanCDN / FanSeries**. Домен по умолчанию: **`https://1fanserials.org`**, **`streamproxy: true`**. В шаблоне модуль по умолчанию **выключен** (`enable = false`) и включается через `init.conf`.

## Интерфейс

**`IModuleLoaded`**, **`IModuleOnline`**.

## Условие (`Invoke`)

Источник добавляется при **`args.kinopoisk_id > 0`** и **`args.serial == -1 || args.serial == 0`**. Сериалы (`args.serial == 1`) пока не подключены к маршруту `lite/fancdn`.

Для работы нужны включённый Playwright и непустой **`cookie`** авторизованной FanSeries-сессии. Cookie передаются в браузерную сессию без удаления `PHPSESSID`/`cf_clearance`.

## Текущий flow фильмов

Flow подтверждён сохранённой авторизованной страницей фильма и HAR от `1fanserials.org`.

1. Поиск выполняется через **`/engine/ajax/msearch.php?q=...`**. Текущий JavaScript FanSeries использует этот же endpoint и ожидает JSON с `title`, `original_title`, `year`, `url`.
2. Загружается найденная страница фильма с пользовательской cookie.
3. Из iframe извлекаются **`/movies/{kp}?key={token}`**, `kp` и свежий `key`.
4. Выполняется **`/film.php?kp={kp}&key={token}`** с `Referer: /movies/{kp}?key=...`.
5. `film.php` возвращает JSON-массив озвучек с полями `title` и `file`; `file` указывает на `https://cdn.fancdn.net/movies/.../*.m3u8`.
6. Поток отдаётся через `HostStreamProxy` с `Referer: https://1fanserials.org/` и `Origin: https://1fanserials.org`. FanCDN самостоятельно редиректит master playlist на рабочий `*.cdn.fancdn.net` узел.

Для `key` используется отдельный cache namespace `fancdn:v3`; время кэширования поиска уменьшено до одного часа, чтобы не держать старый player-token слишком долго.

## Что подтверждено для сериалов

Авторизованная страница эпизода содержит `window.cdnData[...]`. Большинство вариантов озвучки уже содержат локальный player URL вида:

```text
/player/?file=https://cdn.fancdn.net/tvseries/.../hls.m3u8&...
```

В HAR подтверждён запрос такого HLS и редирект `cdn.fancdn.net` на `*.cdn.fancdn.net`. Отдельный вариант «Субтитры» на проверенной странице использовал `ylitron.pro`.

Эта схема пока **не подключена** к `lite/fancdn`, потому что текущий контроллер и шаблон FanCDN рассчитаны на фильмы (`MovieTpl`).

## Конфигурация

Секция в `init.conf`: **`FanCDN`** (`OnlinesSettings`).

Минимально для проверки:

```json
"FanCDN": {
  "enable": true,
  "cookie": "<cookie из авторизованной сессии FanSeries>"
}
```

По умолчанию: **`displayindex = 520`**, **`imitationHuman = true`**.

## Подпись качества

**`OnlineApiQuality`**: при **`e.balanser == "fancdn"`** → **` ~ 1080p`**.

## HTTP

| Маршрут | Назначение |
|---------|------------|
| **`lite/fancdn`** | Основная выдача фильмов. |

## Статус

Film-flow приведён к фактической схеме сайта на основании авторизованного HTML и HAR. Сетевой контракт `film.php -> cdn.fancdn.net -> HLS` подтверждён браузерным воспроизведением. Компиляция и выполнение самого модуля Lampac всё ещё требуют отдельной runtime-проверки в окружении с .NET/Playwright и действующей cookie.
