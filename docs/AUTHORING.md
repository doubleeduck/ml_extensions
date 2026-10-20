> Текущий состав: 20 обычных источников, пакет `official.mangalaunch.sources`.
> Разделение, новые NSFW ID и переход: [SOURCE_BUNDLE_SPLIT_RU.md](SOURCE_BUNDLE_SPLIT_RU.md).

# Создание JS-источника: SDK v1

Этот документ описывает **реализованный** wire API. Полная интеграция менеджера
в приложение ещё проходит разработку: успешный Node fixture не означает, что
приняты native sandbox, reader, авторизация и release-сборки.

Нормативные файлы: `sdk/source-api.d.ts`, `sdk/manifest.schema.json` и app
`ExtensionManifest`/`SourceDtoCodec`. JSON Schema помогает редактору, но не
заменяет семантическую проверку приложения: уникальность IDs, согласованность
capabilities/features/auth, signed file hashes, ограничения путей, defaults
настроек, certificate/host policy и ownership проверяются host-кодом.

## 1. Выбор реализации и структура

Сначала изучите публичные ответы сайта и перечислите: каталоги/пагинацию,
поиск/фильтры, details, chapters, reader, CDN, recommendations, login и redirects.
Запишите стабильные manga/chapter IDs. При переносе работающего источника они
**не меняются**: это ключи библиотеки, истории, прогресса и скачанных глав.
Смена домена не даёт оснований менять ID или включать домен в новый ID.

Для нового JSON/API-источника скопируйте `templates/json-api` в отдельный каталог.
Это **фиктивный API**, полностью покрытый `tests/template.test.mjs`, а не парсер
example.org. Замените manifest и реальные запросы/DTO; не публикуйте шаблон как
готовый источник. Минимальная структура проекта:

```text
manifest.json          # files/signature добавляет packer
LICENSE
src/index.mjs          # default synchronous createSource(context)
src/engines/…           # shared pure helpers/factories, если нужно
assets/…               # только используемые data/icon assets
tests/…                # developer-only, в пакет не включаются
```

Пул Unofficial Extensions собирается отдельно: `src/definitions.mjs` → один manifest с
20 sourceId; `src/index.mjs` → dispatcher фабрик. Новый source пакета требует
обновить обе регистрации и tests. NSFW и обычные источники выпускаются раздельными пакетами; см. SOURCE_BUNDLE_SPLIT_RU.md.

Общие engines должны быть фабриками. Изменяемое состояние, cursors и кэши
размещайте **внутри createSource(ctx)**. Module-level constants и чистые функции
разрешены. Publisher, family, host и языковой вариант не являются account scope:
настройки, cookies, tokens и WebView profile всегда принадлежат **sourceId**.

## 2. Runtime и методы

Исполнение — QuickJS в отдельном OS sandbox. Node/npm нужны для разработки,
но `process`, `require`, filesystem, sockets, browser DOM, Node modules и
удалённые imports в runtime отсутствуют. ESM imports — только относительные
пути к подписанным JS payload-файлам. Есть URL/URLSearchParams,
TextEncoder/TextDecoder (UTF-8), Promise и обычные встроенные JS объекты.

`export default function createSource(ctx)` синхронно возвращает объект методов.
Imports и factory **не выполняют HTTP/HTML/settings/auth**: установка проверяет
все фабрики offline. IO выполняется только внутри вызванного метода.

| Метод | Аргументы | Результат | Декларация |
| --- | --- | --- | --- |
| getPopular | `{page}` | MangaDto[] | browse |
| getLatest | `{page}` | MangaDto[] | latest |
| search | `{searchTerm,page,selectedFilters}` | MangaDto[] | search |
| getFilters | `{refresh?}` | FilterDto[] | filters |
| getDetails | `{mangaId}` | MangaDto | обязательно |
| getChapters | `{mangaId}` | ChapterDto[] | обязательно |
| getPages | `{mangaId,chapterId}` | PageDto[] | обязательно |
| getRecommendations | `{mangaId,page}` | `{items,page,hasNextPage}` | recommendations |

