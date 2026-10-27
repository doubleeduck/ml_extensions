import {chapter,filter,isoDate,manga,normalizeText,parseError,record,records,string} from '../core/data.mjs';
import {requireArray,requireRecord} from '../core/http.mjs';
import {flightData,flightValues} from '../core/script_json.mjs';

export const sorts = [['popularity','Популярность'],['rating','Рейтинг'],['view_count','Просмотры'],['chapter_count','Количество глав'],['released_on','Дата выхода'],['updated_at','Обновление'],['created_at','Добавление'],['name','Название']];
const types = [['manga','Манга'],['manhwa','Манхва'],['manhua','Маньхуа'],['comics','Комикс'],['oel','OEL'],['rumanga','Руманга'],['rukomiks','Рукомикс'],['one_shot','Ваншот'],['single','Сингл']];
const statuses = [['ongoing','Выходит'],['completed','Завершено'],['paused','Приостановлено'],['dropped','Заброшено']];
const labels = values => new Map(values);
export function numericId(value) {
  const id = String(value ?? '').trim();
  if (!/^[1-9]\d{0,14}$/u.test(id)) throw parseError('Invalid AstraManga ID.');
  return id;
}
const image = (value,base) => {
  const text = string(value); if (!text) return null;
  const url = new URL(text,/^https?:\/\//u.test(text) || text.startsWith('/') ? base : new URL('/media/',base));
  return ['https:','http:'].includes(url.protocol) ? url.href : null;
};
export function parseManga(raw,base) {
  const value = requireRecord(raw,'AstraManga title'), id = numericId(value.id), title = string(value.name ?? value.main_name ?? value.title);
  if (!title) throw parseError('AstraManga title has no name.');
  const authors = records(value.creators ?? value.persons ?? value.authors), publisher = type => authors.filter(row=>row.type === type).map(row=>string(row.name)).filter(Boolean).join(', ') || null;
  const tags = [...records(value.genres),...records(value.tags)].map(row=>string(record(row.genre ?? row.tag ?? row).name)).filter(Boolean);
  return manga({id,title,secondaryTitle:string(value.secondary_name),coverUrl:image(record(value.cover_versions).high ?? value.coverUrl ?? value.cover ?? value.cover_image,base),
    description:string(value.description),author:publisher('author'),artist:publisher('artist'),
    type:labels(types).get(value.type) ?? string(value.type),status:labels(statuses).get(value.status) ?? string(value.status),
    ageRating:({0:'0+',1:'16+',2:'18+'}[value.age_limit] ?? null),
    rating:typeof value.rating === 'number' && Number.isFinite(value.rating) ? value.rating : null,
    releaseYear:value.year == null ? null : String(value.year),tags:[...new Set(tags)]});
}
export function responseData(payload) {
  const data = requireRecord(payload,'AstraManga response');
  if (data.success === false || data.error != null) throw parseError('AstraManga returned an unsuccessful response.');
  return Object.hasOwn(data,'data') ? data.data : data;
}
export function parseCatalog(payload,base) {
  const data = requireRecord(responseData(payload),'AstraManga catalog');
  return requireArray(data.titles,'AstraManga titles').map(value=>parseManga(value,base));
}
export function parseTitleData(scripts) {
  const values = flightValues(flightData(scripts),'initialData');
  const data = values.find(value=>record(value).manga && Array.isArray(record(value).chapters));
  if (!data) throw parseError('AstraManga title page has no title or chapters.');
  return data;
}
export function parseChapters(data) {
  return requireArray(data.chapters,'AstraManga chapters').slice().sort((a,b)=>Number(b.volume_number ?? b.volume ?? 0)-Number(a.volume_number ?? a.volume ?? 0) || Number(b.number)-Number(a.number)).map(value=>{
    const number = Number(value.number), volume = Number(value.volume_number ?? value.volume);
    if (!Number.isFinite(number)) throw parseError('Invalid AstraManga chapter number.');
    const name = normalizeText(value.name ?? value.title), prefix = `${volume > 0 ? `Том ${volume}. ` : ''}Глава ${number}`;
    return chapter({id:numericId(value.id),title:name && !/^глава\s*[\d.]+$/iu.test(name) ? `${prefix}: ${name}` : prefix,number,uploadedAt:isoDate(value.published_at ?? value.created_at)});
  });
}
export function parsePages(payload) {
  const data = requireRecord(responseData(payload),'AstraManga reader');
  const pages = requireArray(data.pages,'AstraManga pages').slice().sort((a,b)=>Number(a.page_number)-Number(b.page_number));
  if (!pages.length || data.total != null && pages.length !== Number(data.total)) throw Object.assign(Error('AstraManga chapter page list is incomplete or unavailable.'),{code:'chapter_unavailable',phase:'parse'});
  return pages.map((page,index)=>{
    const imageUrl = string(page.image_url);
    if (!imageUrl || !/^https:\/\//u.test(imageUrl)) throw parseError('AstraManga page has no HTTPS image.');
    return {index,imageUrl};
  });
}
export function parseFilters(scripts) {
  const data = flightData(scripts), options = key => {
    const arrays = flightValues(data,key).filter(value=>Array.isArray(value) && value.length && value.every(row=>record(row).id != null && string(record(row).name)));
    const entries = arrays.sort((a,b)=>b.length-a.length)[0];
    if (!entries) throw parseError(`AstraManga ${key} are missing.`);
    return entries.map(row=>[String(row.id),row.name.trim()]);
  };
  return [filter('sort','sort','Сортировка',sorts),filter('multiSelect','types','Тип',types),filter('multiSelect','status','Статус',statuses),
    filter('triStateMultiSelect','genres','Жанры',options('genres')),filter('triStateMultiSelect','tags','Теги',options('tags')),
    filter('toggle','strict_filtering','Строгое совпадение жанров и тегов'),
    ...[['year_from','Год от'],['year_to','Год до'],['rating_from','Рейтинг от'],['rating_to','Рейтинг до'],['chapter_count_from','Глав от'],['chapter_count_to','Глав до']].map(([key,label])=>filter('text',key,label))];
}
export function catalogQuery({page=1,searchTerm='',selectedFilters={}}={},forcedSort) {
  const query = {page:Math.max(1,Math.trunc(Number(page)) || 1),size:24}, sort = selectedFilters.sort ?? [];
  const field = forcedSort ?? sort[0] ?? 'rating';
  if (!sorts.some(([value])=>value === field)) throw parseError('Invalid AstraManga sort.');
  query.sort = `${!forcedSort && sort[1] === 'asc' ? '' : '-'}${field}`;
  if (searchTerm.trim()) query.q = searchTerm.trim();
  for (const key of ['types','status']) if (selectedFilters[key]?.length) query[key] = [...new Set(selectedFilters[key])];
  for (const key of ['genres','tags']) {
    for (const raw of selectedFilters[key] ?? []) {
      const excluded = raw.startsWith('exclude:'), value = raw.replace(/^(include|exclude):/u,'');
      numericId(value); const name = excluded ? `exclude_${key}` : key;
      (query[name] ??= []).push(value);
    }
  }
  for (const key of ['year_from','year_to','rating_from','rating_to','chapter_count_from','chapter_count_to']) {
    const raw = selectedFilters[key]?.[0]; if (raw == null || raw === '') continue;
    const value = Number(String(raw).replace(',','.')), max = key.startsWith('rating') ? 10 : key.startsWith('year') ? 2200 : 100000;
    if (!Number.isFinite(value) || value < 0 || value > max || !key.startsWith('rating') && !Number.isInteger(value)) throw parseError(`Invalid AstraManga ${key}.`);
    query[key] = value;
  }
  if (selectedFilters.strict_filtering?.[0] === 'true') query.strict_filtering = true;
  return query;
}
