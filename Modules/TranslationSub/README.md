# TranslationSub для Lampac NextGen

Модуль подписок на конкретные озвучки сериалов в Lampa. Перенесён из [ivzaislu/TranslationSub](https://github.com/ivzaislu/TranslationSub), исходный коммит [a956603cf4f8d83160f5b643f0582e40ea7b34f9](https://github.com/ivzaislu/TranslationSub/commit/a956603cf4f8d83160f5b643f0582e40ea7b34f9).

## Интеграция

- Серверные контроллеры, сервисы и модели загружаются из `Modules/TranslationSub/` по `manifest.json`.
- Для отдельной сборки: `dotnet build Modules/TranslationSub/TranslationSub.csproj --nologo`.
- Конфигурация загружается через `ModuleInvoke.Init("TranslationSub", ...)`; модуль включён по умолчанию в манифесте и может быть отключён с помощью `TranslationSub.enable = false` в конфигурации либо `enable: false` в манифесте.
- Клиентский плагин `/translationsub.js` автоматически подключается через `AppReplace`; API — `/translationsub/v2/*`.
- Для проверки доступности переводов используются активные Online-модули, а для прогресса просмотра — TimeCode.
- Локальные данные хранятся в `database/translationsub.db`, этот файл не нужно коммитить.

Клиентские файлы `translationsub*.js` должны находиться рядом с `ModInit.cs` после развёртывания: `TranslationSubPluginController` объединяет их с диска в определённом порядке.

Исходная инструкция и снимки экрана доступны в [README TranslationSub](https://github.com/ivzaislu/TranslationSub#readme). Лицензия перенесённого кода — MIT (см. `LICENSE`).

## Проверки

Сценарии из исходного репозитория перенесены в `tests/translationsub/`. Сборку и работу API нужно проверить в окружении Lampac NextGen с установленным .NET 10.
