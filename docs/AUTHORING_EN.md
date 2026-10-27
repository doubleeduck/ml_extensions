# Creating and publishing MangaLaunch extensions

[Russian](AUTHORING_RU.md)

Sections: [complete source example](#source-example) · [filter contract](#filter-contract) · [publication](#publishing) · [DTO, ctx and manifest reference](#api-reference).

A guide to Source API v1: creating a package, implementing a source, testing, signing and publishing. An extension is a signed `.mlsource` file containing one or more sources. A source is a separate website registration with its own ID, settings and session.

The contract is defined by the [API types](../sdk/source-api.d.ts), [manifest schema](../sdk/manifest.schema.json) and [repository index schema](../sdk/repository-index.schema.json). The examples use a fictional `example.org` API: they demonstrate the structure and are not a working source for a real website.

## 1. Prerequisites and layout

Use Node.js 22 or later. Run commands from the extension repository root.

```powershell
npm ci --ignore-scripts
npm rebuild esbuild
npm test
```

Inspect the website's responses: catalog and pagination, search, filters, details, chapters, pages, recommendations, login, redirects and image domains. Prefer an available structured API; otherwise use HTML projections.

For a separate package, copy the [template](../templates/json-api) into your own project directory and replace the fictional URLs, IDs, license and implementation:

```text
my-sources/
  manifest.json
  LICENSE
  src/
    index.mjs
  assets/               # optional
  tests/
    source.test.mjs
```

To add a source to an existing bundle, add its module under `src/sources/` or a shared factory under `src/engines/`, a registration in `src/definitions.mjs` and the ID → factory mapping in `src/index.mjs`. Update the registration and module tests.

| Repository | Content | Existing extensionId | Default archive | GitHub environment |
| --- | --- | --- | --- | --- |
| `ml_extensions` | Non-NSFW sources | `official.mangalaunch.sources` | `official.mangalaunch.sources.mlsource` | `official-source-release` |
| `nsfw_ml_extensions` | NSFW sources | `official.mangalaunch.nsfw.sources` | `official.mangalaunch.nsfw.sources.mlsource` | `official-nsfw-source-release` |

The display name of these packages is **Unofficial Extensions**. Existing technical IDs and archive names are retained for updates. For a new independent package, choose your own unique `extensionId`, publisher key and source IDs; do not use someone else's namespace. Publish NSFW sources in the separate appropriate package and mark them `isNsfw: true`.

Source, manga and chapter IDs must remain stable: the library, history and progress depend on them. A domain change is not an ID change. Do not move an already published sourceId to another package or publisher: uninstalling a package does not release its registered ownership.

## 2. Manifest for a separate package

Save this as `manifest.json`. The empty `files` object is a placeholder: the packer adds payload sizes and SHA-256 hashes and creates the signature. Do not manually edit a signed manifest.

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

Declaration rules:

- `capabilities` and `features` must match the implemented methods. Set `metadataOnly: true` for a metadata-only source; do not advertise reading support.
- `origins` covers HTML/API, `imageOrigins` covers covers, language flags and reader pages, and `authOrigins` covers domains allowed to receive authentication. Declare exact HTTPS origins without paths. Subdomains require explicit `allowSubdomains`.
- Allow only the required methods and permissions: `http`, `html`, `sourceSettings`, `sourceSession`. Do not grant CDN or login domains speculatively.
- For mirror support, declare `supportsCustomBaseUrl: true`, use the current `ctx.baseUrl` and test API, image and login behavior on the mirror. Do not globally replace independent API/CDN domains.
- A manga web link uses `web.mangaUrlTemplate` with one `{id}`. `idEncoding` is `pathSegment` or `path`; composite IDs can use `idPart: {separator, index}`.
- Source branding uses `branding: {icon: "assets/site.png", accentColor: "#123456"}`. PNG/JPEG/WebP icons must be local signed files of at most 256 KiB. Branding belongs to the extension.
- `presentation.coverFit` accepts `contain` or `cover`. `network.transportProfile: "host.platform.v1"` selects the platform HTTP/media transport. Declare the minimum application version supporting the features you use.

<a id="source-example"></a>

## 3. Implementing a source

The entry point is a synchronous `export default function createSource(ctx)` returning a method object. Imports and factory creation must not perform HTTP, HTML, settings or authentication operations: packages are also checked offline.

The runtime provides JavaScript, Promise, URL/URLSearchParams and UTF-8 TextEncoder/TextDecoder. Node.js, `process`, `require`, filesystem, sockets and browser DOM are unavailable. Imports must be relative paths to signed package files; remote dependencies are not loaded.

| Method | Arguments | Result |
| --- | --- | --- |
| `getPopular` | `{page}` | `MangaDto[]`, capability `browse` |
| `getLatest` | `{page}` | `MangaDto[]`, capability `latest` |
| `search` | `{searchTerm, page, selectedFilters}` | `MangaDto[]`, capability `search` |
| `getFilters` | `{refresh?}` | `FilterDto[]`, capability `filters` |
| `getDetails` | `{mangaId}` | `MangaDto`, required method |
| `getChapters` | `{mangaId}` | `ChapterDto[]`, required method |
| `getPages` | `{mangaId, chapterId}` | `PageDto[]`, required method |
| `getRecommendations` | `{mangaId, page}` | `{items, page, hasNextPage}`, capability `recommendations` |

A complete starting point for the fictional JSON API, in `src/index.mjs`:

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

This API returns `{items: [...]}` for catalogs and chapters, a manga object for details, `{images: [...]}` for pages, and `{items: [...], hasNextPage: boolean}` for recommendations. Replace that contract with the website's actual responses.

All results must be JSON data. Return nullable DTO fields as `null` and arrays as arrays; do not return `undefined`, `NaN`, functions or DOM objects. Image URLs must be absolute. Pagination starts at 1; `PageDto.index` starts at 0, without gaps or duplicates. Chapter IDs must be unique; numbers must be finite and retain fractional values. Dates use ISO-8601 with a timezone (UTC recommended) or `null`.

Preserve `available`, `temporarilyUnavailable` or `paid` in `ChapterDto.access`, together with available `availableAt`, `priceLabel` and `message` information. Paid access must not become a generic network error. A metadata-only source implements the required chapter and page methods by returning empty arrays.

## 4. HTTP, HTML and images

Make all network requests through `ctx.http.request`. The application applies the session and allowed transport parameters. HTTPS, origin, port and permission checks also apply to every redirect.

Do not inject arbitrary `Cookie`, `Authorization`, `Host` or `User-Agent` headers. Use session declarations and `userAgentProfile`: `app`, `browser`, `reader`, `mobileSafari`. `Referer` and `Origin` must belong to allowed origins. Public API headers are subject to the supported network policy.

For HTML, prefer one nested projection over many sequential calls:

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

Run this inside an asynchronous source method and add the `html` permission. Projection results are data, not a live DOM. Available fields include `fields`, `all`, `required`, `text`, `attr`, `absoluteUrl`, `html`, `outerHtml`, `ascend`, `nextSibling`, `directChildren` and `tagName`.

`exclude` removes matching descendants from text projections; `normalizeWhitespace: false` preserves internal whitespace. `containsText: ["term"]` returns a boolean for 1–8 literal substrings of up to 256 characters each. This mode cannot be combined with other value modes and does not execute regex.

Return image URLs from `getPages`, not image bytes or base64. The media broker handles cover/page loading, caching, headers and sessions. Preserve signed CDN URL parameters. Supported image transformations use declarative `media.transform`; arbitrary manifest decoders are not executed.

## 5. Filters, settings and authentication

<a id="filter-contract"></a>

### Filters: complete contract

#### Declaration, request and response are different data

1. Declare the `filters` capability and implement `getFilters({refresh?})`.
2. Return a **FilterDto array** from getFilters, not `{filters: [...]}`, selected values or HTTP parameters. Array order determines filter order; options order determines option order.
3. The application builds controls from that array and sends the selection to `search({searchTerm, page, selectedFilters})`.
4. The source translates that selection into the website's API/HTML request and returns `MangaDto[]`. Keys are not automatically mapped to website query/body parameters.

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

| FilterDto field | Contract |
| --- | --- |
| `key` | A nonempty stable string, unique throughout the filter list. Selections use this key. `genres`, `format` and `sort` are conventions, not required names. |
| `label` | A nonempty user-facing label. Do not use it as an API ID. |
| `caption` | An explanation or `null`; plain text, not HTML controls. |
| `kind` | Exactly one of the six types below; arbitrary types are unsupported. |
| `options` | An array of `{value, label, caption}`. Use `[]` for toggle/text; enumerate options for other kinds. |
| `defaultValues` | An array of API values. A nonempty array is allowed **only for multiSelect**, and every value must exist in options. Use `[]` for other kinds. |
| `supportsDirection` | An optional boolean, default `true`. Relevant to sort; `false` hides direction selection. |

In FilterOptionDto, `value` is a string API ID, `label` is a nonempty display name, and `caption` is an explanation or `null`. Numeric website IDs are also strings, such as `"42"`; convert them to numbers only when constructing a request if the API requires it. Values must be unique within a filter. Identical labels with different values are technically possible but make chips ambiguous.

An empty `option.value: ""` is allowed for a neutral option such as Any. In singleSelect/sort, choosing it effectively clears the selection; do not use an empty string as a meaningful ID. Empty strings are not allowed in defaultValues. The UI does not use options on toggle/text.

Return all contract fields explicitly, including `caption: null`, `options: []` and `defaultValues: []` where empty. Some omitted arrays are accepted as empty for compatibility; this does not permit an arbitrary DTO shape.

Decoding limits: **256 filters**, **10000 options** and **10000 defaultValues** per filter. Key/label/value/caption strings are limited to 16384 characters without NUL; required strings cannot be whitespace-only. Choose short machine keys, especially for filterBindings, whose key references are limited to 128 characters. Duplicate keys, duplicate values, unknown kinds, invalid supportsDirection and unsupported defaults reject the entire list.

#### How each kind transmits its selection

selectedFilters contains no booleans, numbers, nulls, nested objects or scalar strings: **every key maps to string[]**. Options.value and key are case-sensitive; do not localize or pre-encode them.

| kind | Example selectedFilters entry | Neutral state and handling |
| --- | --- | --- |
| `toggle` | `"availableOnly": ["true"]` | Disabling removes the key. Check `values.includes("true")`; the UI does not send `"false"`. |
| `text` | `"author": ["Name One, Name Two"]` | One string in the first element. Empty input removes the key. Do not expect an array of separate terms. |
| `singleSelect` | `"format": ["manga"]` | One API value. No selection means an absent key; also treat `[]` as no selection. |
| `multiSelect` | `"languages": ["en", "ru"]` | Bare values without prefixes. An absent key means defaults; explicit `[]` clears everything. |
| `triStateMultiSelect` | `"genres": ["include:action", "exclude:horror"]` | Each value is ignored/included/excluded. Ignore is omitted; an empty selection removes the key. |
| `sort` | `"sort": ["latest", "desc"]` or `["title", "asc"]` | First element is the field, second is direction. Without the second, the UI assumes desc. With supportsDirection=false, only `["latest"]` is sent. |

The text editor may display terms as chips and join enabled terms with `, `. The wire value remains one string. There is no universal CSV, quoting, author-ID-list or search-syntax contract: the source defines its meaning and explains it in caption. Preserve aliases such as `name | alias`.

For triState, add the prefix **only to the selected value**, not options.value. Declare `value: "action"`; receive `"include:action"`. Use exact `include:` and `exclude:` prefixes; `-action`, `!action`, booleans and `ignore:action` are not the contract. After removing the prefix, retain the complete original ID, including any remaining colons.

The UI does not simultaneously include and exclude one option. Sources must handle old presets/positions robustly: deduplicate, check values against current options and define a conflict policy. The example below gives inclusion priority over exclusion; this is example policy, not a hidden server rule.

A complete input query covering every kind:

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

#### Defaults, clearing and reset

Suppose `languages.defaultValues = ["en", "ru"]`:

| State | Website selection |
| --- | --- |
| `selectedFilters = {}` | en and ru: the defaults |
| `{"languages": ["ja"]}` | Only ja |
| `{"languages": []}` | Explicitly no languages; defaults are not restored |
| `{"languages": ["en", "ru"]}` | Equivalent to defaults; the UI may omit this redundant key |
| Global filter reset button | Selection becomes `{}`, so defaults apply again |

The application uses defaults to display multiSelect but **does not automatically expand them into the source's selectedFilters**. The source must apply defaults when a key is absent. Distinguish `selectedFilters.languages ?? defaults` from `selectedFilters.languages?.length ? ... : defaults`: the latter wrongly replaces an explicit `[]`.

Other kinds have no declarative initial selection: `defaultValue`, `selected`, `checked`, `min`/`max` are not FilterDto fields. Initial ordering belongs in getPopular/getLatest/search, not sort.defaultValues.

The application preserves explicit empty arrays. Entries with nonempty arrays containing only whitespace strings are removed before the request. Do not use such entries as special control signals.

#### Catalog routing and sort order

- Empty searchTerm and selectedFilters: discovery calls getPopular; latest calls getLatest.
- Search text **or any selectedFilters entry**, including explicit `[]`: calls search. Therefore search must handle `searchTerm: ""`, not just title searches.
- In a filtered feed without search text, the application may add ordering from the first kind=sort declaration: latest/new for latest, or popular/discover for discovery, matched against value or label. An existing user selection is retained.
- Without a matching option, the source supplies its own default order. SourceQueryDto has no feedKind or separate “called from latest” flag; do not infer it from call order.
- getLatest must use the same server order as the corresponding explicit filter selection. `supportsDirection: false` means fixed API order; ignore any direction retained in an old preset.
- Search/filter changes restart pagination at 1. Do not share one cursor between different selections or simultaneous operations; isolate API cursors by the normalized query.

#### Complete module handling all six kinds

Save as `src/catalog-filters.mjs`. Website parameters such as `language[]` and `genre[]` are fictional; replace them with the actual API contract. Repeated query parameters use append rather than String(array).

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

To integrate with the complete source in section 3, import `createCatalogMethods` from `./catalog-filters.mjs`, create `const catalog = createCatalogMethods(ctx, manga)` inside createSource, and spread `...catalog` into the returned object. Remove the previous getPopular/getLatest/search/getFilters methods so they do not override the helper. Keep getDetails/getChapters/getPages/getRecommendations from the complete example.

This module:

- Returns declarations for every supported kind and applies defaults to ordinary catalogs as well.
- Reads only known keys and API values, ignoring unknown old values. It does not forward URLs, arbitrary sort fields or query fragments from selectedFilters.
- Preserves text, encodes special characters once, and handles include/exclude, repeated parameters and asc/desc.
- Stores no active-query state; multiple search operations can run concurrently.

Depending on the API, use GET query, JSON POST or form POST. The selectedFilters contract remains identical: the source translates selections into IDs, numbers, inclusion/exclusion arrays and body fields. For form bodies, send a URLSearchParams string with the appropriate Content-Type; an object body does not automatically become a form.

There are no native kinds for numeric/date ranges, groups, dependent dropdowns, remote autocomplete, custom HTML or custom controls. A range can use two text filters with bounds validated during request construction. A dropdown takes a complete flat options list; getFilters receives no text for remote option searching.

#### Dynamic options and refresh

Declare `supportsFilterRefresh: true` for refreshable taxonomy. The UI requests `getFilters({refresh: true})`; ordinary calls pass false or omit the argument. The application caches successful snapshots and shares ordinary concurrent reads; failures allow retries. Do not assume getFilters always runs before search/getLatest.

Create any source-side cache and forced-refresh logic inside the factory. Example `src/filter-cache.mjs`:

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

Use `const getFilters = cachedFilterLoader(() => loadFiltersFromSite(ctx))` inside createSource. loadFiltersFromSite must return a complete FilterDto[], validate the website response and preserve stable API values. The helper does not cache failures or let an old response overwrite a newer snapshot. Static filters do not need caching or refresh.

Saved filters and positions use key/value, so changing labels is safe while renaming keys/values breaks old selections. If the site removes an option, do not blindly forward it; choose and document a compatible policy. Do not disguise a taxonomy failure as a successful empty list.

#### Manga chips and filterBindings

The source manifest's filterBindings accepts `author`, `artist` and `tags` roles; values are **filter keys**, not option API IDs. For example, `{"author": "author", "tags": "genres"}`.

- Author/artist bind to kind=text and send the full display name as one string. Resolve names to API IDs inside search if required.
- The shared MangaDto.tags list can contain genres, tags, themes and formats. The application matches chip labels to option.label on suitable singleSelect/multiSelect/triStateMultiSelect filters.
- Exact labels outrank partial matches; bindings break ties. A genre match can choose genres even when tags is the preferred binding.
- A triState chip becomes `include:value`; single/multi chips use the bare value. A suitable text filter can be used without an option match; absent any match, the application opens text search.
- Return clean matching names without badge counts, unrelated descendant text or HTML. Preserve complete author aliases.

#### Required filter tests

Test every kind, missing keys versus [], default and cleared multiSelect, global reset, all sort fields/directions, fixed sort without direction, include/exclude/ignore, conflicting and removed options, text containing special characters and commas, empty-searchTerm filtering, changes after page 1, concurrent queries with different selections, refresh after failure, and old/new snapshot races. Separately test genre, tag and author/artist chips.

### Settings

Add the `sourceSettings` permission and a `settings` block to the source definition, for example:

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

Read with `await ctx.settings.get("titleLanguage")`; write with `await ctx.settings.set("titleLanguage", "english")`. `get("source")` returns the declared source fields. Supported types are boolean/string/integer/enum; provide valid defaults and constraints. The names `source` and `network` are reserved. `roles.titleLanguage` can point to the corresponding enum field.

### Authentication

Login, CAPTCHA and SSO take place in the application's WebView. The extension declares parameters rather than implementing its own login UI. Add the `account` capability, `features.auth: true`, the `sourceSession` permission and an `auth` block:

```json
{
  "profileId": "host.cookie.v1",
  "loginUrl": "https://example.org/login",
  "cookieOrigins": ["https://example.org"],
  "sessionExport": {"headers": ["Cookie"], "values": []}
}
```

Align `network.authOrigins`, `cookieOrigins` and the actual login/API domains. A parent Cookie Domain needs an explicit separate grant. Do not export sessions to a CDN merely to load images. Set `completionUrl`/`successUrl` from the website's actual flow; `features.authCompletion` must match the declaration.

Bearer sessions use `host.session.v1` and declarative `rules`: `bearer`, `cookieAll`/`cookieAny`, `tokenStorageKeys`, `tokenPath`, `tokenFields`, `tokenTypePath`, `tokenType`, `tokenCookieNames`. Explicitly declare the headers/values to export. Cookie tokens use exact `tokenCookieNames`, without wildcards. The application reads storage and constructs headers.

Ordinary HTTP requests receive the current session automatically. If an API needs an allowed token in a POST body:

```js
const session = await ctx.auth.getSession({url: apiUrl});
const response = await ctx.http.request({
  method: 'POST', url: apiUrl, responseType: 'json',
  authRevision: session.revision, body: {token: session.accessToken},
});
```

This request requires an allowed POST method and URL and an exported `accessToken`. Pass `authRevision` so that a session change cancels an outdated operation. Do not cache or log tokens, cookies, passwords or session snapshots.

## 6. Performance, limits and errors

- Every sourceId has separate settings, cookies, tokens and browser profile, even when a website or engine is shared.
- Several methods on one factory can run concurrently: the default is 3 operations, configurable by the user from 1 to 5. Do not keep the current mangaId, page, temporary response or mutable cursor in a shared factory field. Use local argument variables.
- Use Promise.all for independent requests within the limits. Do not parallelize dependent login steps or pagination sharing a server cursor.
- For paired Details/Chapters/Recommendations reads from one page, reuse one load and projection with [recent](../src/core/recent.mjs): include the helper in your project and create the cache inside the factory. Defaults are 2 entries and 15 seconds after completion; identical in-flight requests are shared and failures are removed. Do not use this cache for manually refreshed catalogs, POST or writes.
- Runtime packages contain only used source files, data, icons and the license. Tests, node_modules, SDK bootstrap and private keys are excluded.

| Limit | Value |
| --- | --- |
| Sources per package | 1–64 |
| `network.maxConcurrentRequests` | 1–8; current bundles declare 6 |
| Application HTTP scheduler | up to 32 simultaneous requests, up to 8 per origin; queue 1024 |
| Image loading | budget 16 overall / 8 per source; other limits also apply |
| HTTP timeout | 250–30000 ms |
| Operation wait / method execution | up to 30 s in the context queue / up to 30 s after starting |
| Context operation queue | up to 64 waiting operations, in addition to 1–5 active ones |
| HTTP request body | up to 256 KiB |
| HTTP text/JSON response | up to 4 MiB |
| HTTP bytes response | up to 1 MiB |
| Archive / unpacked payload | up to 8 MiB / 24 MiB |
| Payload files / manifest | up to 128 files / 128 KiB |

The application can reduce effective concurrency. The HTTP limit is separate from the number of simultaneous source methods.

When the response structure changes, return `parse_error` or `invalid_response`, not a false successful empty catalog. An empty list means no results or the end of pagination. Standard codes also include `auth_required`, `challenge_required`, `rate_limited`, `not_found`, `chapter_unavailable`, `timeout` and `cancelled`; see the API types for the full list. A safe error is `Object.assign(Error("Unexpected catalog response."), {code: "parse_error", phase: "parse"})`.

Preserve the broker's original error code. Do not hide 403/challenge/429 by cycling through domains, or automatically retry POST and login. Use `ctx.log.info(event, fields)` for short diagnostics without secrets.

## 7. Tests before release

A minimal `tests/source.test.mjs` for the section 3 example:

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

For your project, run `node --test tests/*.test.mjs`. In these repositories, run `npm test`.

Cover first/next/empty pages, special search characters, filter clearing, include/exclude, sorting, malformed JSON/HTML, fractional chapters, access restrictions, image URLs and recommendations. Test offline factory creation, independent instances and concurrent methods without mixed state.

Before publication, check catalogs, details, reading and images, mirrors, login/logout and session changes in the application. Confirm that updates retain IDs and user data. Check the available target platforms separately; parser tests do not establish website, account or WebView behavior.

## 8. Signing and local import

Choose your own license and ensure you have the rights to distribute the source files, data and images. These repositories are **All rights reserved**; being on GitHub does not itself permit redistribution. Preserve the licenses of third-party components.

Create an Ed25519 key in a private directory. `.keys/` is ignored by Git; the key must not appear in commits, release assets, logs or examples:

```powershell
node tools/pack.mjs --generate-key .keys/publisher.pem --key-id my-publisher-2026
```

Package a separate project:

```powershell
node tools/pack_extension.mjs --project ./my-sources --key .keys/publisher.pem --key-id my-publisher-2026 --output ./dist/my-sources.mlsource
```

A separate project's version comes from its `manifest.json`. For the current registered bundle, use `node tools/pack.mjs --key .keys/publisher.pem --key-id my-publisher-2026 --version 1.0.0` or `./build-package.ps1 -KeyPath .keys/publisher.pem -KeyId my-publisher-2026 -Version 1.0.0`. The default archive name depends on the repository; see the section 1 table.

The packer creates `.mlsource`, `.mlsource.public.json` and `.mlsource.sha256`, signs the manifest, records payload hashes/sizes and verifies the resulting archive. Packaging is reproducible for identical files, version and key.

Import the public record and package through extension settings, independently verify the public key's SHA-256 fingerprint and allowed extensionIds, then approve the publisher and permissions. A nearby `.public.json` helps comparison but does not establish trust by itself. A local test key is not a production key.

<a id="publishing"></a>

## 9. Publishing on GitHub

### Manual release of your own package

The same rules apply to local publication and CI:

1. Release a tested commit with a new SemVer version; do not overwrite a published version or its bytes.
2. Preserve `extensionId`, source IDs and publisher key during ordinary updates. Handle key rotation or revocation explicitly; a new key supplied by a downloaded package cannot approve itself.
3. Add a signed index binding the repository, version, tag, archive, hash and source IDs:

```powershell
node tools/sign_repository_index.mjs --repo owner/repo --serial 1 --tag v1.0.0 --package ./dist/my-sources.mlsource --key .keys/publisher.pem --output ./dist
```

`serial` is a positive strictly increasing number for the repository; do not reset it when moving workflows. One serial must not designate different data. The index is valid for 30 days; publish fresh metadata before expiry. `extensions-index.ed25519` is a separate binary signature, not JSON/base64. Signing the index does not replace signing the package.

If your repository does not publish through an automatic workflow, create a tag on the tested commit and a GitHub Release with five files:

```powershell
git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 ./dist/my-sources.mlsource ./dist/my-sources.mlsource.public.json ./dist/my-sources.mlsource.sha256 ./dist/extensions-index.json ./dist/extensions-index.ed25519 --repo owner/repo --verify-tag --title "My Unofficial Sources 1.0.0" --notes "Signed source package."
```

For a prerelease, use a SemVer suffix and mark the GitHub release as a prerelease. Release notes should state source changes, the minimum application version, new permissions and known testing limitations. Publish the package, public key/record, checksum and signed index; never publish the private key.

### Included workflows

[release.yml](../.github/workflows/release.yml) targets the existing bundle and archive name from section 1. For your own separate package, adapt IDs, paths and packaging commands; the unchanged workflow does not target an arbitrary project.

In the separate repository, protect the main branch and configure the environment from the table:

- Variable `MLSOURCE_PUBLISHER_KEY_ID`: the trusted publisher key identifier.
- Secret `MLSOURCE_SIGNING_KEY_BASE64`: base64 of the complete private Ed25519 PEM in PKCS#8 format. Prepare it locally and store it only as an environment secret.
- Add reviewers and release tag restrictions if needed.

Pushing a SemVer tag `vVERSION` starts publication automatically. For manual workflow dispatch, select the existing tag/ref and provide `version` without `v`; the tag must point at the workflow commit. The workflow reruns tests, signs the package and index, and publishes the five files. Index serial is computed as `GITHUB_RUN_NUMBER * 100 + GITHUB_RUN_ATTEMPT`.

PR and main-branch checks produce test artifacts, not releases. The private release key is available only to the protected environment. Updates are installed after signature, version, ID ownership and user permission approval checks.

<a id="api-reference"></a>

## 10. API v1 contract reference

These contracts describe extension data, not any particular website's responses. The normative field set is in [source-api.d.ts](../sdk/source-api.d.ts) and the SDK schemas. Do not add undocumented manifest fields: its objects are checked strictly. An extra DTO field does not create a new UI feature.

### 10.1. Manga, chapters, access, pages and recommendations

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

| Field/result | Rules |
| --- | --- |
| MangaDto.id, ChapterDto.id | Nonempty stable strings. They need not be numbers or URLs; composite IDs are allowed. Preserve the format across domain changes. |
| title | Nonempty plain display text; do not replace a missing manga with a fictional title. |
| coverUrl, languageFlagUrl | Absolute HTTPS URL or null, with an allowed image origin. Do not use data:/blob: or relative paths. |
| description | String or null, up to 256 Ki characters; do not return the entire website document. |
| secondaryTitle, author, artist, status, type, ageRating, releaseYear | Strings or null. There are no universal status/type/ageRating enums. releaseYear is a string, not a number. |
| rating | Finite number or null; the wire contract specifies no universal scale and does not normalize ratings automatically. |
| pageCount | Nonnegative JavaScript-safe integer or null. |
| tags | Up to 512 nonempty strings; labels should match genre/tag option names for chip navigation. |
| ChapterDto.number | Finite number; retain fractional chapters and do not use a string. |
| uploadedAt, availableAt | ISO-8601 timestamp with Z or ±HH:MM timezone, or null. UTC is recommended. A date without time/timezone is invalid; calendar dates must exist. |
| access.type | available: readable; temporarilyUnavailable: pending access, include availableAt when known; paid: include priceLabel/message when available. |
| PageDto.index | Exactly its array position: 0, 1, 2… Array order is reading order; one-based indices and duplicates are rejected. |
| PageDto.imageUrl | Required absolute HTTPS URL, including any signed query parameters. |
| RecommendationPageDto.page | Integer from 1; items is MangaDto[], hasNextPage is a boolean, not 0/1 or a string. |

Other DTO strings are limited to 16384 characters without NUL; required strings cannot be empty/whitespace-only. General manga/chapter/page arrays accept up to 100000 entries, with additional response-size and execution-time limits. Duplicate chapter IDs reject the entire chapter list.

getPopular/getLatest/search return **only a manga array**, without `{items, total, hasNextPage}`. A real empty array indicates the end; do not disguise parsing failures as pagination completion. getRecommendations uses a separate wrapper with hasNextPage. Do not return an incomplete chapter preview as a complete page.

### 10.2. Context and HTTP operations

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

The application supplies sourceId, baseUrl and parameters. parameters contains signed manifest constants configuring a shared factory, not user settings or secrets. Make http/html/settings/auth calls only inside source methods.

| HTTP request field | Rules |
| --- | --- |
| method, url, responseType | Required; method must be in network.methods. URL is HTTPS without credentials or a fragment, on an allowed origin with the same port. The network broker limits URLs to 8192 characters. |
| headers | Optional object with up to 16 string headers. Names are case-insensitive and duplicate normalized names are rejected; values are limited to 4096 characters without controls. |
| body | POST only. Strings are sent as UTF-8 text; other JSON values as JSON. Objects do not automatically become forms. Omitted/null bodies are not sent. |
| timeoutMs | Default 20000; integer 250–30000. Includes queue wait, redirects and response processing. |
| userAgentProfile | Precedence: request field → network.userAgentProfile → app. Media has a separate media.userAgentProfile. Align HTTP, WebView and media with the site's actual flow when necessary. |
| authRevision | Nonnegative safe integer from getSession; requires sourceSession. Guards against stale snapshots; it is not a token. |

Allowed request headers: Accept, Content-Type, Accept-Language, Site-Id, X-Service-Name, X-Requested-With, X-Client-Version, HX-Request, App-Id, App-Version; validated Referer and Origin are also supported. Other arbitrary headers are not accepted. Origin must be exactly an origin without a path; Referer can include an allowed website path.

String bodies default to `text/plain; charset=utf-8`; JSON bodies default to `application/json`, unless explicitly overridden. Form POST example inside an asynchronous method:

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

HEAD can also probe an allowed image origin and does not return image content. GET does not accept a body. GET/HEAD follow up to 5 redirects with fresh URL/session checks; POST redirects are not replayed automatically.

Successful responses contain the final url, status, body and safe lowercase headers: content-type, content-length, cache-control, etag, last-modified, retry-after, location, x-total-count, cf-mitigated. Set-Cookie is not exposed to the script; the application applies cookies separately within the allowed session.

responseType=text returns a string; json returns a parsed JSON value; bytes returns numbers from 0 to 255. HTTP encoding is respected, including declared Windows-1251. Preserve meaningful errors for unsupported encodings or malformed JSON rather than guessing the response shape.

Non-2xx responses throw SourceHostError: 401 → auth_required, 403 → access_denied, 404 → not_found, 429 → rate_limited, others → invalid_response; `cf-mitigated: challenge` produces challenge_required. Parse a safe error.body from your own endpoint when needed to identify access restrictions. Do not expect a normal response.status=404 instead of an exception.

### 10.3. Every HTML projection field

A projection node has **exactly one output mode**: fields, text=true, attr, html=true, outerHtml=true, tagName=true or containsText. Other fields control selection. Set baseUrl at the top level of ctx.html.extract; nested fields inherit it.

| Field | Type and behavior |
| --- | --- |
| baseUrl | Optional absolute HTTPS base for links; use the final response.url. |
| selector | CSS selector, 1–1024 characters; omitted means the current node. Scripts/browser handlers do not execute. |
| fields | Object with up to 64 named nested projections; output keys are 1–256 characters. |
| all | Boolean; true returns an array, otherwise the first result or null. |
| required | Boolean; a missing node, null or empty string causes an error. |
| text | Boolean; true returns trimmed/normalized node text. |
| attr | HTML attribute name, 1–128 letters/digits/_/:-; a missing attribute returns null. |
| html / outerHtml | Boolean; inner content or complete element respectively. Use only when field projections are insufficient. |
| absoluteUrl | Boolean; resolves a nonempty link string against baseUrl, requiring HTTPS. |
| textEquals | String up to 4096 characters; exact case-sensitive match against normalized text. |
| ascend | Integer 0–8; move to a parent after selecting the node. |
| nextSibling | Boolean; after ascend, move to the next element sibling, not a text node. |
| directChildren | Boolean; retain only immediate children of the current node. |
| tagName | Boolean; true returns a lowercase tag name. |
| exclude | CSS selector up to 1024 characters; text=true only, removes descendants from a node copy. |
| normalizeWhitespace | Boolean; text=true only. false retains internal whitespace but still trims surrounding whitespace. |
| containsText | 1–8 nonempty strings up to 256 characters; boolean test for any literal case-insensitive substring. A separate output mode, not regex. |

Maximum nesting depth is 8; CSS selectors can match up to 10000 nodes. The complete result budget is 100000 nodes and 1 Mi characters of text/keys. HTML input is limited to 8 Mi characters; HTTP limits may constrain it earlier. Missing optional fields return null; all without matches returns []; required turns absence into an error.

### 10.4. Manifest fields and capability agreement

| Block | Fields and rules |
| --- | --- |
| Package format | schemaVersion=1, sourceApiVersion=1, minRuntimeAbi=1. minAppVersion is the minimum compatible application SemVer version. |
| Identity | extensionId and sources[].id: up to 128 characters, lowercase Latin letters/digits and dot/hyphen-separated segments. version is SemVer; publisherKeyId identifies your key. |
| Description | name, license; optional homepage (HTTPS), icon (local signed asset). Packaging requires LICENSE. |
| Execution | entrypoint is a relative .mjs path. files maps relative payload paths to {size, sha256}, populated by the packer. No .., absolute components or symlinks. |
| Permissions | http: network; html: projections; sourceSettings: declared settings; sourceSession: session/authentication. A method existing on ctx does not imply permission. |
| Source registration | id, name, language, baseUrl, engine, status, capabilities, features, network, media. language: all/ru/en; status: stable/experimental. |
| Flags | isNsfw, metadataOnly, supportsCustomBaseUrl, supportsFilterRefresh are booleans. A flag alone does not implement support. |
| Capabilities | browse/latest/search/filters/account/recommendations; implement the corresponding method for each advertised feature. account uses host auth, not JS login. |
| Features | webLinks requires web; auth requires auth and account; authCompletion requires auth and completionUrl/successUrl; recommendations agrees with the capability and method. |
| parameters | Up to 32 named string constants, values 1–1024 characters; available through ctx.parameters. |
| filterBindings | Optional author/artist/tags roles mapping to filter keys up to 128 characters. |
| web | mangaUrlTemplate, idEncoding, optional idPart {separator, index}; exactly one {id}, local path without an external // address. |
| branding | icon is local PNG/JPEG/WebP; accentColor is #RRGGBB. Package branding uses the separate top-level icon. |
| presentation | coverFit: contain/cover. |
| network | origins/imageOrigins/authOrigins (up to 128 origins each), allowSubdomains, methods, maxConcurrentRequests; optional userAgentProfile, transportProfile, cookieDefaults. |
| media | userAgentProfile, refererOrigin, sendOrigin; optional transform. |
| auth / settings | Separate declarations below; they do not execute arbitrary callbacks. |

allowSubdomains applies to HTTP/image and **does not expand authOrigins**. Cookies and credentials require exact allowed origins. Use normalized HTTPS URLs for IDNs. Different ports mean different origins.

cookieDefaults declares up to 16 public preference cookies with origin/name/value and optional path (default /). They apply only to matching origin/path. Never place user sessions or passwords there.

media.transform supports only algorithm=xor, key (1–256 bytes in 0–255), origin, pathPrefix, stemLength (1–256), markerOffset (0–255) and marker (one character). It is a shared algorithm with site-format parameters and does not expand image grants. Do not use it instead of fixing an incorrect URL or authentication.

### 10.5. Settings and authentication fields

settings.version is an integer 1–1000; fields contains up to 32 definitions. Each has key, label, type and default. key matches `[a-z][A-Za-z0-9_.-]{0,63}`; source/network are reserved; label is 1–128 characters.

| type | Value and constraints |
| --- | --- |
| boolean | default and value are true/false, not strings. |
| string | String; declared maxLength is 1–4096. |
| integer | Integer; optional min/max with declaration bounds from -1000000 to 1000000. default must satisfy the bounds. |
| enum | String value from options; 1–64 {value, label} entries, value up to 256 characters. default must exist in options. |

roles.titleLanguage references a declared enum key. Optional legacyNamespace supports existing source-owned settings and does not share access between sources. ctx.settings cannot read arbitrary application settings. Respect types and declared constraints before writing; set returns Promise<void>.

auth contains profileId, loginUrl, cookieOrigins (up to 16), sessionExport and optional rules. With features.authCompletion=true, both completionUrl and successUrl are required; otherwise omit both.

| rules | Purpose |
| --- | --- |
| bearer | Boolean; enable Bearer-token handling. |
| cookieAll / cookieAny | All/any names of nonempty cookies. A trailing * matches an identifier prefix; this checks presence, not credential export. |
| tokenStorageKeys | Browser localStorage entry names from which a token is extracted. |
| tokenPath | Array of nested JSON keys leading to the token value. |
| tokenFields | Candidate token fields in an object/nested JSON value. |
| tokenTypePath / tokenType | Path to token type and its expected value. |
| tokenCookieNames | Exact token-cookie names; requires bearer=true and forbids wildcards. The cookie value is decoded. |

Rule arrays contain up to 16 strings of 1–128 characters; tokenType is up to 32. sessionExport.headers allows Cookie, Authorization, X-XSRF-TOKEN, X-CSRF-TOKEN; values allows accessToken and csrfToken. Export only what is necessary.

ctx.auth.status() returns authorized/revision for the current source. getSession({url}) returns a snapshot for that specific allowed URL. headers, cookieHeader, accessToken and csrfToken are available only within allowed exports; optional fields can be absent. Check required values instead of converting undefined to a string. Snapshots change on logout/account changes; ordinary HTTP requests obtain a fresh session automatically.

min/max apply only to integer, maxLength only to string, and options only to enum. Without explicit bounds, integer uses -1000000…1000000 and string uses maxLength=4096. String settings reject control characters; defaults undergo the same validation as user values.

### 10.6. Errors and diagnostics

SourceHostError is an Error with code and phase, optionally httpStatus, retryAfterSeconds, access and body. phase is a short stage name, not a stack/HTML/token. Preserve original error codes; add code/phase to Error for source-defined failures.

The complete API v1 code union:

```text
cancelled, timeout, offline, network, rate_limited, auth_required,
challenge_required, not_found, title_not_found, chapter_not_found,
chapter_unavailable, parse_error, invalid_response, permission_denied,
unsupported, incompatible_api, resource_limit, runtime_crashed,
auth_session_changed, source_unavailable, access_denied
```

not_found is generic absence; title_not_found/chapter_not_found identify the missing entity. chapter_unavailable with access carries reading restrictions. permission_denied means a grant/call-contract violation; unsupported means an unsupported feature; resource_limit means an exhausted budget. Cancellation and session changes are not successful empty results.

ctx.log.info accepts event plus an object of string/number/boolean values only. Do not send large responses, Error objects, cookie arrays or personal data.

### 10.7. Signed repository index contract

An index contains schemaVersion=1, repositoryId (lowercase owner/repo), serial, generatedAt, expiresAt, publisherKeyId, channel and packages. channel is stable/prerelease; timestamps use UTC seconds and Z.

Each packages entry contains extensionId, version, releaseTag, assetName, size, sha256, sourceApiVersion, minRuntimeAbi, minAppVersion, sourceIds and channel. These are checked against an independently verified archive. Do not replace assetName with an external download URL. The schema permits up to 128 packages, but the provided sign_repository_index.mjs creates an index for one supplied archive.

The canonical manifest uses Ed25519 with `MangaLaunch source package v1\n`; the index uses `MangaLaunch source repository v1\n`. Their signatures are not interchangeable. Use the pack/sign tools instead of manually concatenating JSON. An expired index prevents metadata updates, while installed packages keep working offline. An old archive or removing a repository cannot bypass key revocation or pinning.