Для metadata-only источника обязательно `metadataOnly:true`; отсутствие глав не
имитирует доступность чтения. Не объявляйте capability, которая не реализована.
Страницы пагинации начинаются с 1, PageDto.index — с **0**, без дырок/дубликатов.
Номера глав конечные, дробные номера сохраняются; chapter IDs уникальны.
Datetime — ISO-8601 UTC либо null. Отсутствующее nullable поле — null, не
undefined/NaN. Возвращайте только JSON data, не DOM/class instances/functions.

## 3. HTTP, HTML и media

Оформление источника задаётся через `branding:{icon:'assets/site.png',accentColor:'#123456'}`.
Иконка — PNG/JPEG/WebP до 256 КиБ, объявленный в `files` подписанный payload.
Приложение не содержит реестра иконок сайтов; отсутствие оформления даёт
нейтральный значок. Изменения оформления применяются при обновлении расширения.
Packer включает все объявленные source icons автоматически.

Опциональный `network.transportProfile:'host.platform.v1'` выбирает штатный
платформенный транспорт приложения (WinHTTP/Cronet) одновременно для HTTP и
media. Без профиля остаётся прежний Dart-транспорт. Профиль не расширяет grants,
не выполняет произвольный код и не отключает TLS/redirect/session/limit checks.
Новые поля `branding` и `transportProfile` требуют приложения с их поддержкой;
обновление одного `.mlsource` не изменяет исполняемый host-код.

```js
const response = await ctx.http.request({
  method: 'GET', url: new URL('/api/titles', ctx.baseUrl).href,
  responseType: 'json', timeoutMs: 20000,
  headers: {Accept: 'application/json'},
});
```

`response` содержит status/url/безопасные headers/body. Body — JSON, string или
numeric byte array. GET/POST/HEAD должны быть явно разрешены в manifest.
Timeout 250..30000 ms; body запроса ≤256 KiB; HTTP response ≤4 MiB; bytes через
IPC ≤1 MiB. Читательские картинки возвращаются как **URL**, не base64/byte array.
Native media broker загружает их без прохода через JS. Обложки, language flags
и reader CDN перечисляются в `imageOrigins`, HTML/API — в `origins`.

HTTPS/origin/port проверяются перед запросом и каждым redirect. Поддомены —
только с явным allowSubdomains и с границей доменного имени. Используется
системный DNS; диапазоны IP, в том числе fake-IP VPN, **не фильтруются**.
DoH не используется. TLS проверяет исходный hostname, даже если DNS вернул
локальный адрес. Это намеренный host-only контракт, не защита от DNS rebinding.
Не добавляйте широкие CDN-домены «на всякий случай»: подтвердите каждый сетью.

`media` задаёт host UA/referer/origin. Изображения идут через нативный broker и
общий scoped CacheManager для обложек, ридера, скачивания, OCR, сохранения и
буфера обмена; они не пересылаются через JS IPC. Для нестандартного формата
`media.transform` объявляет общий алгоритм `xor`, байты `key`, `origin`,
`pathPrefix`, `stemLength`, `markerOffset`, `marker`. Хост валидирует ограничения
и выполняет преобразование вне UI isolate. Параметры сайта принадлежат пакету;
произвольный JS decoder/callback из manifest не выполняется. Без transform
байты не меняются. `presentation.coverFit` задаёт `contain`/`cover`.

Cookie/Authorization/Host/User-Agent не задаются произвольным JS-заголовком.
Host применяет собственные credentials/profile; допустимые UA — app/browser/
reader/mobileSafari. Допустимые request headers указаны в network policy:
Accept/Content-Type/Accept-Language и поддержанные публичные site/API headers.
Referer/Origin допускаются лишь из разрешённых origins. Фиктивная Cookie в JS
запросе не является способом обойти авторизацию.

Для HTML используйте один **batched projection**, а не сотни последовательных
вызовов/регулярные выражения над всем документом:

```js
const response = await ctx.http.request({method:'GET',url:ctx.baseUrl,responseType:'text'});
const cards = await ctx.html.extract(response.body, {
  baseUrl: response.url, selector: '.title-card', all: true,
  fields: {
    title: {selector:'h3',text:true},
    href: {selector:'a',attr:'href',absoluteUrl:true},
    cover: {selector:'img',attr:'data-src',absoluteUrl:true},
  },
});
```

`exclude:'.badge,.rborder'` удаляет descendants только у text projection;
`normalizeWhitespace:false` сохраняет внутренние пробелы; directChildren и
tagName доступны по SDK type. Это data-only API, не удалённый DOM/eval.

