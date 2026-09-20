# LORD.TV

Онлайн-балансер **LORD.TV** (панель `lordsilver.biz`) для Lampac NextGen.

Каталог сериалов читается из публичного API. Потоки требуют **embed-token** и **Origin домена, на который токен выдан**. Рабочий embed-token уже задан в модуле по умолчанию и при необходимости может быть переопределён через `init.conf`.

## Почему был 403

`embed_token` привязан к origin партнёра. Запрос с `Origin: https://lordsilver.biz` даёт:

`Domain lordsilver.biz is not allowed for this token`

По умолчанию модуль уже настроен на partner-origin doramaru и не требует добавлять `embed_token` в `init.conf`.

Если токен сменится или будет выписан на другой сайт, значения можно переопределить:

```json
"LordTV": {
  "embed_token": "<новый query-token из iframe>",
  "player_origin": "https://partner.example",
  "referer": "https://partner.example/"
}
```

## Настройки

Настройки модуля задаются как дефолты через `ModuleInvoke.Init` и могут быть переопределены в `init.conf`, как у остальных online-модулей.

По умолчанию `streamproxy=true`, потому что прокси Lampac передаёт нужные `Origin/Referer` в HLS-запросы и сегменты. Теперь это не принудительный режим: при необходимости его можно отключить.

```json
"LordTV": {
  "streamproxy": false,
  "httptimeout": 10,
  "httpversion": 1
}
```

При `streamproxy=false` модуль отдаёт прямые ссылки и передаёт stream headers плееру. Для web-клиента прямой HLS может зависеть от CORS/hotlink-защиты CDN.

Также доступны стандартные транспортные настройки `BaseSettings`, например `useproxy`, `useproxystream`, `proxy`, `geostreamproxy`, `rchstreamproxy`, `headers` и `headers_stream`.

Если нужно полностью задать собственные заголовки потока:

```json
"LordTV": {
  "headers_stream": {
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://partner.example",
    "Referer": "https://partner.example/"
  }
}
```

Если `headers_stream` не задан, модуль формирует стандартные stream headers из текущих `player_origin` и `referer`. Поэтому смена partner-origin больше не требует одновременно править жёстко заданный словарь заголовков.

## Маршруты

| Маршрут | Назначение |
|---|---|
| `/lite/lordtv` | сезоны / серии / checksearch |
| `/lite/lordtv/video` | резолв потока |
