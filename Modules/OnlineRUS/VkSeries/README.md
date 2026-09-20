# VkSeries

Онлайн-источник **VK Сериалы** на базе API **`https://api.vkvideo.ru`**. Модуль создан как отдельная сериал-ориентированная ветка развития существующего **VkMovie**.

## Интерфейс

**`IModuleLoaded`**, **`IModuleOnline`**.

## Условие (`Invoke`)

Источник добавляется только для сериалов:

- **`args.serial > 0`**.

Для фильмов и неопределённого типа возвращается **`null`**.

## Глобальный поиск

**`CoreInit.conf.online.with_search.Add("vkseries")`**.

## Конфигурация

Секция в `init.conf`: **`VkSeries`** (`OnlinesSettings`).

По умолчанию: **`displayindex = 569`**, **`streamproxy = true`**, **`headers`** с **`origin`/`referer`** на **`vkvideo.ru`**.

## Подпись качества

**`OnlineApiQuality`**: для **`e.balanser == "vkseries"`** → **` ~ 2160p`**.

## HTTP

| Маршрут | Назначение |
|---------|------------|
| **`lite/vkseries`** | Основная выдача. |

## Разработка

Стартовая реализация скопирована из **VkMovie**. VK anonymous-token, HTTP/2, модели файлов/субтитров и базовый поиск сохранены как основа. Сериал-специфичную группировку по сезонам/сериям и фильтрацию результатов нужно развивать отдельно в этой ветке.

## Файлы

**`ModInit.cs`**, **`Controller.cs`**, **`Model.cs`**, **`manifest.json`**.
