# LORD.TV

Онлайн-балансер **LORD.TV** (панель `lordsilver.biz`) для Lampac NextGen.

Каталог сериалов читается из публичного API. Сами потоки открываются только с **embed-токеном** партнёрского плеера или **Bearer API-токеном**.

## Интерфейс

`IModuleLoaded`, `IModuleOnline`.

## Поведение

- Для аниме `Invoke` возвращает `null`.
- Поиск сериала: сначала `kinopoisk_id` по выдаче `/api/v1/series/`, затем название / original title.
- Сезоны и серии берутся из `/api/v1/series/{id}`.
- Озвучки — из `/api/v1/player/data/...` (нужен embed-токен).
- HLS:
  1. `/api/v1/player/data/{episode|series}/{id}?token=...`
  2. запасной путь `/api/v1/stream/{type}/{id}/play` с Bearer.

Поддерживается `checksearch`.

## Маршруты

| Маршрут | Назначение |
|---------|------------|
| `/lite/lordtv` | сезоны / серии / checksearch |
| `/lite/lordtv/video` | резолв HLS (`play=true` — редирект в плеер) |

## Конфигурация

Секция `init.conf`: **`LordTV`**.

```json
"LordTV": {
  "enable": true,
  "host": "https://lordsilver.biz",
  "embed_token": "<query-token партнёрского iframe>",
  "apitoken": "<необязательный Bearer партнёра>",
  "streamproxy": true
}
```

Можно положить тот же query-токен в стандартное поле `token` — модуль его подхватит.

Значения по умолчанию:

- host: `https://lordsilver.biz`
- `displayindex = 545`
- `streamproxy = true`
- `stream_access = apk,cors,web`
- `rch_access = apk,cors`
- подпись качества: `~ 1080p`

Фильмовый каталог источника сейчас пустой, поэтому модуль заточен под сериалы.

## Файлы

`ModInit.cs`, `Controller.cs`, `ModuleConf.cs`, `Model.cs`, `manifest.json`.
