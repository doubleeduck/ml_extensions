# MangaLaunch Unofficial Extensions

Неофициальное расширение MangaLaunch: подписанный пакет **20 обычных источников** для MangaLaunch.
Идентификатор расширения: `official.mangalaunch.sources`.
NSFW-источники вынесены в отдельный репозиторий `nsfw_ml_extensions`; в этом пакете они не регистрируются и их отдельные модули и иконки отсутствуют.

## Источники

- **InkStory** — `ru.inkstory`
- **MangaDex** — `ru.mangadex`
- **MangaDex** — `en.mangadex`
- **MangaLib** — `ru.mangalib`
- **ReadManga** — `ru.readmanga`
- **MintManga** — `ru.mintmanga`
- **SeiManga** — `ru.seimanga`
- **SelfManga** — `ru.selfmanga`
- **Usagi** — `ru.usagi`
- **RuMIX** — `ru.rumix`
- **Senkuro** — `ru.senkuro`
- **MangaFox** — `en.mangafox`
- **Mangakakalot** — `en.mangakakalot`
- **Weeb Central** — `en.weebcentral`
- **MangaChan** — `ru.mangachan`
- **MangaShi** — `ru.mangashi`
- **Desu** — `ru.desu`
- **Shikimori** — `ru.shikimori`
- **AniList** — `en.anilist`
- **MyAnimeList** — `en.myanimelist`

Технические extensionId, имена архивов, publisher KeyId и GitHub environment
сохраняют прежние значения с `official` для совместимости обновлений.
Отображаемое название пакета — Unofficial Extensions.

## Установка и переход

Пакеты имеют разные extensionId, sourceId и имена архивов и могут работать одновременно.
Основной пакет обновляется с сохранением прежнего extensionId. Для обновления
установленного пакета выпускайте версию выше текущей.
NSFW устанавливается отдельным расширением. Миграции в приложении нет:
записи библиотеки, история, настройки и сессии старых NSFW ID автоматически
не связываются с новыми. Повторно добавьте нужные тайтлы и войдите в аккаунты
новых источников. Старые пользовательские данные не удаляются этим репозиторием.
Сначала обновите основной пакет, чтобы убрать из каталога старые NSFW-регистрации.

См. [разделение пакетов и таблицу ID](docs/SOURCE_BUNDLE_SPLIT_RU.md).
Авторизация, WebView, cookies, защищённое хранение токенов и media-брокер остаются
в приложении. JS объявляет параметры через подписанный manifest; исходники
сайтов не включаются в приложение. Общие engines/helpers копируются в каждый
репозиторий и не требуют соседнего репозитория для сборки или исполнения.

## Разработка и сборка

Node 22+. SDK и инструменты одинакового контракта v1; `node:` imports допустимы
только в инструментах/тестах и не входят в runtime-пакет.

```powershell
npm ci
npm test
npm run build:host
node tools/pack.mjs --generate-key .keys/local-development.pem --key-id local-development
node tools/pack.mjs --key .keys/local-development.pem --key-id local-development --version 1.0.0-dev.1
```

По умолчанию архив: `dist/official.mangalaunch.sources.mlsource`.
Для сборки без npm/Flutter: `./build-package.ps1 -KeyPath PRIVATE.pem -KeyId ID -Version SEMVER`.
Добавьте `-Repository owner/repo -IndexSerial NUMBER` для подписанного release index.
Приватные ключи, node_modules, SDK bootstrap, тесты и dist не входят в архив.
Архив проверяется packer-ом; одинаковые ключ, версия и файлы дают одинаковые байты.
Локальный ключ предназначен только для разработки и не является доверенным production-ключом.

В GitHub Actions настройте отдельный репозиторий и environment
`official-source-release`, publisher ID и защищённый
Ed25519 signing secret. Новый namespace должен быть одобрен приложением отдельно;
public.json рядом с архивом сам по себе не устанавливает доверие.
Workflows проверяют изменения, собирают CI-архив и публикуют релиз по SemVer-тегу.

- [Контракт SDK и создание источников](docs/AUTHORING.md)
- [Проверки и выпуск](docs/BUILD_AND_RELEASE.md)
- [Сборка через PowerShell](docs/GITHUB_RELEASE_WITH_BUILD_PACKAGE.md)
- [Настройка GitHub Actions](docs/GITHUB_ACTIONS_SETUP_RU.md)

Node fixtures и offline-фабрики не заменяют живую проверку сайтов и аккаунтов.

## Лицензия

Все права защищены. См. [LICENSE](LICENSE).
