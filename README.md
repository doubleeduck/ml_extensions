# MangaLaunch Unofficial Extensions

Неофициальное расширение MangaLaunch: подписанный пакет **21 обычного источника** для MangaLaunch.
Идентификатор расширения: `official.mangalaunch.sources`.
NSFW-источники вынесены в отдельный репозиторий `nsfw_ml_extensions`; в этом пакете они не регистрируются и их отдельные модули и иконки отсутствуют.

## Источники

- **InkStory** — `ru.inkstory`
- **MangaDex** — `ru.mangadex`
- **MangaDex** — `en.mangadex`
- **MangaLib** — `ru.mangalib`
- **ReManga** — `ru.remanga` (каталог, фильтры, чтение, рекомендации, WebView-вход и смена базового URL)
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

## Документация

- [Создание источника и расширения, примеры и публикация — русский](docs/AUTHORING_RU.md)
- [Creating sources and extensions, examples and publication — English](docs/AUTHORING_EN.md)

## Установка

Добавьте GitHub-репозиторий через настройки расширений MangaLaunch либо импортируйте
подписанный `.mlsource` локально. Независимо сверьте fingerprint публичного ключа
издателя и подтвердите разрешения пакета. Обычные и NSFW-пакеты устанавливаются
раздельно; обновления используют прежние ID и ключ издателя.

## Лицензия

Все права защищены. См. [LICENSE](LICENSE).
