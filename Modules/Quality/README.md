# Quality for Lampac NextGen

Нативный модуль Lampac, раздающий /quality.js. Клиентский JS отображает максимальное качество торрентов (CAM, TS, TC, SD, HD, FHD, 4K). **Модуль находится в разработке.**

## Источник данных

Quality использует штатный Lampa.Parser.get. Настроенный вами в privateinit.js JacRed уже известен Lampa через Lampa.Storage (jackett_url, jackett_key, второе подключение и parser_use_link). **Не копируйте URL и API-ключ в Quality.** Встроенный JacRed Lampac не используется.

## Автоматическое подключение в LampaWeb

Если модуль Quality загружен (`manifest.enable=true`), `Quality.enable=true` и `Quality.autoinject=true` (значения конфигурации по умолчанию), он использует `EventListener.AppReplace`, как TranslationSub. Когда LampaWeb отдаёт встроенный JS приложения, Quality автоматически загружает `/quality.js`. Другие модули и их списки плагинов менять не требуется.

При использовании внешней Lampa или при `autoinject=false` можно подключить плагин вручную.

## Ручное подключение для тестирования

1. На тестовой установке после проверки CI включите Modules/Quality/manifest.json, установив enable: true. По умолчанию это false.
2. В init.conf при уже работающем LampaWeb добавьте запись в существующий массив LampaWeb.customPlugins; сохраните остальные плагины:

```json
{
  "LampaWeb": {
    "customPlugins": [
      { "url": "{localhost}/quality.js", "status": 1, "name": "Quality", "author": "lampac" }
    ]
  }
}
```

3. Убедитесь, что Lampa уже работает с JacRed через privateinit.js, и parser_torrent_type выбран как jackett.
4. Проверьте постеры, полную карточку и исходящие запросы в DevTools: Quality должен обращаться только через Lampa.Parser.get, используя выбранные Lampa источники.

Пример JSON выше — фрагмент настройки, не замена вашего существующего init.conf. Если customPlugins уже содержит другие записи, необходимо **добавить** элемент, не заменяя список.

## Реализовано

- JS классификация качества с фильтрацией названия, года, типа и трейлеров; корректная обработка надписи «звук с TS».
- Бейджи на постерах и полной карточке, in-memory кэш, ограниченная очередь, дедупликация запросов.
- Без серверного JacRed, Node.js, отдельной SQLite и NWS.

## Ограничения

- В рабочей ветке manifest.enable=false: требуется ручное тестовое включение.
- CI проверяет сборку и запуск Lampac, но не авторизованный JacRed из вашей личной конфигурации, CORS и поведение на телевизоре.
- Общего серверного кэша нет. Результаты определяются в Lampa; сервер получает только запрос /quality.js и не видит URL/ключи парсера.
- Поддержка режима parser_torrent_type=jackett; Prowlarr/TorrServer пока не входят в задачу.

## Проверки

- dotnet build Modules/Quality/Quality.csproj --nologo
- node --check Modules/Quality/plugin.js
- node tests/quality-client.test.js
- CI: https://github.com/ivzaislu/lampac-nextgen/actions/workflows/quality.yml
- Текущие статусы этапов и журнал: [PLAN.md](PLAN.md).
