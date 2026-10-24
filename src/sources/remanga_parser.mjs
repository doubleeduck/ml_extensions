import {chapter,filter,isoDate,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {finiteNumber,requireArray,requireRecord,requireText} from '../core/http.mjs';

const sorts = [['score','По популярности'],['id','По новизне'],['chapter_date','По дате обновления'],
  ['count_chapters','По количеству глав'],['rating','По оценке'],['count_rating','По количеству оценок'],['votes','По лайкам'],['views','По просмотрам']];
const optionGroups = [['types','Тип'],['genres','Жанры'],['categories','Категории'],['status','Статус выпуска'],['translate_status','Статус перевода']];
const ranges = [['count_chapters','Количество глав'],['rating','Рейтинг'],['issue_year','Год выпуска']];
const triState = new Set(['types','genres','categories']);
export function titleId(value) {
  const id = requireText(value,'ReManga title ID');
  if (id.includes('/') || id === '.' || id === '..') throw parseError('Invalid ReManga title ID.');
  return id;
}
export function numericId(value,field = 'chapter') {
  const id = requireText(value,`ReManga ${field} ID`);
  if (!/^[1-9]\d*$/u.test(id)) throw parseError(`Invalid ReManga ${field} ID.`);
  return id;
}
export function apiDate(value) {
  let text = string(value); if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) text += 'T00:00:00';
  text = text.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:?\d{2}|$)/iu,'$1');
  return isoDate(/(?:Z|[+-]\d{2}:?\d{2})$/iu.test(text) ? text : `${text}+03:00`);
}
const names = values => requireArray(values,'ReManga labels').map(value => requireText(requireRecord(value).name,'ReManga label'));
export function parseManga(input,base,{description = null} = {}) {
  const item = requireRecord(input,'ReManga title'), id = titleId(item.dir), cover = record(item.cover), status = record(item.status);
  const creatorNames = type => (item.creators == null ? [] : requireArray(item.creators,'ReManga creators')).filter(value => value.type === type).map(value => requireText(value.name,'ReManga creator')).join(', ') || null;
  const tags = [...new Set([...(item.genres == null ? [] : names(item.genres)),...(item.categories == null ? [] : names(item.categories))])];
  const rawCover = string(cover.high) ?? string(cover.mid) ?? string(cover.low);
  return manga({id,title:requireText(item.main_name,'ReManga title name'),secondaryTitle:string(item.secondary_name),
    coverUrl:rawCover ? new URL(rawCover,base).href : null,description,author:creatorNames(1),artist:creatorNames(4),
    status:({1:'completed',2:'ongoing',3:'hiatus',5:'announced'})[Number(status.id)] ?? string(status.name),
    type:string(record(item.type).name),ageRating:string(record(item.age_limit).name),rating:finiteNumber(item.avg_rating,null),
    releaseYear:item.issue_year == null ? null : requireText(item.issue_year,'ReManga release year'),tags});
}
export function parseCatalog(input,base,{related = false} = {}) {
  const data = requireRecord(input,'ReManga catalog'), seen = new Set();
  const items = requireArray(data.results,'ReManga catalog results').map(value => parseManga(related ? requireRecord(value,'ReManga recommendation').title : value,base))
    .filter(item => !seen.has(item.id) && seen.add(item.id));
  return {items,hasNextPage:data.next != null};
}
export function chapterAccess(input) {
  const item = requireRecord(input,'ReManga chapter');
  if (item.is_paid === true && item.is_bought !== true) return {
    type:'paid',availableAt:apiDate(item.pub_date),priceLabel:item.price == null ? null : String(item.price),
    message:'Эта глава требует покупки или подходящей подписки на ReManga.',
  };
  const availableAt = apiDate(item.delay_pub_date ?? item.pub_date);
  if (item.is_published === false) return {type:'temporarilyUnavailable',availableAt,priceLabel:null,message:'Глава пока не опубликована на ReManga.'};
  return {type:'available',availableAt:null,priceLabel:null,message:null};
}
export function parseChapter(input,{withPublisher = false} = {}) {
  const row = requireRecord(input,'ReManga chapter'), number = requireText(row.chapter,'ReManga chapter number'), title = string(normalizeText(row.name));
  const publisher = withPublisher && row.publishers != null ? names(row.publishers).join(', ') : '';
  return chapter({id:numericId(row.id),title:`${row.tome == null ? '' : `Том ${row.tome}. `}Глава ${number}${title ? ` — ${title}` : ''}${publisher ? ` — ${publisher}` : ''}`,
    number:finiteNumber(number,-1),uploadedAt:apiDate(row.upload_date),access:chapterAccess(row)});
}
export function parsePages(input,{imageServer = 'original'} = {}) {
  const data = requireRecord(input,'ReManga reader'), access = chapterAccess(data);
  if (access.type !== 'available') throw Object.assign(Error(access.message),{code:'chapter_unavailable',phase:'parse',access});
  const server = record(data.server), primary = new URL(requireText(server.link,'ReManga image server'));
  const fallback = string(server.fallback_link), reserve = fallback ? new URL(fallback) : null;
  // 'original' is the persisted automatic mode. The primary CDN can return a
  // Cloudflare block, so prefer the reserve explicitly supplied by this API.
  const target = imageServer === 'primary' ? primary : reserve;
  const origins = new Set([primary.origin,...(reserve ? [reserve.origin] : [])]);
  const pages = requireArray(data.pages,'ReManga reader pages').flatMap(group => Array.isArray(group) ? group : [group]);
  if (!pages.length) throw parseError('ReManga readable chapter has no pages.');
  return pages.map((value,index) => {
    const page = requireRecord(value,'ReManga page'), url = new URL(requireText(page.link,'ReManga page URL'),primary);
    // Keep every segment, including repeated separator images, in server order.
    // Server selection rewrites only an origin explicitly supplied by API.
    if (target && origins.has(url.origin)) {
      url.protocol = target.protocol; url.host = target.host;
    }
    return {index,imageUrl:url.href};
  });
}

