import {filter,normalizeText,record,string} from '../core/data.mjs';
import {requireArray,requireRecord} from '../core/http.mjs';
const sorts = [['RATING','Popular'],['POPULARITY','Popular now'],['YEAR','Year'],['NAME','Alphabetical'],['DATE_CREATE','Date added'],['DATE_UPDATE','Latest update'],['USER_RATING','User rating']];
export const fallbackSort = () => filter('sort','sortType','Sort',sorts);
export const filterProjection = {fields:{scripts:{selector:'script',all:true,text:true,normalizeWhitespace:false},
  rows:{selector:'.search-form-advanced .form-group.row',all:true,fields:{
    sort:{selector:'select[name="sortType"] option',all:true,fields:{value:{attr:'value'},label:{text:true}}},
    anchorLabel:{selector:'.col-form-label a',text:true},label:{selector:'.col-form-label',text:true,normalizeWhitespace:false},
    values:{selector:'li.property input[type=hidden]',all:true,fields:{value:{attr:'name'},parent:{ascend:1,fields:{
      title:{selector:'span',attr:'title'},span:{selector:'span',text:true},text:{text:true}}}}}}}}};
const options = values => Object.entries(record(values)).filter(([key,value]) => key.trim() && String(value ?? '').length)
  .map(([key,value]) => [key.trim(),normalizeText(String(value ?? ''))]).filter(([,label]) => label);
function decode(value) {
  try { return JSON.parse(value); } catch {
    try { return JSON.parse(value.replace(/([,{]\s*)([A-Za-z][A-Za-z0-9_]*)\s*:/gu,'$1"$2":')); } catch { return null; }
  }
}
const number = value => typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : typeof value === 'string' && /^[+-]?\d+$/u.test(value) ? Number(value) : null;
export function parseFilters(input,tagOptions = []) {
  const root = requireRecord(input,'GroupLe filters'), data = {}; let min = null, max = null;
  for (const script of requireArray(root.scripts,'GroupLe filter scripts')) {
    if (!script.includes('window.__FILTERS')) continue;
    for (const match of script.matchAll(/window\.__FILTERS\.(\w+)\s*=\s*(\{.*?\});/gsu)) {
      const value = decode(match[2]); if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (match[1] === 'years') { min = number(value.min); max = number(value.max); }
      else data[match[1]] = value;
    }
  }
  if (Object.keys(data).length || min != null || max != null) {
    const sort = options(data.sortType), result = [sort.length ? filter('sort','sortType','Sort',sort) : fallbackSort()];
    for (const [key,label] of [['genre','Genres'],['tags','Tags'],['category','Categories'],['productionStatus','Release status'],
      ['translationStatus','Translation status'],['limitation','Age rating'],['another','Other'],['searchFilters','Filters']]) {
      const values = key === 'tags' ? tagOptions : options(data[key]);
      if (values.length) result.push(filter('triStateMultiSelect',key,label,values));
    }
    if (min != null || max != null) result.push({...filter('text','years:min','Year from'),caption:min == null ? null : String(min)},
      {...filter('text','years:max','Year to'),caption:max == null ? null : String(max)});
    return result;
  }
  const result = [], used = new Set(); let sortAdded = false;
  for (const value of requireArray(root.rows,'GroupLe legacy filters')) {
    const row = requireRecord(value,'GroupLe filter group'), sort = requireArray(row.sort,'GroupLe sort options')
      .filter(value => string(value.value)).map(value => [value.value.trim(),sorts.find(([key]) => key === value.value.trim().toUpperCase())?.[1] ?? normalizeText(value.label)]);
    if (sort.length && !sortAdded) { result.push(filter('sort','sortType','Sort',sort)); used.add('sortType'); sortAdded = true; continue; }
    const label = string(normalizeText(row.anchorLabel)) ?? string(row.label?.split('\n').map(normalizeText).find(Boolean));
    if (!label) continue;
    const seen = new Set(), values = [];
    for (const value of requireArray(row.values,'GroupLe filter values')) {
      const id = string(value.value), parent = record(value.parent), label = string(normalizeText(parent.title)) ?? string(normalizeText(parent.span)) ?? string(normalizeText(parent.text));
      if (!id || !label || seen.has(id)) continue; seen.add(id); values.push([id,label]);
    }
    if (!values.length) continue;
    const slug = label.toLowerCase().replace(/[^a-z0-9а-яё]+/gu,'-').replace(/^-|-$/gu,'') || 'filter', original = `group:${slug}`;
    let key = original, suffix = 2; while (used.has(key)) key = `${original}:${suffix++}`;
    result.push(filter('triStateMultiSelect',key,label,values)); used.add(key);
  }
  if (!sortAdded) result.unshift(fallbackSort());
  return result;
}
export function searchParameters({page = 1,searchTerm = '',selectedFilters = {}} = {},forcedSort) {
  const params = {offset:[String(50*(Math.max(1,page)-1))],...(searchTerm.trim() ? {q:[searchTerm.trim()]} : {}),sortType:[forcedSort ?? string(selectedFilters.sortType?.[0]) ?? 'DATE_UPDATE']};
  const names = {productionStatus:'ProductionStatuses',translationStatus:'TranslationStatuses',searchFilters:'SearchFilter'};
  for (const [key,values] of Object.entries(selectedFilters)) {
    if (['sortType','years:min','years:max'].includes(key)) continue;
    for (const raw of values) {
      const value = raw.trim(), prefix = value.startsWith('include:') ? 'include' : value.startsWith('exclude:') ? 'exclude' : null;
      if (!prefix) continue; const id = value.slice(prefix.length+1).trim(); if (!id) continue;
      (params[`${prefix}${names[key] ?? 'ElementIds'}`] ??= []).push(id);
    }
  }
  const year = key => { const value = selectedFilters[key]?.[0]?.trim(); return value && /^[+-]?\d+$/u.test(value) ? value : null; };
  const min = year('years:min'), max = year('years:max'); if (min != null || max != null) params.years = [`${min ?? ''},${max ?? ''}`];
  return params;
}
