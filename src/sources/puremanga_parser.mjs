import {chapter, compareText, filter, isoDate, manga, parseError, record, records, string} from '../core/data.mjs';
export {normalizeImageUrl,parsePages} from '../engines/inuko_images.mjs';

const sorts = [['viewsCount','Популярные'],['likesCount','Лайки'],['chaptersCount','Количество глав'],['bookmarksCount','Закладки'],['averageRating','Высокий рейтинг'],['createdAt','Новые'],['latestChapterAt','Последние обновления']];
const choices = [
  ['status','Статус',[['ONGOING','Выходит'],['DONE','Завершено'],['FROZEN','Заморожено'],['ANNOUNCE','Анонс']]],
  ['country','Страна',[['RUSSIA','Россия'],['JAPAN','Япония'],['KOREA','Корея'],['CHINA','Китай'],['OTHER','Другое']]],
  ['contentStatus','Возрастной рейтинг',[['SAFE','Безопасный'],['UNSAFE','Неприемлемый'],['EROTIC','Эротика'],['PORNOGRAPHIC','Порнография']]],
  ['formats','Формат',[['FOURTH_KOMA','Енкома'],['COMPILATION','Сборник'],['DOUJINSHI','Додзинси'],['WEBTOON','Вебтун'],['COLORED','Цветной'],['ARTBOOK','Артбук'],['SINGLE','Сингл'],['LIGHT','Лайт'],['WEB','Веб']]],
];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

// The site's catalog accepts JSON arrays and label UUIDs, unlike the legacy
// public API, whose search index omits adult content even with an explicit filter.
export function catalogQuery({page=1,searchTerm='',selectedFilters={}}={},forcedSort,labels=[]) {
  const sort=selectedFilters.sort ?? [], field=forcedSort ?? sort[0] ?? 'viewsCount';
  if (!sorts.some(([key])=>key===field)) throw parseError('Invalid PureManga sort.');
  const query={page:Math.max(0,(Math.trunc(Number(page))||1)-1),size:40,sort:field,orderBy:!forcedSort&&sort[1]==='asc'?'asc':'desc'};
  if(searchTerm.trim())query.search=searchTerm.trim();
  for(const [key,,options] of choices) {
    const values=[...new Set(selectedFilters[key]??[])];
    if(values.some(value=>!options.some(([allowed])=>allowed===value)))throw parseError(`Invalid PureManga ${key}.`);
    if(values.length)query[key]=JSON.stringify(values);
  }
  const labelIds=new Map(records(labels).flatMap(label=>uuid.test(label.id??'')?[[label.slug,label.id],[label.id,label.id]]:[]));
  for(const [prefix,key] of [['include:','labelsInclude'],['exclude:','labelsExclude']]) {
    const values=[...new Set(['genre','tags'].flatMap(key=>selectedFilters[key]??[])
      .filter(value=>prefix==='include:'?!value.startsWith('exclude:'):value.startsWith(prefix)).map(value=>{
        const raw=value.replace(/^(include|exclude):/u,'').trim(),id=labelIds.get(raw)??(uuid.test(raw)?raw:null);
        if(!id)throw parseError('Unknown PureManga genre or tag.');return id;
      }))];
    if(values.length)query[key]=JSON.stringify(values);
  }
  for(const [key,min,max,integer] of [['yearMin',1900,2200,true],['yearMax',1900,2200,true],['chaptersCountMin',0,100000,true],['chaptersCountMax',0,100000,true],['averageRatingMin',0,10,false],['averageRatingMax',0,10,false]]) {
    const raw=selectedFilters[key]?.[0]?.trim().replace(',','.');if(!raw)continue;
    const value=Number(raw);
    if(!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw parseError(`Invalid PureManga ${key}.`);
    query[key]=value;
  }
  if(selectedFilters.strictLabelEqual?.[0]==='true')query.strictLabelEqual=true;
  return query;
}

export function parseManga(value) {
  const item = record(value), names = record(item.name);
  const slug = string(item.slug), title = string(names.ru ?? names.en ?? names.original);
  if (!slug || !title) throw parseError('PureManga title is incomplete.');
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

export function largestBranch(payload) {
  const branches = new Map();
  for (const item of records(payload)) {
    const id = string(item.id), branch = string(item.branchId);
    if (!id || typeof item.number !== 'number' || !Number.isFinite(item.number)) {
      throw parseError('PureManga chapter is incomplete.');
    }
    if (!branches.has(branch)) branches.set(branch, new Map());
    if (!branches.get(branch).has(id)) branches.get(branch).set(id, item);
  }
  const ranked = [...branches.entries()].sort(([leftId, left], [rightId, right]) =>
    right.size - left.size || compareText(leftId ?? '', rightId ?? ''));
  return ranked.length ? [...ranked[0][1].values()] : [];
}

export function parseChapters(payload, mangaId) {
  return largestBranch(payload).slice().sort((a,b)=>(Number(b.volume)||0)-(Number(a.volume)||0) || b.number-a.number).map(item => chapter({
    id: `${mangaId}/${string(item.id)}`,
    title: `${Number(item.volume) > 0 ? `Том ${item.volume}. ` : ''}Глава ${item.number}${string(item.title ?? item.name) ? `: ${string(item.title ?? item.name)}` : ''}`,
    number: item.number, uploadedAt: isoDate(item.createdAt)}));
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
    filter('sort', 'sort', 'Сортировка', sorts),
    ...(genres.length ? [filter('triStateMultiSelect', 'genre', 'Жанры', genres)] : []),
    ...(tags.length ? [filter('triStateMultiSelect', 'tags', 'Теги', tags)] : []),
    ...choices.map(([key,label,options])=>filter('multiSelect',key,label,options)),
    filter('toggle', 'strictLabelEqual', 'Строгое совпадение жанров и тегов'),
    ...[['chaptersCountMin', 'Глав от'], ['chaptersCountMax', 'Глав до'],
      ['averageRatingMin', 'Рейтинг от'], ['averageRatingMax', 'Рейтинг до'],
      ['yearMin', 'Год от'], ['yearMax', 'Год до']].map(([key, label]) => filter('text', key, label)),
  ];
}

export const isValidChapterId = value =>
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(String(value).split('/').at(-1));
