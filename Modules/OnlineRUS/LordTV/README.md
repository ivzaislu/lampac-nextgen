# LORD.TV

Онлайн-балансер **LORD.TV** (панель `lordsilver.biz`) для Lampac NextGen.

Каталог сериалов читается из публичного API. Потоки только с **embed-token** и **Origin домена, на который токен выдан**.

## Почему был 403

`embed_token` привязан к origin партнёра. Запрос с `Origin: https://lordsilver.biz` даёт:

`Domain lordsilver.biz is not allowed for this token`

Для токена из HAR doramaru нужно:

```json
"LordTV": {
  "enable": true,
  "host": "https://lordsilver.biz",
  "embed_token": "<query-token из iframe>",
  "player_origin": "https://sled-chikatilo-episode.doramaru-hd.biz",
  "referer": "https://sled-chikatilo-episode.doramaru-hd.biz/",
  "streamproxy": true
}
```

Если токен выписан на другой сайт — поменяй `player_origin` / `referer` на тот домен.

## Маршруты

| Маршрут | Назначение |
|---|---|
| `/lite/lordtv` | сезоны / серии / checksearch |
| `/lite/lordtv/video` | резолв потока |