## 4. Авторизация и настройки

Логин/капча/OAuth/SSO выполняются **приложением**, не JS UI. Manifest выбирает
поддержанный host auth profile, login URL, exact cookieOrigins и sessionExport.
Профили — `host.cookie.v1`/`host.session.v1`; `auth.rules` содержит только данные:
`bearer`, `cookieAll`/`cookieAny`, `tokenStorageKeys`, `tokenPath`, `tokenTypePath`,
`tokenType`, `tokenFields`. Все чтения browser storage, разбор токенов и
распознавание сессии исполняются **в приложении**. Сайтоспецифичные callbacks
не поддерживаются; хост проверяет границы декларации до запуска worker.
Даже две версии одного сайта имеют отдельные cookies/tokens/browser profile.
Cookie Domain root явно декларируется, если сервер использует parent Domain;
само совпадение суффикса не даёт права экспортировать credentials.

Обычный `http.request` получает актуальную сессию автоматически. Если API требует
token в POST body или иное разрешённое session value, используйте snapshot:

```js
const session = await ctx.auth.getSession({url: apiUrl});
const result = await ctx.http.request({method:'POST',url:apiUrl,responseType:'json',
  authRevision:session.revision,body:{token:session.accessToken}});
```

Передавайте authRevision; при logout/смене сессии host отменит устаревший запрос.
Не храните snapshot/token в module globals и не пишите его в log/errors/settings.
Login cookies не передаются в произвольный CDN или соседний источник.

Настройки — manifest `settings:{version,fields}` с boolean/string/integer/enum,
label/default/ограничениями. `ctx.settings.get/set` видят только свой sourceId и
декларированные ключи. `ctx.settings.get('source')` возвращает все объявленные
поля. `network` содержит host-controlled mirror. Имена `source`/`network`
зарезервированы. `roles.titleLanguage` указывает на enum-поле, нужное общему
подбору трекера. Опциональный `legacyNamespace` переносит типизированные поля
старого source-owned JSON blob без таблиц имён сайтов в приложении.

В пакете Unofficial Extensions `network.maxConcurrentRequests` равен 6; хост принимает
1–8. Общий scheduler допускает 32 HTTP, до 8 на origin, очередь 1024. Media
budget — 16 всего / 8 на источник; реальная concurrency ограничена также
manifest и общим scheduler. Эти декларации требуют обновлённого приложения.

Для пары Details/Chapters используйте `src/core/recent.mjs`: ограниченный
кеш фабрики (две записи / 15 секунд), объединение Promise, без кеширования
HTTP ошибок и POST. Не применяйте его к ручному обновлению каталога.

## 5. Фильтры, ссылки и ошибки

Filter key/value — API идентификатор, label — отображаемый текст. Не стройте query
по локализованным labels. Все options уникальны по value. DefaultValues сейчас
поддерживаются у multiSelect; очистка выбранного должна оставаться пустым массивом.
`filterBindings` связывает author/artist/tags с filter keys. Сохраняйте полное
имя-алиас, если сайт его требует (`jairou | xil`); не добавляйте badge-счётчик.
Для чипов из общего списка `MangaDto.tags` привязка `tags` задаёт приоритет:
приложение также сопоставляет label с options жанров/тегов/тем. Точное совпадение
важнее частичного; при одинаковых label выбирается объявленный фильтр.
Если подходящего option или текстового фильтра нет, открывается текстовый поиск.
Query кодируйте **один раз** через URLSearchParams.

Web URL строится host из `web.mangaUrlTemplate` с одним `{id}` и idEncoding.
Для composite ID можно задать `idPart:{separator,index}`. Не возвращайте JS
callback или произвольный внешний URL вместо декларации.

Не выдавайте пустой успешный список при изменении HTML/JSON. Возвращайте
осмысленную ошибку: `Object.assign(Error('Safe description'),
{code:'parse_error',phase:'parse'})`. Полный union — в source-api.d.ts.
Сохраняйте access DTO paid/temporarilyUnavailable вместо общего network error.
Не повторяйте автоматически POST/логин; не обходите HTTP 403/challenge/429 другим
хостом. HTTP операции разных источников идут параллельно в общем bounded
scheduler; используйте Promise.all только для независимых запросов.

