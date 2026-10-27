import {chapter,filter,manga,normalizeText,parseError,record,records,string} from '../core/data.mjs';
import {requireArray,requireRecord} from '../core/http.mjs';
import {assignedJson} from '../core/script_json.mjs';

export const sortOptions = [['date','Добавление'],['editdate','Обновление'],['rating','Популярность'],['news_read','Просмотры'],['comm_num','Комментарии'],['title','Название'],['year','Год']];
export function titleId(value) {
  const text = String(value ?? '').trim();
  if (/^[1-9]\d{0,11}$/u.test(text)) return text;
  let path; try {path = new URL(text,'https://com-x.life').pathname;} catch {throw parseError('Invalid Com-X title ID.');}
  const match = /^\/([1-9]\d{0,11})-[^/]+\.html$/u.exec(path);
  if (!match) throw parseError('Invalid Com-X title ID.');
  return match[1];
}
export function chapterId(value) {
  const match = /^(?:\/reader\/)?([1-9]\d{0,11})\/([1-9]\d{0,14})\/?$/u.exec(String(value ?? ''));
  if (!match) throw parseError('Invalid Com-X chapter ID.');
  return {title:match[1],chapter:match[2]};
}
const picture = (input,base) => {
  for (const value of [record(input).lazy,record(input).src]) {
    const text = string(value); if (!text || /^(?:data|blob|javascript):/iu.test(text)) continue;
    const url = new URL(text,base); if (url.protocol === 'https:') return url.href;
  }
  return null;
};
function names(raw) {
  const parts = normalizeText(raw).split(' / '), last = parts.at(-1);
  return parts.length > 1 && /[а-яё]/iu.test(last) ? {title:last,secondaryTitle:parts.slice(0,-1).join(' / ')} : {title:parts.join(' / '),secondaryTitle:null};
}
export function parseListing(input,base,exclude=null) {
  const seen = new Set(exclude == null ? [] : [String(exclude)]), result = [];
  for (const row of requireArray(input,'Com-X listing')) {
    let id; try {id = titleId(row.href ?? row.link);} catch {continue;}
    if (seen.has(id)) continue;
    const value = names(string(row.title) ?? record(row.image).alt), coverUrl = picture(row.image,base);
    if (!value.title || !coverUrl) continue;
    seen.add(id);
    const rating = Number.parseFloat(normalizeText(row.rating).replace(',','.'));
    result.push(manga({id,...value,coverUrl,rating:Number.isFinite(rating) ? rating*2 : null,
      releaseYear:(row.metadata ?? []).map(normalizeText).find(value=>/^(?:19|20)\d{2}$/u.test(value)) ?? null}));
  }
  return result;
}
export function parseDetails(input,base) {
  const data = requireRecord(input,'Com-X details'), raw = assignedJson(requireArray(data.scripts,'Com-X scripts'),'__DATA__');
  const id = titleId(raw.news_id), value = names(data.title);
  if (!value.title) throw parseError('Com-X title is missing.');
  const metadata = Object.fromEntries(records(data.metadata).map(row=>{
    const label = normalizeText(row.label), text = normalizeText(row.value);
    return [label.replace(/:$/u,'').toLowerCase(),text.startsWith(label) ? text.slice(label.length).replace(/^:\s*/u,'').trim() : text];
  }));
  const rating = Number.parseFloat(normalizeText(data.rating).replace(',','.'));
  return {info:manga({id,...value,secondaryTitle:string(data.secondaryTitle) ?? value.secondaryTitle,coverUrl:picture(data.image,base),
    description:string(data.description),author:string(metadata.автор),artist:string(metadata.художник),status:string(metadata.статус),
    releaseYear:string(metadata.год),tags:[...new Set(requireArray(data.tags,'Com-X genres').map(normalizeText).filter(Boolean))],
    rating:Number.isFinite(rating) ? rating*2 : null}),chapters:raw,recommendations:parseListing(data.recommendations ?? [],base,id)};
}
export function parseChapters(data,expectedId) {
  if (titleId(data.news_id) !== titleId(expectedId)) throw parseError('Com-X returned another title.');
  const seen = new Set();
  return requireArray(data.chapters,'Com-X chapters').slice().sort((a,b)=>Number(b.posi)-Number(a.posi)).flatMap(row=>{
    const id = `${titleId(data.news_id)}/${String(row.id)}`; chapterId(id);
    if (seen.has(id)) return []; seen.add(id);
    const number = Number(row.number), volume = Number(row.volume);
    if (!Number.isFinite(number)) throw parseError('Invalid Com-X chapter number.');
    const date = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(String(row.date ?? ''));
    return [chapter({id,title:string(row.title) ?? `${volume > 0 ? `Том ${volume}. ` : ''}Глава ${number}`,number,
      uploadedAt:date ? new Date(Date.UTC(Number(date[3]),Number(date[2])-1,Number(date[1]))).toISOString() : null})];
  });
}
export function parsePages(scripts,id,{server='auto',cookieHeader=''}={}) {
  const expected = chapterId(id), data = assignedJson(requireArray(scripts,'Com-X reader scripts'),'__DATA__');
  if (String(data.news_id) !== expected.title || String(data.chapter_id) !== expected.chapter) throw parseError('Com-X returned another chapter.');
  const hosts = new Set(['img.com-x.life','rus.com-x.life']);
  const cookieValue = /(?:^|;\s*)cx_imghost=([^;]+)/u.exec(cookieHeader)?.[1];
  const cookieHost = ({rus:data.host_ru,img:data.host}[cookieValue]) ?? cookieValue;
  const host = server === 'ru' ? data.host_ru : server === 'global' ? data.host : hosts.has(cookieHost) ? cookieHost : data.host;
  if (!hosts.has(host)) throw parseError('Unknown Com-X image server.');
  const images = requireArray(data.images,'Com-X images');
  if (!images.length || data.pages != null && images.length !== Number(data.pages)) throw Object.assign(Error('Com-X reader page list is incomplete.'),{code:'chapter_unavailable',phase:'parse'});
  return images.map((value,index)=>{
    if (typeof value !== 'string') throw parseError('Invalid Com-X page URL.');
    const url = new URL(value,`https://${host}/comix/`);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || !url.pathname.startsWith(`/comix/${expected.title}/${expected.chapter}/`)) throw parseError('Invalid Com-X page origin or chapter.');
    return {index,imageUrl:url.href};
  });
}
export function parseFilters(scripts) {
  const data = assignedJson(requireArray(scripts,'Com-X catalog scripts'),'__XFILTER__'), fields = requireRecord(data.filter_items,'Com-X filter definitions');
  const result = [{...filter('sort','sort','Сортировка',sortOptions),caption:'Сортировка и фильтры применяются к каталогу. Поиск по названию на сайте расположен отдельно.'}];
  for (const key of ['p.cat','g','t','st']) {
    const row = requireRecord(fields[key],`Com-X ${key} filter`);
    const values = requireArray(row.values,'Com-X filter options').flatMap(option=>string(option.value) ? [[String(option.id),normalizeText(option.value)]] : []);
    result.push(filter('triStateMultiSelect',key,row.title,values));
  }
  return [...result,filter('text','yearFrom','Год от'),filter('text','yearTo','Год до'),filter('text','a','Автор (англ.)'),filter('text','artist','Художник (англ.)')];
}
export function catalogRequest(base,{page=1,searchTerm='',selectedFilters={}}={},forcedSort) {
  const segments = [], currentPage = Math.max(1,Math.trunc(Number(page))||1), order = selectedFilters.sort ?? [];
  const sort = forcedSort ?? order[0] ?? 'date', direction = !forcedSort && order[1] === 'asc' ? 'asc' : 'desc';
  if (!sortOptions.some(([value])=>value === sort)) throw parseError('Invalid Com-X sort.');
  for (const key of ['p.cat','g','t','st']) {
    for (const [prefix,name] of [['include:',key],['exclude:',`exc_${key}`]]) {
      const values = [...new Set((selectedFilters[key] ?? []).filter(v=>prefix === 'include:' ? !v.startsWith('exclude:') : v.startsWith(prefix)).map(v=>v.replace(/^(include|exclude):/u,'')))];
      if (values.some(value=>!/^\d{1,8}$/u.test(value))) throw parseError('Invalid Com-X filter option.');
      if (values.length) segments.push(`${name}=${values.join(',')}`);
    }
  }
  for (const [key,field] of [['yearFrom','y[from]'],['yearTo','y[to]'],['a','a'],['artist','artist']]) {
    const value = selectedFilters[key]?.[0]?.trim(); if (!value) continue;
    if (key.startsWith('year') && !/^(?:19|20|21)\d{2}$/u.test(value) || value.length > 200) throw parseError('Invalid Com-X filter value.');
    segments.push(`${field}=${encodeURIComponent(value)}`);
  }
  if (searchTerm.trim()) {
    if (segments.length || order.length) throw Object.assign(Error('Com-X has separate title search and catalog filters.'),{code:'unsupported',phase:'filters'});
    return {method:'GET',url:new URL(`/search/${encodeURIComponent(searchTerm.trim())}${currentPage > 1 ? `/page/${currentPage}/` : ''}`,base).href};
  }
  const path = segments.length ? `/ComicList/${segments.join('/')}/` : '/comix-read/';
  const url = new URL(`${path}${currentPage > 1 ? `page/${currentPage}/` : ''}`,base).href;
  const context = segments.length ? 'xfilter' : 'cat_1';
  return {method:'POST',url,headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:new URL(base).origin},body:new URLSearchParams({
    dlenewssortby:sort,dledirection:direction,set_new_sort:`dle_sort_${context}`,set_direction_sort:`dle_direction_${context}`,
  }).toString()};
}
