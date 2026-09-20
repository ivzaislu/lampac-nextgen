# LORD.TV

Онлайн-источник **LORD.TV** (`https://lordsilver.biz`) для сериалов. Каталог и структура сезонов/серий читаются через API LORD.TV, воспроизведение использует embed-player и по умолчанию работает через **`streamproxy = true`**.

## Интерфейс

**`IModuleLoaded`**, **`IModuleOnline`**.

## Условие появления в выдаче (`Invoke`)

Источник добавляется только для обычных сериалов:

- **`args.serial > 0`**;
- **`args.isanime == false`**.

Для фильмов, неопределённого типа и anime возвращается **`null`**.

## Глобальный поиск

**`with_search.Add("lordtv")`**.

Поиск контента выполняется по каталогу LORD.TV; при наличии **Kinopoisk ID** используется точное совпадение по нему.

## Конфигурация

Секция в `init.conf`: **`LordTV`** (`ModuleConf`).

По умолчанию: **`displayindex = 545`**, **`streamproxy = true`**, **`httptimeout = 10`**.

Специфичные параметры модуля:

- **`embed_token`** — token embed-player; рабочее значение задано в модуле как дефолт и может быть переопределено;
- **`player_origin`** — Origin партнёрского player-домена;
- **`referer`** — Referer для запросов player/API.

Все значения, заданные через **`ModuleInvoke.Init`**, остаются переопределяемыми через `init.conf`, включая стандартные transport-настройки `BaseSettings` (`streamproxy`, `useproxy`, `useproxystream`, `proxy`, `geostreamproxy`, `rchstreamproxy`, `headers`, `headers_stream` и другие).

Пример:

```json
"LordTV": {
  "streamproxy": false,
  "httptimeout": 10,
  "player_origin": "https://partner.example",
  "referer": "https://partner.example/"
}
```

Если **`headers_stream`** не задан, модуль формирует stream headers из текущих **`player_origin`** и **`referer`**.

## Подпись качества

**`OnlineApiQuality`**: при **`e.balanser == "lordtv"`** → **` ~ 1080p`**.

Player API может возвращать несколько доступных качеств; модуль формирует список потоков по заявленным качествам и сохраняет fallback-поиск по стандартному набору.

## HTTP

| Маршрут | Назначение |
|---------|------------|
| **`lite/lordtv`** | Основная выдача: поиск, сезоны, серии и озвучки. |
| **`lite/lordtv/video`** | Резолв и выдача видеопотока. |

## Файлы

**`ModInit.cs`**, **`Controller.cs`**, **`ModuleConf.cs`**, **`Model.cs`**, **`manifest.json`**.
