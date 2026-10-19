import {chapter, filter, isoDate, manga, parseError, record, records, string} from '../core/data.mjs';
import {finiteNumber, requireRecord, requireText} from '../core/http.mjs';

const scalar = value => typeof value === 'string' || typeof value === 'number' ? String(value) : null;
const nestedLabel = value => string(record(value).label) ?? string(record(value).name);
export function uniqueLabels(values) {
  const seen = new Set();
  return values.map(string).filter(value => value && !seen.has(value.toLowerCase()) && seen.add(value.toLowerCase()));
}
export const labels = value => uniqueLabels(records(value).map(item => scalar(item.name) ?? scalar(item.label)));
function titleOf(item, settings) {
  const order = settings.titleLanguage === 'rus' ? ['rus_name','eng_name','name'] : ['eng_name','rus_name','name'];
  return requireText(order.map(key => string(item[key])).find(Boolean),'LibGroup title');
}
function secondary(item, title) {
  return [scalar(item.eng_name),scalar(item.name),...(Array.isArray(item.otherNames) ? item.otherNames.map(scalar) : [])]
    .map(string).find(candidate => candidate && candidate !== title) ?? null;
}
function cover(item) {
  const value = record(item.cover);
  return scalar(value.md) ?? scalar(value.default) ?? scalar(value.thumbnail);
}
function year(item) {
  const text = scalar(item.releaseDateString);
  const match = text?.match(/\b(\d{4})\b/u)?.[1];
  if (match) return match;
  if (Number.isInteger(item.releaseDate)) return String(item.releaseDate);
  return scalar(item.releaseDate)?.match(/\b(\d{4})\b/u)?.[1] ?? null;
}
function mangaId(item) {
  const id = scalar(item.slug_url);
  if (id) return id;
  const numeric = scalar(item.id), slug = scalar(item.slug);
  if (numeric && slug) return `${numeric}--${slug}`;
  throw parseError('LibGroup manga is missing slug_url and fallback id.');
}
export function parseCatalogManga(value, settings) {
  const item = requireRecord(value,'LibGroup manga'), title = titleOf(item,settings);
  return manga({id:mangaId(item),title,secondaryTitle:secondary(item,title),coverUrl:cover(item),
    status:nestedLabel(item.status),type:nestedLabel(item.type),ageRating:nestedLabel(item.caution),
    rating:finiteNumber(record(item.rating).average,null),releaseYear:year(item),tags:labels(item.genres)});
}
function richText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(richText).join('');
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'text') return typeof value.text === 'string' ? value.text : '';
  if (value.type === 'hardBreak') return '\n';
  if (!Array.isArray(value.content)) return '';
  const separator = ['doc','blockquote','bulletList','orderedList'].includes(value.type) ? '\n' : '';
  const parts = value.content.map(richText).filter(part => separator ? part.trim() : part);
  return parts.join(separator);
}
export function summary(value) {
  return string(typeof value === 'string' ? value : Array.isArray(value) ? value.map(richText).join('\n') : richText(value));
}
export function needsTitlePreview(details, settings) {
  return !string(settings.titleLanguage === 'rus' ? details.rus_name ?? details.name : details.eng_name);
}
export function parseDetails({preview,details,settings}) {
  const source = details ?? preview;
  if (!source) throw Object.assign(new Error('LibGroup title could not be found'),{code:'title_not_found'});
  const merged = {...preview,...details};
  for (const key of ['eng_name','rus_name','name','otherNames','slug_url']) {
    const meaningful = value => typeof value === 'string' ? !!value.trim() : Array.isArray(value) ? !!value.length : value != null;
    if (meaningful(details?.[key])) merged[key] = details[key];
    else if (meaningful(preview?.[key])) merged[key] = preview[key];
  }
  const title = titleOf(merged,settings);
  let description = null;
  for (const item of [details,preview]) {
    if (!item) continue;
    for (const key of ['summary','description','annotation']) {
      description = summary(item[key]); if (description) break;
    }
    if (description) break;
  }
  return manga({id:mangaId(source),title,coverUrl:cover(source) ?? cover(preview ?? source),description,
    secondaryTitle:secondary(merged,title),author:labels(source.authors).join(', ') || labels(preview?.authors).join(', ') || null,
    artist:labels(source.artists).join(', ') || labels(preview?.artists).join(', ') || null,
    status:nestedLabel(source.status) ?? nestedLabel(preview?.status),
    type:nestedLabel(source.type) ?? nestedLabel(source.format) ?? nestedLabel(preview?.type),
    ageRating:nestedLabel(source.caution) ?? nestedLabel(preview?.caution),
    rating:finiteNumber(record(source.rating).average,null) ?? finiteNumber(record(preview?.rating).average,null),
    releaseYear:year(source) ?? year(preview ?? source),tags:uniqueLabels([...labels(details?.genres),...labels(details?.tags)])});
}
export function parseAccess(value, fallback = {}) {
  const restricted = value.restricted_view ?? fallback.restricted_view;
  const available = {type:'available',availableAt:null,priceLabel:null,message:null};
  if (!restricted || typeof restricted !== 'object' || restricted.is_open !== false) return available;
  const at = isoDate(scalar(restricted.expired_at) ?? scalar(value.expired_at) ?? scalar(fallback.expired_at));
  return {...available,type:at ? 'temporarilyUnavailable' : 'paid',availableAt:at,priceLabel:scalar(restricted.price)};
}
export function unavailable(access) {
  return Object.assign(new Error(access.type === 'paid' ? 'This chapter requires paid access on the source.' : 'This chapter is temporarily unavailable.'),
    {code:'chapter_unavailable',access});
}
export function parseChapterEntries(value, settings) {
  const item = requireRecord(value,'chapter'), volume = scalar(item.volume) ?? '0', number = requireText(item.number,'chapter.number');
  const base = `Vol. ${volume} Ch. ${number}`, branches = records(item.branches);
  const title = (...parts) => [base,scalar(item.name),...parts].map(string).filter(Boolean).join(' - ');
  const chapterNumber = finiteNumber(number,finiteNumber(item.item_number));
  if (settings.chapterMode === 'ms_combining' && branches.length) return branches.map(branch => {
    const id = scalar(branch.branch_id) ?? scalar(branch.id);
    const label = labels(branch.teams).join(', ') || (settings.showAlternativeBranchSource ? scalar(record(branch.user).username) : null);
    return chapter({id:[volume,number,...(id ? [id] : [])].join('|'),title:title(label),number:chapterNumber,
      uploadedAt:isoDate(scalar(branch.created_at)),access:parseAccess(branch,item)});
  });
  const direct = parseAccess(item), first = branches[0];
  return [chapter({id:`${volume}|${number}`,title:title(),number:chapterNumber,
    uploadedAt:isoDate(scalar(first?.created_at)),access:direct.type !== 'available' || !first ? direct : parseAccess(first,item)})];
}
export function decodeChapterId(id) {
  const segments = id.split('|');
  if (segments.length < 2 || segments.length > 3 || segments.some(value => !value)) throw parseError('Unsupported LibGroup chapter ID.');
  return {volume:segments[0],number:segments[1],...(segments[2] ? {branch_id:segments[2]} : {})};
}
export function searchParameters(query) {
  const params = {}, filters = query.selectedFilters ?? {};
  if (query.searchTerm.trim()) params.q = query.searchTerm.trim();
  const values = key => (filters[key] ?? []).map(value => value.trim()).filter(Boolean);
  for (const key of ['types','scanlate_status','status','caution']) if (values(key).length) params[`${key}[]`] = values(key);
  for (const key of ['format','genres','tags','bookmarks']) for (const [state,suffix] of [['include',''],['exclude','_exclude']]) {
    const items = values(key).filter(value => value.startsWith(`${state}:`)).map(value => value.slice(state.length+1).trim()).filter(Boolean);
    if (items.length) params[`${key}${suffix}[]`] = items;
  }
  if (filters.sort?.length) {
    if (filters.sort[0].trim()) params.sort_by = filters.sort[0].trim();
    params.sort_type = filters.sort[1]?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
  }
  if (filters.require_chapters?.includes('true')) params.chap_count_min = '1';
  return params;
}
export function parseFilters(constants, siteId) {
  const options = (key,field = 'name') => records(constants[key]).filter(item => (item.site_ids ?? []).some(value => Number(value) === siteId))
    .map(item => [scalar(item.id),scalar(item[field])]).filter(([id,label]) => id != null && label != null);
  return [filter('sort','sort','Sort by',[['views','Popularity'],['rate_avg','Rating'],['name','Name (A-Z)'],['rus_name','Russian name'],
    ['releaseDate','Release date'],['created_at','Date added'],['last_chapter_at','Latest update'],['chap_count','Chapter count']]),
  filter('multiSelect','types','Type',options('types','label')),
  filter('triStateMultiSelect','format','Format',options('format')),
  filter('triStateMultiSelect','genres','Genres',options('genres')),
  filter('triStateMultiSelect','tags','Tags',options('tags')),
  filter('multiSelect','scanlate_status','Translation status',options('scanlateStatus','label')),
  filter('multiSelect','status','Title status',options('status','label')),
  filter('multiSelect','caution','Age restriction',options('ageRestriction','label')),
  filter('triStateMultiSelect','bookmarks','My lists',[['1','Reading'],['2','Planned'],['3','Dropped'],['4','Completed'],['5','Favorites']]),
  filter('toggle','require_chapters','Only titles with chapters')]
    .filter(item => ['sort','toggle'].includes(item.kind) || item.options.length);
}
