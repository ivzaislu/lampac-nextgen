# FanCDN

Онлайн-источник **FanCDN / FanSeries**. Домен по умолчанию: **`https://1fanserials.org`**, **`streamproxy: true`**. В шаблоне модуль по умолчанию **выключен** (`enable = false`) и включается через `init.conf`.

## Интерфейс

**`IModuleLoaded`**, **`IModuleOnline`**.

## Условие (`Invoke`)

Источник добавляется при **`args.kinopoisk_id > 0`** и **`args.serial == -1 || args.serial == 0`**. Сериалы (`args.serial == 1`) пока не поддерживаются.

Для работы нужны включённый Playwright и непустой **`cookie`** FanSeries. Cookie передаются в браузерную сессию без удаления `PHPSESSID`/`cf_clearance`.

## Текущий flow

1. Загружается каталог FanSeries и ищется карточка `literal__item` по названию/original title и, если год присутствует в карточке, по году.
2. Загружается страница найденного фильма с пользовательской cookie.
3. Из страницы извлекаются `window.cdnData[...]` и iframe-плееры.
4. Для поддерживаемых плееров извлекается поток из `window.playerData.config.video` / `video_new`; для `lomont.site` также поддерживается `data-config.hls`; затем используется безопасный fallback-поиск `.m3u8`/`.mp4`.
5. Поток и субтитры отдаются через `HostStreamProxy` с `Origin`/`Referer` соответствующего плеера.

Поддерживаемые player-hosts на текущем экспериментальном пути: `cdnlbox.club`, `ylitron.pro`, `lomont.site`, `gencit.info`, `ortified.ws`, `vak345.com`, `interkh.com`, `zombie-film.com`.

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

Парсер переведён со старых `msearch.php` / `film.php` на текущую HTML/player-схему. Требуется runtime-проверка с действующей FanSeries-cookie, потому что доступность сайта и конкретных плееров зависит от сети, авторизации и текущего зеркала.