## 6. Проверки, сборка и доверие

Минимум fixtures: empty/end pagination; first/next page; special-character query;
IDs/chapters/fractional numbers/dates; cover/flag/reader CDN; фильтры/reset/defaults;
paid/401/403/429; malformed HTML/JSON; independent source instances; logout
during requests; update/disable/cancel; reader/download/OCR. Node fixture проверяет
парсер, **не** ОС-изоляцию и не все app DTO semantics. Native probe не заменяет
живую проверку API, авторизации и media на Android/Windows release.

Команды из корня developer repo расширения:

```powershell
npm ci --ignore-scripts
npm rebuild esbuild
npm test
node tools/pack.mjs --generate-key C:/private/example.pem --key-id example-2026
node tools/pack_extension.mjs --project ./templates/json-api --key C:/private/example.pem --key-id example-2026 --output ./dist/example.mlsource
```

Каталог private key должен быть личным и исключённым из Git. Никогда не
публикуйте тестовые/fixture private keys. Подпись: Ed25519 над UTF-8
`MangaLaunch source package v1\n` + RFC8785 canonical manifest. Packer пишет
hash/size каждого payload и воспроизводимый ZIP с фиксированными timestamps.
Лимиты: ZIP ≤8 MiB, payload ≤24 MiB, ≤128 payload files; manifest ≤128 KiB.

`.public.json` рядом с архивом — **не доказательство доверия**. Пользователь
отдельно сверяет SHA-256 fingerprint публичного ключа и разрешённые extensionIds,
затем подтверждает publisher и grants пакета в приложении. Неизвестный/отозванный
ключ, другой namespace, downgrade или изменённый payload отклоняются. Изменённая
версия требует нового SemVer; никогда не перезаписывайте опубликованный SemVer.
Смена/отзыв ключа — явная операция владельца, не инструкция скачанного manifest.

Исходники расширения имеют режим **«Все права защищены»**. Наличие в GitHub не
является разрешением на распространение. Для своего проекта задайте собственную
лицензию и отдельно соблюдайте лицензии используемых third-party зависимостей.
Release CI/ключи/защищённое окружение описаны в BUILD_AND_RELEASE.md.
Подписанный GitHub index имеет отдельную схему `sdk/repository-index.schema.json`
и отдельный domain separator. Он не заменяет подпись пакета и не одобряет свой
ключ. `tools/sign_repository_index.mjs` связывает tag/asset/size/hash и состав
источников с архивом; клиент проверяет agreement, serial/expiry/key pinning.

## 7. Критерии handoff для разработчика/ИИ

Перед сдачей приложите source IDs/manifest diff, fixture и native test commands
с результатами, live host/CDN/auth matrix без secrets, проверенный .mlsource и
публичный fingerprint, список сохраняемых IDs и намеренных отличий от старого
источника. Явно укажите непроверенные платформы/HTTP challenges. Не называйте
источник принятым лишь потому, что фабрика создалась или каталог открылся.

## Оптимизация title projection (21.10.2026)

Для Details/Chapters/Recommendations одной страницы используйте одну вложенную
проекцию и кешируйте её результат через `recent`: по умолчанию 2 записи / 15 секунд
после завершения. Каталог этим кешем не обслуживается. Не сохраняйте второй
кеш сырого HTML без отдельной необходимости. Ошибки не кешируются.

`containsText:["термин"]` — отдельный режим результата HTML-проекции: boolean,
есть ли хотя бы одна подстрока в тексте выбранного узла без учёта регистра.
От 1 до 8 непустых строк, до 256 символов каждая; regex не исполняются. Этот режим
несовместим с `text`, `fields`, `attr`, `html`, `outerHtml`, `tagName`. Пример:
`{selector:"body",containsText:["копирайт"]}`. Он позволяет возвращать признаки
страницы вместо всего HTML. Нужен хост приложения с поддержкой `containsText`
от 21.10.2026; расширение и приложение обновляются вместе.

Для известного read-only taxonomy lookup допустим отдельный `recent` с
`limit:128, ttlMs:300000`; объединяйте одинаковые запросы, ограничивайте
параллельность (Pururin: 3), сохраняйте порядок выбранных значений. Этот кеш
не является универсальным разрешением кешировать или повторять POST.
