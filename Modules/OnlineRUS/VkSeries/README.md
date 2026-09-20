# VkSeries

Онлайн-источник **VK Сериалы** на базе API **`https://api.vkvideo.ru`**. Модуль использует механику авторизации и потоков из **VkMovie**, но строит выдачу как сезоны и эпизоды.

## Интерфейс

**`IModuleLoaded`**, **`IModuleOnline`**.

## Условие (`Invoke`)

Источник добавляется только для сериалов:

- **`args.serial > 0`**.

Для фильмов и неопределённого типа возвращается **`null`**.

## Глобальный поиск

**`CoreInit.conf.online.with_search.Add("vkseries")`**.

## Поиск и структура

1. **`catalog.getVideoSearchWeb2`** ищет сериал по названию и читает **`response.albums`**.
2. Альбомы с номером сезона (`1 сезон`, `Сезон 1`, `Season 1`, `S01`) используются как **`SeasonTpl`**.
3. При открытии сезона **`video.get`** вызывается с **`owner_id`** и **`album_id`**.
4. Номер серии извлекается из `title`, с fallback на `description`. Поддерживаются формы `S01E04`, `1 сезон 4 серия`, `Сезон 1. Серия 4` и `4 серия`.
5. Потоки и субтитры берутся из **`files`** и **`subtitles`** так же, как в **VkMovie**.

Поиск по отдельным **`catalog_videos`** пока не используется как fallback — основной путь VkSeries основан на альбомах VK Video.

## Конфигурация

Секция в `init.conf`: **`VkSeries`** (`OnlinesSettings`).

По умолчанию: **`displayindex = 569`**, **`streamproxy = true`**, **`headers`** с **`origin`/`referer`** на **`vkvideo.ru`**.

## Подпись качества

**`OnlineApiQuality`**: для **`e.balanser == "vkseries"`** → **` ~ 2160p`**.

## HTTP

| Маршрут | Назначение |
|---------|------------|
| **`lite/vkseries`** | Поиск сезонов и выдача эпизодов. |

## Файлы

**`ModInit.cs`**, **`Controller.cs`**, **`Model.cs`**, **`manifest.json`**.
