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

## Маршруты

| Маршрут | Назначение |
|---|---|
| `/lite/lordtv` | сезоны / серии / checksearch |
| `/lite/lordtv/video` | резолв потока |
