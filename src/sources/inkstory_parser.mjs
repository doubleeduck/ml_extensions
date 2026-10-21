import {chapter, compareText, filter, isoDate, manga, parseError, record, records, string} from '../core/data.mjs';

export function parseManga(value) {
  const item = record(value), names = record(item.name);
  const slug = string(item.slug), title = string(names.ru ?? names.en ?? names.original);
  if (!slug || !title) throw parseError('InkStory title is incomplete.');
  function publisher(type) {
    const relation = records(item.relations).find(entry => entry.type === type);
    return relation ? string(record(relation.publisher).name) : null;
  }
  return manga({id: `/content/${slug}`, title,
    secondaryTitle: string(names.en ?? names.original), coverUrl: string(item.poster),
    description: string(item.description), author: publisher('AUTHOR'), artist: publisher('ARTIST'),
    status: string(item.status), type: string(item.type), rating: item.averageRating ?? null,
    releaseYear: item.year == null ? null : String(item.year),
    tags: records(item.labels).map(label => string(label.name)).filter(value => value !== null)});
}

export const parseCatalog = value => records(value).map(item =>
  parseManga(item.book && typeof item.book === 'object' ? record(item.book) : item));

export function largestBranch(payload) {
  const branches = new Map();
  for (const item of records(payload)) {
    const id = string(item.id), branch = string(item.branchId);
    if (!id || typeof item.number !== 'number' || !Number.isFinite(item.number)) {
      throw parseError('InkStory chapter is incomplete.');
    }
    if (!branches.has(branch)) branches.set(branch, new Map());
    if (!branches.get(branch).has(id)) branches.get(branch).set(id, item);
  }
  const ranked = [...branches.entries()].sort(([leftId, left], [rightId, right]) =>
    right.size - left.size || compareText(leftId ?? '', rightId ?? ''));
  return ranked.length ? [...ranked[0][1].values()] : [];
}

export function parseChapters(payload, mangaId) {
  return largestBranch(payload).map(item => chapter({
    id: `${mangaId}/${string(item.id)}`,
    title: string(item.title) ?? string(item.name) ??
      `Глава ${item.number.toFixed(item.number % 1 === 0 ? 0 : 1)}`,
    number: item.number, uploadedAt: isoDate(item.createdAt)}));
}

export function normalizeImageUrl(value) {
  const url = new URL(value);
  if (url.hostname !== 'static.inuko.me') return value;
  const segments = url.pathname.split('/'), name = segments.at(-1), stem = name.split('.')[0];
  if (stem.length !== 36 || stem[14] !== 's') return value;
  segments[segments.length - 1] = `${stem.slice(0, 14)}x${stem.slice(15)}.${name.split('.').at(-1)}`;
  url.pathname = segments.join('/');
  return url.href;
}

export function parsePages(payload) {
  return records(record(payload).pages).slice().sort((left, right) =>
    (typeof left.index === 'number' ? Math.trunc(left.index) : 0) -
    (typeof right.index === 'number' ? Math.trunc(right.index) : 0))
    .map(item => string(item.image)).filter(value => value !== null)
    .map((value, index) => ({index, imageUrl: normalizeImageUrl(value)}));
}

export function parseFilters(payload) {
  const options = kind => {
    const seen = new Set();
    return records(payload).filter(item => item.kind === kind).flatMap(item => {
      const slug = string(item.slug), name = string(item.name);
      if (!slug || !name || seen.has(slug)) return [];
      seen.add(slug); return [[slug,name]];
    });
  };
  const genres = options('GENRE'), tags = options('TAG');
  return [
    filter('sort', 'sort', 'Сортировка', [
      ['viewsCount', 'Популярные'], ['likesCount', 'Лайки'], ['chaptersCount', 'Количество глав'],
      ['bookmarksCount', 'Закладки'], ['averageRating', 'Высокий рейтинг'], ['createdAt', 'Новые']]),
    ...(genres.length ? [filter('triStateMultiSelect', 'genre', 'Жанры', genres)] : []),
    ...(tags.length ? [filter('triStateMultiSelect', 'tags', 'Теги', tags)] : []),
    filter('multiSelect', 'status', 'Статус', [
      ['ONGOING', 'Выходит'], ['DONE', 'Завершено'], ['FROZEN', 'Заморожено'], ['ANNOUNCE', 'Анонс']]),
    filter('multiSelect', 'country', 'Страна', [
      ['RUSSIA', 'Россия'], ['JAPAN', 'Япония'], ['KOREA', 'Корея'], ['CHINA', 'Китай'], ['OTHER', 'Другое']]),
    filter('multiSelect', 'contentStatus', 'Контент', [
      ['SAFE', 'Безопасный'], ['UNSAFE', 'Небезопасный'], ['EROTIC', 'Эротический']]),
    filter('multiSelect', 'formats', 'Формат', [
      ['FOURTH_KOMA', 'Енкома'], ['COMPILATION', 'Сборник'], ['DOUJINSHI', 'Додзинси'],
      ['WEBTOON', 'Вебтун'], ['COLORED', 'Цветной'], ['ARTBOOK', 'Артбук'],
      ['SINGLE', 'Сингл'], ['LIGHT', 'Лайт'], ['WEB', 'Веб']]),
    filter('toggle', 'strictLabelEqual', 'Строгое совпадение жанров и тегов'),
    ...[['chaptersCountMin', 'Глав от'], ['chaptersCountMax', 'Глав до'],
      ['averageRatingMin', 'Рейтинг от'], ['averageRatingMax', 'Рейтинг до'],
      ['yearMin', 'Год от'], ['yearMax', 'Год до']].map(([key, label]) => filter('text', key, label)),
  ];
}

export const isValidChapterId = value =>
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(String(value).split('/').at(-1));