/** Read JSON data embedded by Next.js, never execute downloaded scripts. */
export function parseFilterOptions(scripts) {
  let stream = '';
  for (const script of requireArray(scripts,'ReManga filter scripts')) {
    if (typeof script !== 'string' || !script.trim().startsWith('self.__next_f.push(')) continue;
    const text = script.trim(), prefix = 'self.__next_f.push(', suffix = text.endsWith(';') ? 2 : 1;
    try {
      const chunk = JSON.parse(text.slice(prefix.length,-suffix));
      if (chunk[0] === 1 && typeof chunk[1] === 'string') stream += chunk[1];
    } catch { /* Non-data or unrelated script. */ }
  }
  let visited = 0;
  function find(value,depth = 0) {
    if (!value || typeof value !== 'object') return null;
    if (depth > 48 || ++visited > 100000) throw Object.assign(Error('ReManga filter data limit.'),{code:'resource_limit',phase:'parse'});
    if (!Array.isArray(value) && Array.isArray(value.types) && Array.isArray(value.genres) && Array.isArray(value.categories)) return value;
    for (const child of Object.values(value)) {const result = find(child,depth+1); if (result) return result;}
    return null;
  }
  for (const line of stream.split('\n')) {
    if (!line.includes('"filtersOptions"')) continue;
    let value; try {value = JSON.parse(line.slice(line.indexOf(':')+1));} catch {continue;}
    const result = find(value); if (result) return result;
  }
  throw parseError('ReManga catalog filter data was not found.');
}
export function buildFilters(input) {
  const data = requireRecord(input,'ReManga filter options');
  const result = [filter('sort','sort','Сортировка',sorts)];
  for (const [key,label] of optionGroups) {
    const seen = new Set(), values = requireArray(data[key],`ReManga ${key}`).map(value => {
      const row = requireRecord(value,'ReManga filter option'); return [numericId(row.id,'filter'),requireText(row.name,'ReManga filter label')];
    }).filter(([id]) => !seen.has(id) && seen.add(id));
    result.push(filter(triState.has(key) ? 'triStateMultiSelect' : 'multiSelect',key,label,values));
  }
  const ages = requireArray(data.age_limit,'ReManga age limits').map(value => {
    const item = requireRecord(value,'ReManga age option'), id = requireText(item.id,'ReManga age ID');
    if (!/^\d+$/u.test(id)) throw parseError('Invalid ReManga age ID.');
    return [id,requireText(item.name,'ReManga age label')];
  });
  result.push(filter('multiSelect','age_limit','Возрастное ограничение',ages));
  result.push(filter('multiSelect','unstrict_search_fields','Нестрогий поиск',[['genres','Жанры'],['categories','Категории']],['genres','categories']));
  for (const [key,label] of ranges) result.push(filter('text',`${key}.min`,`${label}: от`),filter('text',`${key}.max`,`${label}: до`));
  return result;
}
export function searchParameters({searchTerm = '',page = 1,selectedFilters = {}} = {},forcedSort) {
  const selected = record(selectedFilters), field = forcedSort ?? selected.sort?.[0], sort = sorts.some(([key]) => key === field) ? field : 'score';
  const query = {count:30,page:Math.max(1,page),ordering:`${!forcedSort && selected.sort?.[1]?.toLowerCase() === 'asc' ? '' : '-'}${sort}`};
  const term = string(searchTerm); if (term) query.search = term;
  for (const [key] of optionGroups) {
    const included = new Set(), excluded = new Set();
    for (const raw of selected[key] ?? []) {
      const text = raw.trim(), exclude = triState.has(key) && text.startsWith('exclude:'), value = text.replace(/^(?:include|exclude):/u,'');
      if (/^[1-9]\d*$/u.test(value)) (exclude ? excluded : included).add(value);
    }
    if (included.size) query[key] = [...included]; if (excluded.size) query[`exclude_${key}`] = [...excluded];
  }
  const ages = [...new Set((selected.age_limit ?? []).filter(value => /^\d+$/u.test(value)))]; if (ages.length) query.age_limit = ages;
  const unstrict = [...new Set((selected.unstrict_search_fields ?? ['genres','categories']).filter(value => ['genres','categories'].includes(value)))];
  if (unstrict.length) query.unstrict_search_fields = unstrict;
  for (const [key] of ranges) for (const [side,suffix] of [['min','gte'],['max','lte']]) {
    const raw = string(selected[`${key}.${side}`]?.[0]), value = raw == null ? NaN : Number(raw);
    if (Number.isFinite(value) && value >= 0 && (key === 'rating' ? value <= 10 : Number.isInteger(value))) query[`${key}_${suffix}`] = value;
  }
  return query;
}
