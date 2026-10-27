# Создание и публикация расширений MangaLaunch

[English](AUTHORING_EN.md)

Разделы: [полный пример источника](#source-example) · [контракт фильтров](#filter-contract) · [публикация](#publishing) · [справочник DTO, ctx и manifest](#api-reference).

Руководство по Source API v1: создание своего пакета, реализация источника, проверка, подпись и публикация. Расширение — подписанный файл `.mlsource`, содержащий один или несколько источников. Источник — отдельная регистрация сайта со своим ID, настройками и сессией.

Контракт задают [типы API](../sdk/source-api.d.ts), [схема manifest](../sdk/manifest.schema.json) и [схема индекса репозитория](../sdk/repository-index.schema.json). Примеры ниже используют вымышленный API `example.org`: это образец структуры, а не готовый источник реального сайта.

## 1. Подготовка и структура

Нужен Node.js 22 или новее. Команды выполняются из корня репозитория расширений.

```powershell
npm ci --ignore-scripts
npm rebuild esbuild
npm test
```

Изучите ответы сайта: каталог и пагинацию, поиск, фильтры, карточку, главы, страницы, рекомендации, вход, перенаправления и домены изображений. Предпочитайте доступный структурированный API; если его нет, используйте HTML-проекции.

Для отдельного пакета скопируйте [шаблон](../templates/json-api) в собственный каталог проекта и замените фиктивные URL, ID, лицензию и реализацию:

```text
my-sources/
  manifest.json
  LICENSE
  src/
    index.mjs
  assets/               # при необходимости
  tests/
    source.test.mjs
```

В существующем наборе источников добавьте модуль в `src/sources/` или общую фабрику в `src/engines/`, регистрацию в `src/definitions.mjs` и соответствие ID → фабрика в `src/index.mjs`. Обновите тесты регистраций и модуля.

| Репозиторий | Содержимое | Существующий extensionId | Архив по умолчанию | GitHub environment |
| --- | --- | --- | --- | --- |
| `ml_extensions` | Обычные источники | `official.mangalaunch.sources` | `official.mangalaunch.sources.mlsource` | `official-source-release` |
| `nsfw_ml_extensions` | NSFW-источники | `official.mangalaunch.nsfw.sources` | `official.mangalaunch.nsfw.sources.mlsource` | `official-nsfw-source-release` |

Название этих пакетов — **Unofficial Extensions**. Существующие технические ID и имена архивов сохраняются для обновлений. Для нового самостоятельного пакета выберите собственный уникальный `extensionId`, ключ издателя и source IDs; не используйте чужой namespace. NSFW-источники публикуйте в соответствующем отдельном пакете и отмечайте `isNsfw: true`.

ID источников, тайтлов и глав должны быть стабильными: от них зависят библиотека, история и прогресс. Смена домена не означает смену ID. Не передавайте уже опубликованный sourceId другому пакету или издателю: удаление пакета пользователем не освобождает его зарегистрированное владение.

## 2. Manifest отдельного пакета

Сохраните как `manifest.json`. `files` здесь является заготовкой: упаковщик заполнит размеры и SHA-256 файлов и создаст подпись. Не редактируйте подписанный manifest вручную.

```json
{
  "schemaVersion": 1,
  "extensionId": "example.sources",
  "name": "My Unofficial Sources",
  "version": "1.0.0",
  "publisherKeyId": "my-publisher-2026",
  "sourceApiVersion": 1,
  "minAppVersion": "1.0.0",
  "minRuntimeAbi": 1,
  "entrypoint": "src/index.mjs",
  "license": "LicenseRef-Proprietary",
  "permissions": ["http", "html"],
  "files": {},
  "sources": [{
    "id": "en.example",
    "name": "Example",
    "language": "en",
    "baseUrl": "https://example.org",
    "engine": "Example API",
    "status": "experimental",
    "isNsfw": false,
    "metadataOnly": false,
    "supportsCustomBaseUrl": false,
    "supportsFilterRefresh": false,
    "capabilities": ["browse", "latest", "search", "filters", "recommendations"],
    "features": {
      "webLinks": true, "auth": false,
      "authCompletion": false, "recommendations": true
    },
    "web": {
      "mangaUrlTemplate": "/title/{id}",
      "idEncoding": "pathSegment"
    },
    "filterBindings": {"tags": "genres"},
    "network": {
      "origins": ["https://example.org"],
      "imageOrigins": ["https://images.example.org"],
      "authOrigins": [],
      "allowSubdomains": false,
      "methods": ["GET"],
      "maxConcurrentRequests": 2
    },
    "media": {
      "userAgentProfile": "browser",
      "refererOrigin": "https://example.org",
      "sendOrigin": false
    }
  }]
}
```

Правила декларации:

- `capabilities` и `features` должны соответствовать реально реализованным методам. Для источника только с метаданными укажите `metadataOnly: true`; не объявляйте доступное чтение.
- `origins` — HTML/API, `imageOrigins` — обложки, флаги языков и страницы, `authOrigins` — домены, которым разрешена авторизация. Указывайте точные HTTPS origins без путей. Для поддоменов требуется явное `allowSubdomains`.
- Разрешайте только нужные методы и permissions: `http`, `html`, `sourceSettings`, `sourceSession`. Не добавляйте CDN и домены входа «на всякий случай».
- Для смены зеркала объявите `supportsCustomBaseUrl: true`, используйте актуальный `ctx.baseUrl` и проверьте поведение API, изображений и входа на зеркале. Не заменяйте глобально домены независимых API/CDN.
- Ссылка на тайтл задаётся через `web.mangaUrlTemplate` с одним `{id}`. `idEncoding` — `pathSegment` или `path`; для составного ID доступен `idPart: {separator, index}`.
- Иконка источника задаётся через `branding: {icon: "assets/site.png", accentColor: "#123456"}`. PNG/JPEG/WebP — до 256 КиБ, локальный подписанный файл. Оформление принадлежит расширению.
- `presentation.coverFit` принимает `contain` или `cover`. `network.transportProfile: "host.platform.v1"` выбирает платформенный HTTP/media-транспорт. Указывайте минимальную версию приложения, поддерживающую используемые возможности.

<a id="source-example"></a>

## 3. Реализация источника

Точка входа — синхронная `export default function createSource(ctx)`, возвращающая объект методов. Импорты и создание фабрики не выполняют HTTP, HTML, чтение настроек или авторизацию: пакет проверяется и без сети.

Runtime предоставляет JavaScript, Promise, URL/URLSearchParams и UTF-8 TextEncoder/TextDecoder. Node.js, `process`, `require`, файловая система, сокеты и браузерный DOM недоступны. Импорты — относительные пути к подписанным файлам пакета; удалённые зависимости не загружаются.

| Метод | Аргументы | Результат |
| --- | --- | --- |
| `getPopular` | `{page}` | `MangaDto[]`, capability `browse` |
| `getLatest` | `{page}` | `MangaDto[]`, capability `latest` |
| `search` | `{searchTerm, page, selectedFilters}` | `MangaDto[]`, capability `search` |
| `getFilters` | `{refresh?}` | `FilterDto[]`, capability `filters` |
| `getDetails` | `{mangaId}` | `MangaDto`, обязательный метод |
| `getChapters` | `{mangaId}` | `ChapterDto[]`, обязательный метод |
| `getPages` | `{mangaId, chapterId}` | `PageDto[]`, обязательный метод |
| `getRecommendations` | `{mangaId, page}` | `{items, page, hasNextPage}`, capability `recommendations` |

Рабочая основа для фиктивного JSON API, файл `src/index.mjs`:

```js
const invalid = () => Object.assign(
  Error('Unexpected API response.'), {code: 'parse_error', phase: 'parse'},
);
const array = value => {
  if (!Array.isArray(value)) throw invalid();
  return value;
};
const text = value => {
  if (typeof value !== 'string' || !value.trim()) throw invalid();
  return value;
};
const record = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value;
};
const manga = input => {
  const row = record(input);
  return {
    id: text(row.id), title: text(row.title),
    coverUrl: row.cover ?? null, description: row.description ?? null,
    secondaryTitle: null, author: row.author ?? null, artist: null,
    status: null, type: null, ageRating: null, rating: null,
    releaseYear: null, pageCount: null, languageFlagUrl: null,
    tags: array(row.tags ?? []).map(text),
  };
};

export default function createSource(ctx) {
  async function get(path, query = {}) {
    const url = new URL(path, ctx.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== '') url.searchParams.set(key, String(value));
    }
    return record((await ctx.http.request({
      method: 'GET', url: url.href, responseType: 'json',
    })).body);
  }
  async function list(sort, page, searchTerm = '', selectedFilters = {}) {
    const tags = selectedFilters.genres ?? [];
    const values = prefix => tags
      .filter(value => value.startsWith(prefix))
      .map(value => value.slice(prefix.length)).join(',');
    const response = await get('/api/titles', {
      sort, page, q: searchTerm,
      genres: values('include:'), excludeGenres: values('exclude:'),
    });
    return array(response.items).map(manga);
  }
  return {
    async getPopular({page = 1} = {}) { return list('popular', page); },
    async getLatest({page = 1} = {}) { return list('latest', page); },
    async search({searchTerm = '', page = 1, selectedFilters = {}} = {}) {
      return list(selectedFilters.sort?.[0] ?? 'relevance',
        page, searchTerm, selectedFilters);
    },
    async getFilters() {
      return [{
        key: 'sort', label: 'Order', caption: null, kind: 'sort',
        supportsDirection: false, defaultValues: [],
        options: ['relevance', 'popular', 'latest'].map(value => ({
          value, label: value, caption: null,
        })),
      }, {
        key: 'genres', label: 'Genres', caption: null,
        kind: 'triStateMultiSelect', defaultValues: [],
        options: [{value: 'action', label: 'Action', caption: null}],
      }];
    },
    async getDetails({mangaId}) {
      return manga(await get('/api/titles/' + encodeURIComponent(mangaId)));
    },
    async getChapters({mangaId}) {
      const response = await get('/api/titles/' +
        encodeURIComponent(mangaId) + '/chapters');
      return array(response.items).map(input => {
        const row = record(input);
        if (!Number.isFinite(row.number)) throw invalid();
        return {
          id: text(row.id), title: text(row.title), number: row.number,
          uploadedAt: row.uploadedAt ?? null,
          access: {type: 'available', availableAt: null,
            priceLabel: null, message: null},
        };
      });
    },
    async getPages({chapterId}) {
      const response = await get('/api/chapters/' +
        encodeURIComponent(chapterId) + '/pages');
      return array(response.images).map((imageUrl, index) => ({
        index, imageUrl: text(imageUrl),
      }));
    },
    async getRecommendations({mangaId, page = 1}) {
      const response = await get('/api/titles/' +
        encodeURIComponent(mangaId) + '/recommendations', {page});
      if (typeof response.hasNextPage !== 'boolean') throw invalid();
      return {items: array(response.items).map(manga),
        page, hasNextPage: response.hasNextPage};
    },
  };
}
```

Здесь API возвращает `{items: [...]}` для каталогов и глав, объект тайтла для details, `{images: [...]}` для страниц и `{items: [...], hasNextPage: boolean}` для рекомендаций. Замените этот контракт реальными ответами сайта.

Все результаты — JSON-данные. Nullable-поля DTO возвращайте как `null`, массивы — как массивы; не передавайте `undefined`, `NaN`, функции и DOM-объекты. URL изображений должны быть абсолютными. Пагинация начинается с 1, `PageDto.index` — с 0, без пропусков и дубликатов. ID глав уникальны; номера конечные, дробные номера сохраняются. Даты — ISO-8601 с часовым поясом (рекомендуется UTC) либо `null`.

В `ChapterDto.access` сохраняйте `available`, `temporarilyUnavailable` или `paid` вместе с доступными `availableAt`, `priceLabel` и `message`. Платный доступ не должен превращаться в общую сетевую ошибку. Metadata-only источник реализует обязательные методы глав и страниц, возвращая пустые массивы.

## 4. HTTP, HTML и изображения

Все сетевые запросы выполняйте через `ctx.http.request`. Сессия и разрешённые параметры транспорта применяются приложением. Проверка HTTPS, origin, порта и разрешений действует также на каждом перенаправлении.

Не подставляйте произвольные `Cookie`, `Authorization`, `Host` или `User-Agent` в headers. Используйте декларацию сессии и `userAgentProfile`: `app`, `browser`, `reader`, `mobileSafari`. `Referer` и `Origin` должны относиться к разрешённым origins. Публичные API-заголовки допустимы в пределах поддерживаемой сетевой политики.

Для HTML предпочтительна одна вложенная проекция вместо множества последовательных вызовов:

```js
const response = await ctx.http.request({
  method: 'GET', url: new URL('/catalog', ctx.baseUrl).href,
  responseType: 'text',
});
const cards = await ctx.html.extract(response.body, {
  baseUrl: response.url, selector: '.title-card', all: true,
  fields: {
    title: {selector: 'h3', text: true},
    href: {selector: 'a', attr: 'href', absoluteUrl: true},
    cover: {selector: 'img', attr: 'data-src', absoluteUrl: true},
  },
});
```

Выполняйте пример внутри асинхронного метода источника; добавьте permission `html`. Результат проекции — данные, а не живой DOM. Доступны `fields`, `all`, `required`, `text`, `attr`, `absoluteUrl`, `html`, `outerHtml`, `ascend`, `nextSibling`, `directChildren` и `tagName`.

`exclude` убирает служебные дочерние узлы из текстовой проекции; `normalizeWhitespace: false` сохраняет внутренние пробелы. `containsText: ["term"]` возвращает boolean для 1–8 буквальных подстрок длиной до 256 символов. Этот режим не совмещается с другими режимами значения и не исполняет regex.

В `getPages` возвращайте URL, а не байты или base64 изображений. Загрузкой обложек и страниц, кешем, заголовками и сессиями занимается media-брокер. Не отрезайте подписанные параметры URL CDN. Для поддержанного преобразования изображения есть декларативный `media.transform` — произвольный decoder из manifest не исполняется.

## 5. Фильтры, настройки и авторизация

<a id="filter-contract"></a>

### Фильтры: полный контракт

#### Декларация, запрос и ответ — разные данные

1. Источник объявляет capability `filters` и реализует `getFilters({refresh?})`.
2. `getFilters` возвращает **массив FilterDto**, а не `{filters: [...]}`, выбранные значения или параметры HTTP. Порядок массива — порядок фильтров; порядок options — порядок вариантов.
3. Приложение строит интерфейс по этому массиву и передаёт выбор в `search({searchTerm, page, selectedFilters})`.
4. Источник самостоятельно переводит этот выбор в API/HTML-запрос сайта и возвращает `MangaDto[]`. Автоматического сопоставления ключей с query/body сайта нет.

```ts
interface FilterOptionDto {
  value: string;
  label: string;
  caption: string | null;
}
interface FilterDto {
  key: string;
  label: string;
  caption: string | null;
  kind: 'toggle' | 'text' | 'singleSelect' | 'multiSelect'
      | 'triStateMultiSelect' | 'sort';
  options: FilterOptionDto[];
  defaultValues: string[];
  supportsDirection?: boolean;
}
interface SourceQueryDto {
  searchTerm: string;
  page: number;
  selectedFilters: Record<string, string[]>;
}
```

| Поле FilterDto | Контракт |
| --- | --- |
| `key` | Непустая стабильная строка, уникальная во всём списке фильтров. По ней приходит выбор. `genres`, `format`, `sort` — соглашения об именовании, не обязательные имена. |
| `label` | Непустая подпись для пользователя. Не используйте её как API ID. |
| `caption` | Пояснение или `null`; это обычный текст, без HTML-виджетов. |
| `kind` | Ровно один из шести типов в таблице ниже; произвольные типы не поддерживаются. |
| `options` | Массив `{value, label, caption}`. Для toggle/text передавайте `[]`; для остальных перечисляйте доступные варианты. |
| `defaultValues` | Массив API values. Непустой массив разрешён **только для multiSelect**, все значения должны присутствовать в options. Для других типов — `[]`. |
| `supportsDirection` | Необязательный boolean, по умолчанию `true`. Имеет смысл у sort; `false` скрывает выбор направления. |

В FilterOptionDto `value` — строковый API ID, `label` — непустое отображаемое название, `caption` — пояснение или `null`. Числовой ID сайта тоже передаётся строкой, например `"42"`; преобразуйте его в число только при построении запроса, если API этого требует. Values должны быть уникальны внутри фильтра. Одинаковые подписи с разными values технически возможны, но делают чипы неоднозначными.

Пустой `option.value: ""` допускается для нейтрального варианта вроде Any. В singleSelect/sort такой выбор фактически очищает значение; не используйте пустую строку как значимый ID. В defaultValues пустые строки недопустимы. У toggle/text options не используются интерфейсом.

Всегда возвращайте поля из контракта явно, включая `caption: null`, `options: []` и `defaultValues: []`, когда они пусты. Часть пропущенных массивов принимается как пустая для совместимости, но это не основание возвращать произвольную форму DTO.

Ограничения декодирования: до **256 фильтров**, до **10000 options** и **10000 defaultValues** на фильтр. Строки key/label/value/caption — до 16384 символов без NUL; обязательные строки не должны состоять из пробелов. Выбирайте короткие машинные ключи, особенно для filterBindings, где длина ссылки на ключ ограничена 128 символами. Дубли ключей, дубли values, неизвестный kind, неверный supportsDirection и неподдерживаемые defaults отклоняют весь список.

#### Как передаётся выбор каждого типа

В `selectedFilters` нет boolean, number, null, вложенных объектов или одиночных строк: **значение каждого ключа — string[]**. Options.value и key чувствительны к регистру; не локализуйте и не перекодируйте их.

| kind | Пример записи в selectedFilters | Нейтральное состояние и обработка |
| --- | --- | --- |
| `toggle` | `"availableOnly": ["true"]` | Выключенный переключатель удаляет ключ. Проверяйте `values.includes("true")`; строки `"false"` UI не отправляет. |
| `text` | `"author": ["Name One, Name Two"]` | Одна строка в первом элементе. Пустой текст удаляет ключ. Не ожидайте массив отдельных терминов. |
| `singleSelect` | `"format": ["manga"]` | Один API value. Нет выбора — ключ отсутствует; `[]` тоже трактуйте как отсутствие выбора. |
| `multiSelect` | `"languages": ["en", "ru"]` | Значения без префиксов. Отсутствующий ключ означает defaults, явный `[]` — снять всё. |
| `triStateMultiSelect` | `"genres": ["include:action", "exclude:horror"]` | Для каждого value — ignore/include/exclude. Ignore не передаётся; пустой выбор удаляет ключ. |
| `sort` | `"sort": ["latest", "desc"]` или `["title", "asc"]` | Первый элемент — поле, второй — направление. Без второго UI подразумевает desc. При supportsDirection=false передаётся только `["latest"]`. |

Текстовый редактор может отображать термины чипами и соединять активные термины через `, `. На wire это всё ещё одна строка. Нет универсального контракта CSV, кавычек, списка авторских ID или поискового синтаксиса: источник определяет семантику и поясняет её в caption. Не теряйте алиасы вроде `name | alias`.

Для triState префикс добавляется **только в выбранное значение**, а не в options.value. Декларация содержит `value: "action"`, запрос — `"include:action"`. Используйте точные префиксы `include:` и `exclude:`; `-action`, `!action`, boolean и `ignore:action` не являются контрактом. После удаления префикса сохраните исходный ID целиком, в том числе остальные двоеточия.

UI не выбирает одновременно include и exclude одного варианта. Источник должен устойчиво обрабатывать старые presets/позиции: убрать дубли, проверить values по актуальным options и определить политику конфликта. В примере ниже включение имеет приоритет над исключением; это политика примера, а не скрытое правило сервера.

Полный входной запрос для всех типов:

```json
{
  "searchTerm": "A & B",
  "page": 2,
  "selectedFilters": {
    "availableOnly": ["true"],
    "author": ["Author One, Author Two"],
    "format": ["manga"],
    "languages": ["en", "ru"],
    "genres": ["include:action", "exclude:horror"],
    "sort": ["latest", "desc"]
  }
}
```

#### Defaults, очистка и сброс

Пусть объявлено `languages.defaultValues = ["en", "ru"]`:

| Состояние | Значение для сайта |
| --- | --- |
| `selectedFilters = {}` | en и ru — defaults |
| `{"languages": ["ja"]}` | Только ja |
| `{"languages": []}` | Явно ни одного языка; defaults не восстанавливаются |
| `{"languages": ["en", "ru"]}` | То же, что defaults; UI может удалить этот ключ как избыточный |
| Общая кнопка сброса фильтров | Выбор становится `{}`, поэтому defaults снова действуют |

Приложение использует defaults для отображения multiSelect, но **не разворачивает их автоматически в selectedFilters для источника**. Источник обязан применить defaults при отсутствии ключа. Различайте `selectedFilters.languages ?? defaults` и `selectedFilters.languages?.length ? ... : defaults`: второй вариант ошибочно заменяет явный `[]`.

Для остальных kind нет декларативных начальных значений: `defaultValue`, `selected`, `checked`, `min`/`max` не являются полями FilterDto. Начальную сортировку задают реализации getPopular/getLatest/search, а не defaultValues сортировки.

Приложение сохраняет явные пустые массивы. Записи с непустым массивом, состоящим только из пробельных строк, перед запросом убираются. Не используйте такую запись как особый управляющий сигнал.

#### Маршрутизация каталога и сортировка

- Пустой searchTerm и пустой selectedFilters: обзор вызывает getPopular, последние — getLatest.
- Текст поиска **или любая запись selectedFilters**, включая явный `[]`: вызывается search. Поэтому search должен поддерживать `searchTerm: ""`, а не только поиск по названию.
- В отфильтрованной ленте без поискового текста приложение может добавить сортировку первой декларации kind=sort: latest/new для последних либо popular/discover для обзора, по совпадению в value или label. Пользовательский выбор не заменяется.
- Если подходящего варианта нет, источник сам выбирает порядок по умолчанию. В SourceQueryDto нет feedKind или отдельного признака «вызвано из последних»; не выводите его из порядка вызовов.
- `getLatest` должен использовать ту же серверную сортировку, что явный соответствующий выбор фильтра. `supportsDirection: false` означает фиксированный порядок API; игнорируйте оставшееся направление в старом preset.
- После смены поиска/фильтров пагинация начинается с 1. Не храните один общий cursor для разных выборок или одновременных операций; если API использует cursors, изолируйте их по нормализованному запросу.

#### Полный модуль обработки всех шести типов

Сохраните как `src/catalog-filters.mjs`. Имена параметров сайта (`language[]`, `genre[]` и другие) здесь вымышленные; замените их по реальному API. Повторяемые query-параметры добавляются через append, а не превращаются в строку через String(array).

```js
const choices = {
  format: [['manga', 'Manga'], ['manhwa', 'Manhwa']],
  languages: [['en', 'English'], ['ru', 'Russian'], ['ja', 'Japanese']],
  genres: [['action', 'Action'], ['drama', 'Drama'], ['horror', 'Horror']],
  sort: [['relevance', 'Relevance'], ['popular', 'Popular'],
    ['latest', 'Latest updates'], ['title', 'Title']],
};
const allowed = Object.fromEntries(Object.entries(choices)
  .map(([key, rows]) => [key, new Set(rows.map(([value]) => value))]));
const languageDefaults = ['en', 'ru'];
const options = key => choices[key].map(([value, label]) => ({
  value, label, caption: null,
}));

export function catalogFilters() {
  return [
    {key: 'availableOnly', label: 'Available only', caption: null,
      kind: 'toggle', options: [], defaultValues: []},
    {key: 'author', label: 'Author', caption: 'Name or alias',
      kind: 'text', options: [], defaultValues: []},
    {key: 'format', label: 'Format', caption: null,
      kind: 'singleSelect', options: options('format'), defaultValues: []},
    {key: 'languages', label: 'Languages', caption: null,
      kind: 'multiSelect', options: options('languages'),
      defaultValues: [...languageDefaults]},
    {key: 'genres', label: 'Genres', caption: null,
      kind: 'triStateMultiSelect', options: options('genres'), defaultValues: []},
    {key: 'sort', label: 'Order', caption: null,
      kind: 'sort', options: options('sort'), defaultValues: [],
      supportsDirection: true},
  ];
}

export function buildSearchRequest(ctx, query = {}) {
  const selected = query.selectedFilters ?? {};
  const values = key => Array.isArray(selected[key])
    ? selected[key].filter(value => typeof value === 'string') : [];
  const known = key => [...new Set(values(key))]
    .filter(value => allowed[key].has(value));
  const searchTerm = typeof query.searchTerm === 'string' ? query.searchTerm : '';
  const page = Number.isSafeInteger(query.page) && query.page >= 1 ? query.page : 1;
  const url = new URL('/api/titles', ctx.baseUrl);
  url.searchParams.set('page', String(page));
  if (searchTerm.trim()) url.searchParams.set('q', searchTerm);

  if (values('availableOnly').includes('true')) {
    url.searchParams.set('available', 'true');
  }
  const author = values('author')[0];
  if (author?.trim()) url.searchParams.set('author', author);
  const format = known('format')[0];
  if (format) url.searchParams.set('format', format);

  // An absent key applies defaults; an explicit [] removes every language.
  const languages = Array.isArray(selected.languages)
    ? known('languages') : languageDefaults;
  for (const value of languages) url.searchParams.append('language[]', value);

  const included = new Set();
  const excluded = new Set();
  for (const raw of values('genres')) {
    if (raw.startsWith('include:') && allowed.genres.has(raw.slice(8))) {
      included.add(raw.slice(8));
    } else if (raw.startsWith('exclude:') && allowed.genres.has(raw.slice(8))) {
      excluded.add(raw.slice(8));
    }
  }
  // Normal UI input is exclusive. For a conflicting stale selection,
  // this example gives inclusion priority.
  for (const value of included) {
    excluded.delete(value);
    url.searchParams.append('genre[]', value);
  }
  for (const value of excluded) url.searchParams.append('excludeGenre[]', value);

  const rawSort = values('sort');
  const sort = allowed.sort.has(rawSort[0])
    ? rawSort[0] : searchTerm.trim() ? 'relevance' : 'popular';
  url.searchParams.set('sort', sort);
  url.searchParams.set('direction', rawSort[1] === 'asc' ? 'asc' : 'desc');
  return {method: 'GET', url: url.href, responseType: 'json'};
}

export function createCatalogMethods(ctx, mapManga) {
  async function search(query) {
    const response = await ctx.http.request(buildSearchRequest(ctx, query));
    if (!response.body || !Array.isArray(response.body.items)) {
      throw Object.assign(Error('Invalid catalog response.'),
        {code: 'parse_error', phase: 'parse'});
    }
    return response.body.items.map(mapManga);
  }
  return {
    async getFilters() { return catalogFilters(); },
    search,
    getPopular({page = 1} = {}) {
      return search({page, searchTerm: '',
        selectedFilters: {sort: ['popular', 'desc']}});
    },
    getLatest({page = 1} = {}) {
      return search({page, searchTerm: '',
        selectedFilters: {sort: ['latest', 'desc']}});
    },
  };
}
```

Для подключения к полному источнику раздела 3 добавьте импорт `createCatalogMethods` из `./catalog-filters.mjs`, внутри createSource создайте `const catalog = createCatalogMethods(ctx, manga)` и включите `...catalog` в возвращаемый объект. Удалите прежние getPopular/getLatest/search/getFilters из этого объекта, чтобы они не перекрывали helper. getDetails/getChapters/getPages/getRecommendations остаются из полного примера.

Этот модуль:

- Возвращает декларации для каждого поддержанного kind и применяет defaults также в обычном каталоге.
- Читает только известные ключи и API values; неизвестные старые значения игнорирует. Не передаёт URL, произвольные поля сортировки или фрагменты запросов из selectedFilters.
- Сохраняет значения текста, корректно кодирует специальные символы один раз, разбирает include/exclude, повторяемые параметры и asc/desc.
- Не хранит состояние активного запроса; несколько search могут работать одновременно.

В зависимости от API используйте GET query, JSON POST либо form POST. Контракт selectedFilters от этого не меняется: источник сам переводит выбор в нужные ID, числа, include/exclude-массивы и поля body. Для form body передайте строку URLSearchParams и соответствующий Content-Type; объект body сам по себе формой не становится.

Нативных kind для диапазона чисел/дат, групп, зависимых dropdown, удалённого autocomplete, собственного HTML или custom widget нет. Диапазон можно выразить двумя text-фильтрами и проверить границы при построении запроса. Dropdown принимает готовый плоский список options; getFilters не получает текст для удалённого поиска options.

#### Динамические options и refresh

Для обновляемой taxonomy объявите `supportsFilterRefresh: true`. UI запрашивает `getFilters({refresh: true})`; обычный вызов приходит с false или без аргумента. Приложение кеширует успешный снимок и объединяет обычные параллельные чтения; ошибка позволяет повторить попытку. Не рассчитывайте, что getFilters обязательно выполнится перед search/getLatest.

Если нужны собственный кеш и принудительное обновление, создавайте их внутри фабрики. Пример `src/filter-cache.mjs`:

```js
export function cachedFilterLoader(loadFilters) {
  let snapshot;
  let pending;
  let generation = 0;
  return async function getFilters({refresh = false} = {}) {
    if (refresh) {
      generation++;
      snapshot = undefined;
      pending = undefined;
    }
    if (snapshot !== undefined) return snapshot;
    if (pending) return pending;
    const current = generation;
    const task = Promise.resolve().then(loadFilters).then(filters => {
      if (!Array.isArray(filters)) {
        throw Object.assign(Error('Invalid filter response.'),
          {code: 'parse_error', phase: 'parse'});
      }
      if (generation === current) snapshot = filters;
      return filters;
    });
    pending = task;
    try { return await task; }
    finally { if (pending === task) pending = undefined; }
  };
}
```

Подключение: `const getFilters = cachedFilterLoader(() => loadFiltersFromSite(ctx))` внутри createSource. `loadFiltersFromSite` должен возвращать полный FilterDto[], проверять исходную структуру и сохранять стабильные API values. Helper не кеширует ошибки и не даёт старому ответу перезаписать новый снимок. Для статических фильтров кеш и refresh не нужны.

Сохраняемые фильтры и позиции привязаны к key/value, поэтому изменение label допустимо, а переименование key/value ломает старые выборки. Если вариант удалён сайтом, не отправляйте его слепо в API; выберите и опишите совместимую политику. Не подменяйте ошибку taxonomy пустым успешным списком.

#### Чипы тайтла и filterBindings

В manifest источника `filterBindings` принимает роли `author`, `artist`, `tags`; значения — **ключи фильтров**, не API IDs вариантов. Например, `{"author": "author", "tags": "genres"}`.

- Author/artist связываются с kind=text и передают полное отображаемое имя одной строкой. При необходимости источник разрешает имя в API ID внутри search.
- Общий MangaDto.tags может содержать жанры, теги, темы и формат. Для них приложение сопоставляет подписи чипов с option.label подходящих singleSelect/multiSelect/triStateMultiSelect.
- Точное совпадение подписи важнее частичного; binding помогает при равенстве совпадений. Совпадение жанра может выбрать фильтр genres даже при предпочтительном binding на tags.
- Для triState нажатый чип становится `include:value`; для single/multi — обычным value. При отсутствии option возможен подходящий text-фильтр; если сопоставления нет, открывается текстовый поиск.
- Возвращайте чистые совпадающие названия, без badge-счётчиков, служебных дочерних надписей и HTML. Не теряйте полные алиасы авторов.

#### Обязательные тесты фильтров

Проверьте каждый kind, отсутствующий ключ против [], дефолтный и очищенный multiSelect, общий reset, все поля и направления sort, фиксированный sort без направления, include/exclude/ignore, конфликт и удалённый option, текст со спецсимволами и запятыми, поиск с пустым searchTerm, смену фильтров на странице >1, параллельные запросы разных выборок, refresh после ошибки и гонку старого/нового снимка. Отдельно проверьте чип жанра, чип тега и author/artist.

### Настройки

Добавьте permission `sourceSettings` и блок `settings` в определение источника, например:

```json
{
  "version": 1,
  "fields": [{
    "key": "titleLanguage", "label": "Title language", "type": "enum",
    "default": "original",
    "options": [
      {"value": "original", "label": "Original"},
      {"value": "english", "label": "English"}
    ]
  }]
}
```

Чтение — `await ctx.settings.get("titleLanguage")`, запись — `await ctx.settings.set("titleLanguage", "english")`. `get("source")` возвращает объявленные поля источника. Поддержаны boolean/string/integer/enum; задайте корректные default и ограничения. Имена `source` и `network` зарезервированы. `roles.titleLanguage` может указывать на соответствующее enum-поле.

### Авторизация

Вход, капча и SSO выполняются в WebView приложения. Расширение объявляет параметры, а не собственный интерфейс входа. Добавьте capability `account`, `features.auth: true`, permission `sourceSession` и блок `auth`:

```json
{
  "profileId": "host.cookie.v1",
  "loginUrl": "https://example.org/login",
  "cookieOrigins": ["https://example.org"],
  "sessionExport": {"headers": ["Cookie"], "values": []}
}
```

Согласуйте `network.authOrigins`, `cookieOrigins` и реальные домены входа/API. Родительский Cookie Domain — отдельное явное разрешение. Не экспортируйте сессию на CDN только ради загрузки изображений. `completionUrl`/`successUrl` задавайте по фактическому сценарию сайта; `features.authCompletion` должен соответствовать декларации.

Для Bearer-сессии используется `host.session.v1` и декларативные `rules`: `bearer`, `cookieAll`/`cookieAny`, `tokenStorageKeys`, `tokenPath`, `tokenFields`, `tokenTypePath`, `tokenType`, `tokenCookieNames`. Экспорт нужных headers/values объявляется явно. Токены из cookies задаются точными именами в `tokenCookieNames`, без wildcard. Чтением хранилища и формированием заголовков занимается приложение.

Обычный HTTP-запрос получает текущую сессию автоматически. Если API требует разрешённый токен в POST body:

```js
const session = await ctx.auth.getSession({url: apiUrl});
const response = await ctx.http.request({
  method: 'POST', url: apiUrl, responseType: 'json',
  authRevision: session.revision, body: {token: session.accessToken},
});
```

Для такого запроса нужны разрешённые POST, URL и экспорт `accessToken`. Передавайте `authRevision`, чтобы смена сессии отменила устаревшую операцию. Не кешируйте и не логируйте токены, cookies, пароли или snapshot сессии.

## 6. Производительность, ограничения и ошибки

- Каждый sourceId имеет отдельные настройки, cookies, токены и браузерный профиль, даже при общем сайте или engine.
- Несколько методов одной фабрики могут выполняться одновременно: по умолчанию 3 операции, пользователь выбирает 1–5. Не храните текущий mangaId, page, временный ответ или изменяемый cursor в общем поле фабрики. Используйте локальные переменные аргументов.
- Для независимых запросов подходит Promise.all в пределах лимитов. Не распараллеливайте зависимые шаги авторизации и пагинацию с общим серверным cursor.
- Для парных Details/Chapters/Recommendations одной страницы переиспользуйте одну загрузку и проекцию через [recent](../src/core/recent.mjs): импортируйте helper в свой проект и создавайте кеш внутри фабрики. По умолчанию это 2 записи и 15 секунд после завершения; одинаковые выполняющиеся запросы объединяются, ошибки удаляются. Каталог с ручным обновлением, POST и операции записи этим кешем не обслуживаются.
- В runtime-пакете разрешены только используемые исходники, данные, иконки и лицензия. Тесты, node_modules, SDK bootstrap и приватные ключи в архив не включаются.

| Ограничение | Значение |
| --- | --- |
| Источники в пакете | 1–64 |
| `network.maxConcurrentRequests` | 1–8; текущие наборы объявляют 6 |
| HTTP scheduler приложения | до 32 запросов одновременно, до 8 на origin; очередь 1024 |
| Загрузка изображений | бюджет 16 общий / 8 на источник; также действуют остальные лимиты |
| HTTP timeout | 250–30000 мс |
| Ожидание операции / выполнение метода | до 30 с в очереди контекста / до 30 с после запуска |
| Очередь операций контекста | до 64 ожидающих, сверх 1–5 активных |
| Тело HTTP-запроса | до 256 КиБ |
| HTTP-ответ text/JSON | до 4 МиБ |
| HTTP-ответ bytes | до 1 МиБ |
| Архив / распакованный payload | до 8 МиБ / 24 МиБ |
| Payload files / manifest | до 128 файлов / 128 КиБ |

Приложение может уменьшать эффективную параллельность. Лимит HTTP не равен числу одновременно выполняющихся методов источника.

При изменении структуры ответа возвращайте `parse_error` или `invalid_response`, а не ложный успешный пустой каталог. Пустой список означает реальное отсутствие результатов или конец пагинации. Стандартные коды также включают `auth_required`, `challenge_required`, `rate_limited`, `not_found`, `chapter_unavailable`, `timeout` и `cancelled`; полный список — в API types. Безопасная ошибка: `Object.assign(Error("Unexpected catalog response."), {code: "parse_error", phase: "parse"})`.

Сохраняйте исходный код ошибки брокера. Не маскируйте 403/challenge/429 перебором доменов, не повторяйте автоматически POST и логин. В `ctx.log.info(event, fields)` передавайте короткие диагностические данные без секретов.

## 7. Тесты перед выпуском

Минимальный тест `tests/source.test.mjs` для примера из раздела 3:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import createSource from '../src/index.mjs';

test('factory is offline and search encodes input once', async () => {
  const calls = [];
  const source = createSource({
    baseUrl: 'https://example.org',
    http: {async request(input) {
      const url = new URL(input.url);
      calls.push(url);
      return {status: 200, url: url.href, headers: {},
        body: {items: [{id: 'title/1', title: 'Example'}]}};
    }},
  });
  assert.equal(calls.length, 0);
  const result = await source.search({
    searchTerm: 'A & B', page: 2,
    selectedFilters: {sort: ['latest'],
      genres: ['include:action', 'exclude:horror']},
  });
  assert.equal(result[0].id, 'title/1');
  assert.equal(calls[0].searchParams.get('q'), 'A & B');
  assert.equal(calls[0].searchParams.get('page'), '2');
  assert.equal(calls[0].searchParams.get('sort'), 'latest');
  assert.equal(calls[0].searchParams.get('genres'), 'action');
  assert.equal(calls[0].searchParams.get('excludeGenres'), 'horror');
});
```

Для своего проекта: `node --test tests/*.test.mjs`. В этих репозиториях: `npm test`.

Покройте первую/следующую/пустую страницу, специальные символы поиска, очистку фильтров, include/exclude, сортировки, malformed JSON/HTML, дробные главы, ограничения доступа, URL изображений и рекомендации. Проверьте offline-фабрику, независимые экземпляры и одновременные методы без смешивания данных.

Перед публикацией проверьте в приложении каталог, карточки, чтение и изображения, зеркало, вход/выход и смену сессии. Убедитесь, что обновление пакета сохраняет ID и пользовательские данные. Отдельно проверьте доступные целевые платформы; тест парсера не подтверждает работу сайта, аккаунта и WebView.

## 8. Подпись и локальный импорт

Выберите собственную лицензию и убедитесь в правах на распространяемые исходники, данные и изображения. Код этих репозиториев имеет лицензию **«Все права защищены»**; публикация на GitHub сама по себе не разрешает его перераспространение. Сохраните лицензии используемых сторонних компонентов.

Создайте Ed25519-ключ в приватном каталоге. `.keys/` исключён из Git; ключ не должен попасть в commit, release assets, логи или примеры:

```powershell
node tools/pack.mjs --generate-key .keys/publisher.pem --key-id my-publisher-2026
```

Упаковка отдельного проекта:

```powershell
node tools/pack_extension.mjs --project ./my-sources --key .keys/publisher.pem --key-id my-publisher-2026 --output ./dist/my-sources.mlsource
```

Версия отдельного проекта берётся из его `manifest.json`. Для текущего зарегистрированного набора используйте `node tools/pack.mjs --key .keys/publisher.pem --key-id my-publisher-2026 --version 1.0.0` либо `./build-package.ps1 -KeyPath .keys/publisher.pem -KeyId my-publisher-2026 -Version 1.0.0`. Имя архива по умолчанию зависит от репозитория, см. таблицу в разделе 1.

Упаковщик создаёт `.mlsource`, `.mlsource.public.json` и `.mlsource.sha256`, подписывает manifest, записывает hash/size payload и проверяет полученный архив. Пакет воспроизводим для одинаковых файлов, версии и ключа.

Импортируйте public record и пакет через настройки расширений, независимо сверьте SHA-256 fingerprint публичного ключа и его разрешённые extensionIds, затем подтвердите издателя и permissions. Файл `.public.json` рядом с архивом помогает сверке, но не устанавливает доверие сам. Локальный тестовый ключ не является production-ключом.

<a id="publishing"></a>

## 9. Публикация на GitHub

### Ручной выпуск собственного пакета

Правила одинаковы для локальной публикации и CI:

1. Выпускайте проверенный commit с новой SemVer-версией; опубликованную версию и её байты не перезаписывайте.
2. `extensionId`, source IDs и publisher key сохраняйте при обычном обновлении. Смену или отзыв ключа оформляйте явно; новый ключ из скачанного пакета не может сам себя одобрить.
3. Добавьте подписанный индекс, связывающий репозиторий, версию, tag, архив, hash и source IDs:

```powershell
node tools/sign_repository_index.mjs --repo owner/repo --serial 1 --tag v1.0.0 --package ./dist/my-sources.mlsource --key .keys/publisher.pem --output ./dist
```

`serial` — положительное строго возрастающее число для репозитория; не сбрасывайте его при переносе workflow. Один serial не должен обозначать разные данные. Индекс действует 30 дней; публикуйте актуальные метаданные до истечения срока. Подпись `extensions-index.ed25519` — отдельный бинарный файл, не JSON/base64. Подпись индекса не заменяет подпись пакета.

Если собственный репозиторий не публикуется автоматическим workflow, создайте tag на проверенном commit и GitHub Release с пятью файлами:

```powershell
git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 ./dist/my-sources.mlsource ./dist/my-sources.mlsource.public.json ./dist/my-sources.mlsource.sha256 ./dist/extensions-index.json ./dist/extensions-index.ed25519 --repo owner/repo --verify-tag --title "My Unofficial Sources 1.0.0" --notes "Signed source package."
```

Для prerelease используйте SemVer-суффикс и отметку prerelease на GitHub. Release notes должны указывать изменения источников, минимальную версию приложения, новые разрешения и известные ограничения проверки. Публично распространяются пакет, публичный ключ/record, checksum и подписанный индекс; приватный ключ не публикуется.

### Готовый workflow этих репозиториев

Файл [release.yml](../.github/workflows/release.yml) рассчитан на существующий набор и имя архива из раздела 1. Для своего отдельного пакета адаптируйте IDs, пути и команды упаковки; не запускайте неизменённый workflow в расчёте на произвольный проект.

В отдельном репозитории настройте защищённую основную ветку и environment из таблицы:

- Variable `MLSOURCE_PUBLISHER_KEY_ID` — идентификатор доверенного ключа издателя.
- Secret `MLSOURCE_SIGNING_KEY_BASE64` — base64 полного приватного Ed25519 PEM в формате PKCS#8. Подготовьте значение локально и храните только как секрет environment.
- При необходимости добавьте reviewers и ограничения release tags.

Push SemVer-тега `vVERSION` автоматически запускает выпуск. Для ручного запуска workflow укажите существующий tag/ref и `version` без `v`; tag должен ссылаться на выполняемый commit. Workflow повторно запускает тесты, подписывает пакет и индекс, публикует пять файлов. Индексный serial вычисляется как `GITHUB_RUN_NUMBER * 100 + GITHUB_RUN_ATTEMPT`.

Проверки PR и основной ветки выпускают только тестовые артефакты, не релизы. Приватный release-ключ доступен только защищённому environment. Обновления устанавливаются после проверки подписи, версии, владения ID и разрешений пользователем.

<a id="api-reference"></a>

## 10. Справочник контрактов API v1

Эти контракты описывают данные расширения, а не ответы конкретного сайта. Полный нормативный набор полей — в [source-api.d.ts](../sdk/source-api.d.ts) и схемах SDK. Не добавляйте неописанные поля в manifest: его объекты проверяются строго. Дополнительное поле DTO не создаёт новую возможность UI.

### 10.1. Тайтлы, главы, доступ, страницы и рекомендации

```ts
type Json = null | boolean | number | string | Json[]
  | {[key: string]: Json};

interface MangaDto {
  id: string; title: string;
  coverUrl: string | null; description: string | null;
  secondaryTitle: string | null; author: string | null; artist: string | null;
  status: string | null; type: string | null; ageRating: string | null;
  rating: number | null; releaseYear: string | null;
  pageCount: number | null; languageFlagUrl: string | null; tags: string[];
}
interface ChapterAccessDto {
  type: 'available' | 'temporarilyUnavailable' | 'paid';
  availableAt: string | null; priceLabel: string | null; message: string | null;
}
interface ChapterDto {
  id: string; title: string; number: number; uploadedAt: string | null;
  access: ChapterAccessDto;
}
interface PageDto {index: number; imageUrl: string;}
interface RecommendationPageDto {
  items: MangaDto[]; page: number; hasNextPage: boolean;
}
```

| Поле/результат | Правила |
| --- | --- |
| MangaDto.id, ChapterDto.id | Непустые стабильные строки. Это не обязательно число или URL; составные ID допустимы. Не меняйте формат при смене домена. |
| title | Непустой отображаемый текст, без HTML; title отсутствующего тайтла не заменяется фиктивным названием. |
| coverUrl, languageFlagUrl | Абсолютный HTTPS URL или null, с разрешённым image origin. Не используйте data:/blob: или относительный путь. |
| description | Строка или null, до 256 Ки символов; не возвращайте весь документ сайта. |
| secondaryTitle, author, artist, status, type, ageRating, releaseYear | Строки или null. Универсальных enum для status/type/ageRating нет. releaseYear — строка, не число. |
| rating | Конечное число или null; wire не задаёт универсальную шкалу и не нормализует рейтинг автоматически. |
| pageCount | Неотрицательное целое безопасного диапазона JavaScript либо null. |
| tags | Массив до 512 непустых строк; подписи должны совпадать с названиями жанров/тегов в options для переходов по чипам. |
| ChapterDto.number | Конечное число; не округляйте дробные главы и не используйте строку. |
| uploadedAt, availableAt | ISO-8601 timestamp с часовым поясом Z либо ±HH:MM или null. Рекомендуется UTC. Дата без времени/пояса не подходит; календарная дата должна существовать. |
| access.type | available — можно читать; temporarilyUnavailable — ожидается доступность, при наличии передайте availableAt; paid — платно, при наличии передайте priceLabel/message. |
| PageDto.index | Ровно позиция в массиве: 0, 1, 2… Порядок — порядок чтения; индексы с 1 и дубликаты отклоняются. |
| PageDto.imageUrl | Обязательный абсолютный HTTPS URL, включая нужные signed query-параметры. |
| RecommendationPageDto.page | Целое от 1; items — обычные MangaDto[], hasNextPage — boolean, не 0/1 и не строка. |

Прочие DTO-строки ограничены 16384 символами без NUL; обязательные строки не могут быть пустыми/пробельными. Общие списки тайтлов/глав/страниц принимают до 100000 элементов, но объём ответа и время выполнения дополнительно ограничены. Список глав с повторяющимся id отклоняется целиком.

getPopular/getLatest/search возвращают **только массив** тайтлов, без `{items, total, hasNextPage}`. Конец списка — настоящий пустой массив; не скрывайте ошибку парсера под концом пагинации. getRecommendations использует отдельную обёртку с hasNextPage. Не возвращайте неполное превью главы как полную страницу.

### 10.2. Контекст и операции HTTP

```ts
interface HttpRequestDto {
  method: 'GET' | 'POST' | 'HEAD';
  url: string;
  responseType: 'text' | 'json' | 'bytes';
  headers?: Record<string, string>;
  body?: Json;
  authRevision?: number;
  timeoutMs?: number;
  userAgentProfile?: 'app' | 'browser' | 'reader' | 'mobileSafari';
}
interface HttpResponseDto {
  status: number;
  url: string;
  headers: Readonly<Record<string, string>>;
  body: Json;
}
interface SourceAuthSessionV1 {
  readonly authorized: boolean;
  readonly revision: number;
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly cookieHeader?: string;
  readonly accessToken?: string;
  readonly csrfToken?: string;
}
interface SourceContextV1 {
  readonly sourceId: string;
  readonly baseUrl: string;
  readonly parameters: Readonly<Record<string, string>>;
  readonly http: {request(input: HttpRequestDto): Promise<HttpResponseDto>};
  readonly html: {
    extract(body: string, projection: HtmlProjectionDto): Promise<Json>;
  };
  readonly settings: {
    get(key: string): Promise<Json>;
    set(key: string, value: Json): Promise<void>;
  };
  readonly auth: {
    status(): Promise<{authorized: boolean; revision: number}>;
    getSession(input: {url: string}): Promise<SourceAuthSessionV1>;
  };
  readonly log: {
    info(event: string, fields?: Record<string, string | number | boolean>): void;
  };
}
```

`sourceId`, `baseUrl` и `parameters` выдаёт приложение. parameters — подписанные константы manifest для настройки общей фабрики, не пользовательские настройки и не место для секретов. Вызовы http/html/settings/auth выполняются только внутри методов источника.

| Поле HTTP-запроса | Правила |
| --- | --- |
| method, url, responseType | Обязательны; метод разрешён network.methods. URL — HTTPS без credentials и fragment, в разрешённом origin с тем же портом. В сетевом брокере URL ограничен 8192 символами. |
| headers | Необязательный объект до 16 строковых заголовков. Имена без учёта регистра, дубли после нормализации запрещены; значение до 4096 символов без управляющих символов. |
| body | Только для POST. Строка отправляется как UTF-8 текст; другие JSON-значения — как JSON. Объект не превращается в form автоматически. Отсутствующий/null body не отправляется. |
| timeoutMs | По умолчанию 20000, целое 250–30000. Включает ожидание очереди, перенаправления и обработку ответа. |
| userAgentProfile | Приоритет: поле запроса → network.userAgentProfile → app. Media имеет отдельный media.userAgentProfile. При необходимости согласуйте HTTP, WebView и media с реальным сценарием сайта. |
| authRevision | Неотрицательное безопасное целое из getSession; требует sourceSession. Это защита от использования устаревшего снимка, а не токен. |

Разрешённые request headers: Accept, Content-Type, Accept-Language, Site-Id, X-Service-Name, X-Requested-With, X-Client-Version, HX-Request, App-Id, App-Version; дополнительно разрешены проверяемые Referer и Origin. Другие произвольные заголовки не принимаются. Origin должен быть ровно origin без пути; Referer может содержать путь разрешённого сайта.

При строковом body Content-Type по умолчанию `text/plain; charset=utf-8`, при JSON body — `application/json`, если заголовок не задан явно. Пример form POST внутри асинхронного метода:

```js
const body = new URLSearchParams({q: 'A & B', page: '1'}).toString();
const response = await ctx.http.request({
  method: 'POST',
  url: new URL('/api/search', ctx.baseUrl).href,
  responseType: 'json',
  headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'},
  body,
});
```

HEAD может проверять также разрешённый image origin и не возвращает тело изображения. GET не принимает body. После GET/HEAD обрабатываются до 5 redirects с повторной проверкой URL и сессии; redirect POST не воспроизводится автоматически.

Успешный ответ содержит конечный url, status, body и безопасные headers с ключами в нижнем регистре: content-type, content-length, cache-control, etag, last-modified, retry-after, location, x-total-count, cf-mitigated. Set-Cookie не передаётся скрипту; приложение применяет cookies отдельно в разрешённой сессии.

responseType=text возвращает строку, json — разобранное JSON-значение, bytes — массив чисел 0–255. HTTP-кодировка учитывается, включая объявленный Windows-1251. При неподдерживаемой кодировке или повреждённом JSON верните/сохраните осмысленную ошибку, а не угадывайте структуру.

Не-2xx ответ вызывает SourceHostError: 401 → auth_required, 403 → access_denied, 404 → not_found, 429 → rate_limited, прочие → invalid_response; при `cf-mitigated: challenge` — challenge_required. При необходимости разбирайте безопасный `error.body` своего endpoint для определения доступа. Не рассчитывайте получить обычный response.status=404 вместо исключения.

### 10.3. Все поля HTML-проекции

Один узел проекции содержит **ровно один режим результата**: fields, text=true, attr, html=true, outerHtml=true, tagName=true либо containsText. Остальные поля управляют выборкой. `baseUrl` задаётся на верхнем уровне вызова ctx.html.extract; вложенные поля наследуют его.

| Поле | Тип и действие |
| --- | --- |
| baseUrl | Необязательный абсолютный HTTPS URL для разрешения ссылок; используйте конечный response.url. |
| selector | CSS selector, 1–1024 символа; без selector используется текущий узел. Скрипты/браузерные обработчики не выполняются. |
| fields | Объект до 64 именованных вложенных проекций; имя результата 1–256 символов. |
| all | Boolean; true возвращает массив, иначе первый результат либо null. |
| required | Boolean; отсутствие узла, null или пустая строка приводят к ошибке. |
| text | Boolean; true возвращает trim/нормализованный текст узла. |
| attr | Имя HTML-атрибута, 1–128 символов из букв/цифр/_/:-; отсутствующий атрибут даёт null. |
| html / outerHtml | Boolean; соответственно содержимое элемента или элемент целиком. Используйте только когда проекции полей недостаточно. |
| absoluteUrl | Boolean; разрешает непустую строку ссылки относительно baseUrl, результат должен быть HTTPS. |
| textEquals | Строка до 4096 символов; точное сравнение с нормализованным текстом, с учётом регистра. |
| ascend | Целое 0–8; подняться к родителю после выбора узла. |
| nextSibling | Boolean; после ascend перейти к следующему element sibling, не текстовому узлу. |
| directChildren | Boolean; оставить только непосредственных детей текущего узла. |
| tagName | Boolean; true возвращает имя тега в нижнем регистре. |
| exclude | CSS selector до 1024 символов; только совместно с text=true, исключает потомков из копии узла. |
| normalizeWhitespace | Boolean; только для text=true. false сохраняет внутренние пробелы, но внешние всё равно обрезаются. |
| containsText | 1–8 непустых строк до 256 символов; boolean-проверка хотя бы одной буквальной подстроки без учёта регистра. Это отдельный режим, не regex. |

Глубина вложенности — до 8, совпадений CSS selector — до 10000. Бюджет всего результата — до 100000 узлов и 1 Ми символов текстов/ключей. Вход HTML — до 8 Ми символов, HTTP-лимит может ограничить его раньше. Отсутствующие необязательные поля возвращаются null, all без совпадений — []; required превращает отсутствие в ошибку.

### 10.4. Поля manifest и согласованность возможностей

| Блок | Поля и правила |
| --- | --- |
| Формат пакета | schemaVersion=1, sourceApiVersion=1, minRuntimeAbi=1. minAppVersion — минимальная совместимая SemVer-версия приложения. |
| Идентичность | extensionId и sources[].id: до 128 символов, строчные латинские буквы/цифры и сегменты через точку/дефис. version — SemVer, publisherKeyId — ID вашего ключа. |
| Описание | name, license; необязательные homepage (HTTPS), icon (локальный подписанный asset). LICENSE обязателен для упаковки. |
| Исполнение | entrypoint — относительный путь к .mjs. files содержит относительные пути payload → {size, sha256}; заполняется упаковщиком. Пути без .., абсолютных частей и symlinks. |
| Permissions | http → сеть, html → проекции, sourceSettings → объявленные настройки, sourceSession → сессия/авторизация. Наличие метода в ctx не означает выдачу permission. |
| Регистрация источника | id, name, language, baseUrl, engine, status, capabilities, features, network, media. language: all/ru/en; status: stable/experimental. |
| Флаги | isNsfw, metadataOnly, supportsCustomBaseUrl, supportsFilterRefresh — booleans. Не имитируйте поддержку функции одним флагом. |
| Capabilities | browse/latest/search/filters/account/recommendations; для объявленной возможности реализуйте соответствующий метод. account использует host auth, не JS login. |
| Features | webLinks требует web; auth требует auth и account; authCompletion требует auth и completionUrl/successUrl; recommendations согласуется с capability и методом. |
| parameters | До 32 именованных строковых констант, значение 1–1024 символа; доступны через ctx.parameters. |
| filterBindings | Необязательные роли author/artist/tags со значением — ключом фильтра, до 128 символов. |
| web | mangaUrlTemplate, idEncoding, необязательный idPart {separator, index}; ровно один {id}, локальный путь, без // внешнего адреса. |
| branding | icon — локальный PNG/JPEG/WebP, accentColor — #RRGGBB. Для значка пакета используется отдельное верхнеуровневое icon. |
| presentation | coverFit: contain/cover. |
| network | origins/imageOrigins/authOrigins (до 128 origins на список), allowSubdomains, methods, maxConcurrentRequests; необязательные userAgentProfile, transportProfile, cookieDefaults. |
| media | userAgentProfile, refererOrigin, sendOrigin; необязательный transform. |
| auth / settings | Отдельные декларации ниже; они не исполняют произвольные callbacks. |

allowSubdomains относится к HTTP/image, **не расширяет authOrigins**. Cookies и credentials требуют точных разрешённых origins. Для IDN используйте нормализованные HTTPS URL. Разные порты — разные origins.

cookieDefaults — до 16 публичных настроечных cookies с origin/name/value и необязательным path (по умолчанию /). Они применяются только к совпавшим origin/path. Не помещайте туда пользовательские сессии и пароли.

media.transform поддерживает только algorithm=xor, key (1–256 байтов 0–255), origin, pathPrefix, stemLength (1–256), markerOffset (0–255) и marker (один символ). Это общий алгоритм с параметрами формата сайта; он не расширяет image grants. Не используйте его вместо исправления неверного URL/авторизации.

### 10.5. Поля настроек и авторизации

settings.version — целое 1–1000; fields — до 32 описаний. Каждое содержит key, label, type и default. key соответствует `[a-z][A-Za-z0-9_.-]{0,63}`, source/network зарезервированы; label — 1–128 символов.

| type | Значение и ограничения |
| --- | --- |
| boolean | default и значение — true/false, не строки. |
| string | Строка; maxLength при объявлении — 1–4096. |
| integer | Целое; необязательные min/max, границы декларации от -1000000 до 1000000. default должен соответствовать границам. |
| enum | Строковый value из options; 1–64 варианта {value, label}, value до 256 символов. default должен присутствовать в options. |

roles.titleLanguage ссылается на объявленный enum ключ. Необязательный legacyNamespace используется для совместимости существующих source-owned настроек, не создаёт общий доступ разных источников. Нельзя читать произвольные настройки приложения через ctx.settings. Перед записью проверяйте тип и declared constraints; set возвращает Promise<void>.

auth содержит profileId, loginUrl, cookieOrigins (до 16), sessionExport; rules необязателен. Если features.authCompletion=true, обязательны оба completionUrl и successUrl; иначе не добавляйте их.

| rules | Назначение |
| --- | --- |
| bearer | Boolean; использовать обработку Bearer-токена. |
| cookieAll / cookieAny | Все/хотя бы одно из имён непустых cookies. Допустим конечный * для префикса имени; это проверка наличия, а не экспорт credentials. |
| tokenStorageKeys | Имена записей browser localStorage, из которых извлекается токен. |
| tokenPath | Массив ключей вложенного JSON до значения токена. |
| tokenFields | Кандидатные поля токена в объекте/вложенном JSON-значении. |
| tokenTypePath / tokenType | Путь к типу токена и ожидаемое значение типа. |
| tokenCookieNames | Точные имена cookies с токеном; требуют bearer=true, wildcard запрещён. Значение декодируется из cookie. |

Списки rules — до 16 строк, каждая 1–128 символов; tokenType — до 32. sessionExport.headers допускает Cookie, Authorization, X-XSRF-TOKEN, X-CSRF-TOKEN, а values — accessToken и csrfToken. Экспортируйте только необходимое.

ctx.auth.status() возвращает authorized/revision; это состояние текущего источника. getSession({url}) возвращает снимок для конкретного разрешённого URL. headers, cookieHeader, accessToken и csrfToken доступны только в пределах разрешённого экспорта; опциональные поля могут отсутствовать. Проверяйте наличие нужного значения, не приводите undefined к строке. Снимок меняется при выходе/смене аккаунта; обычные HTTP-вызовы получают свежую сессию автоматически.

Ограничения min/max допустимы только у integer, maxLength — только у string, options — только у enum. Без явных границ integer использует -1000000…1000000, string — maxLength=4096. Строковые настройки не принимают управляющие символы; default проверяется теми же правилами, что пользовательское значение.

### 10.6. Ошибки и диагностический контракт

SourceHostError — Error с code и phase; дополнительно могут быть httpStatus, retryAfterSeconds, access, body. phase — короткая строка этапа, а не stack/HTML/токен. Сохраняйте код исходной ошибки; для собственного отказа добавьте code/phase к Error.

Полный union кодов API v1:

```text
cancelled, timeout, offline, network, rate_limited, auth_required,
challenge_required, not_found, title_not_found, chapter_not_found,
chapter_unavailable, parse_error, invalid_response, permission_denied,
unsupported, incompatible_api, resource_limit, runtime_crashed,
auth_session_changed, source_unavailable, access_denied
```

not_found — общий ответ отсутствия; title_not_found/chapter_not_found точнее описывают отсутствие сущности. chapter_unavailable с access передаёт ограничение чтения. permission_denied означает нарушение grants/контракта вызова; unsupported — неподдерживаемую возможность; resource_limit — исчерпанный бюджет. Отмена и смена сессии не являются пустым успешным результатом.

ctx.log.info принимает event и объект только из string/number/boolean. Не передавайте большие ответы, Error-объекты, массивы cookies или персональные данные.

### 10.7. Контракт подписанного индекса

Индекс — объект schemaVersion=1, repositoryId (owner/repo в нижнем регистре), serial, generatedAt, expiresAt, publisherKeyId, channel и packages. channel: stable/prerelease; timestamps — UTC с секундной точностью и Z.

Каждая запись packages содержит extensionId, version, releaseTag, assetName, size, sha256, sourceApiVersion, minRuntimeAbi, minAppVersion, sourceIds и channel. Эти значения сверяются с независимо проверенным архивом. Не указывайте внешний download URL вместо assetName. Схема допускает до 128 пакетов, но предоставленный sign_repository_index.mjs формирует индекс одного переданного архива.

Канонический manifest подписывается Ed25519 с префиксом `MangaLaunch source package v1\n`, индекс — с `MangaLaunch source repository v1\n`; подписи не взаимозаменяемы. Используйте инструменты упаковки/подписи вместо ручной конкатенации JSON. Истёкший индекс препятствует обновлению метаданных, но уже установленный пакет продолжает работать offline. Отзыв ключа и pinning не обходятся старым архивом или удалением репозитория из списка.
