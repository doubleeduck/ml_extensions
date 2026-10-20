import {recent} from '../core/recent.mjs';
import {chapter, filter, isoDate, manga, record, records, string} from '../core/data.mjs';
import {finiteNumber, requireArray, requireRecord, requireText, urlWithQuery} from '../core/http.mjs';
import {tagGroups} from './mangadex_tags.mjs';

export const defaultRatings = ['safe','suggestive'];
export const allRatings = [...defaultRatings,'erotica','pornographic'];
export const defaultLanguages = ['ja','zh','zh-hk','ko'];
const values = raw => (Array.isArray(raw) ? raw : []).map(value => value.trim()).filter(Boolean);

export function buildFilters() {
  const result = [
    filter('toggle','has_available_chapters','Has available chapters'),
    filter('multiSelect','original_language','Original language',[['ja','Japanese'],['zh','Chinese'],['ko','Korean']]),
    filter('multiSelect','content_rating','Content rating',allRatings.map(value => [value, {safe:'Safe',suggestive:'Suggestive',erotica:'Erotica',pornographic:'Pornographic'}[value]])),
    filter('multiSelect','publication_demographic','Publication demographic',['none','shounen','shoujo','seinen','josei'].map(value => [value,value[0].toUpperCase()+value.slice(1)])),
    filter('multiSelect','status','Status',['ongoing','completed','hiatus','cancelled'].map(value => [value,value[0].toUpperCase()+value.slice(1)])),
    filter('sort','sort','Sort by',[['title','Alphabetic'],['latestUploadedChapter','Latest uploaded chapter'],['followedCount','Number of follows'],
      ['createdAt','Content created at'],['updatedAt','Content info updated at'],['relevance','Relevance'],['year','Year'],['rating','Rating']]),
    filter('singleSelect','included_tags_mode','Included tags mode',[['AND','AND'],['OR','OR']]),
    filter('singleSelect','excluded_tags_mode','Excluded tags mode',[['AND','AND'],['OR','OR']]),
    ...tagGroups.map(group => filter('triStateMultiSelect',group.key,group.label,group.tags)),
  ];
  result[0].caption = 'Restrict results to titles that already have chapters in this source language.';
  result[1].caption = 'Defaults to Japanese, Chinese and Korean.';
  result[2].caption = 'Defaults to Safe and Suggestive.';
  result[6].caption = 'Used when at least one tag is included.';
  result[7].caption = 'Used when at least one tag is excluded.';
  return result;
}

export function searchParameters({searchTerm = '', page = 1, selectedFilters = {}}, language) {
  const query = {limit:20, offset:Math.max(0,page-1)*20,'includes[]':['cover_art']};
  const term = searchTerm.trim().replace(/\s+/gu,' ');
  if (term) query.title = term;
  if (values(selectedFilters.has_available_chapters).some(value => value.toLowerCase() === 'true')) {
    query.hasAvailableChapters = 'true'; query['availableTranslatedLanguage[]'] = [language];
  }
  const languages = values(selectedFilters.original_language);
  query['originalLanguage[]'] = languages.length ? [...new Set([...languages,...(languages.includes('zh') ? ['zh-hk'] : [])])] : [...defaultLanguages];
  const ratings = values(selectedFilters.content_rating);
  query['contentRating[]'] = ratings.length ? ratings : [...defaultRatings];
  for (const [key, parameter] of [['publication_demographic','publicationDemographic[]'],['status','status[]']]) {
    const selected = values(selectedFilters[key]); if (selected.length) query[parameter] = selected;
  }
  const sort = values(selectedFilters.sort);
  if (sort.length) query[`order[${sort[0]}]`] = sort[1]?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const included = [], excluded = [];
  for (const group of tagGroups) {
    for (const value of values(selectedFilters[group.key])) {
      if (value.startsWith('include:') && value.slice(8).trim()) included.push(value.slice(8).trim());
      else if (value.startsWith('exclude:') && value.slice(8).trim()) excluded.push(value.slice(8).trim());
    }
  }
  if (included.length) { query['includedTags[]'] = included; query.includedTagsMode = values(selectedFilters.included_tags_mode)[0] ?? 'AND'; }
  if (excluded.length) { query['excludedTags[]'] = excluded; query.excludedTagsMode = values(selectedFilters.excluded_tags_mode)[0] ?? 'OR'; }
  return query;
}

function localized(value, language, fallback = ['en','ja-ro','ja']) {
  const map = record(value);
  for (const key of [language,...fallback]) if (string(map[key])) return string(map[key]);
  return Object.values(map).map(string).find(Boolean) ?? null;
}
function uniqueText(list) {
  const seen = new Set();
  return list.filter(value => value && !seen.has(value.toLowerCase()) && seen.add(value.toLowerCase()));
}
function relationshipId(relationships, type) {
  return string(records(relationships).find(item => item.type === type)?.id);
}
export function parseManga(value, language) {
  const item = requireRecord(value,'manga'), id = requireText(item.id,'manga.id');
  const attributes = requireRecord(item.attributes,'manga.attributes');
  const title = requireText(localized(attributes.title,language),'manga.title');
  const relationships = records(item.relationships);
  const cover = relationships.filter(item => item.type === 'cover_art').map(item => string(record(item.attributes).fileName)).find(Boolean);
  const names = type => uniqueText(relationships.filter(item => item.type === type).map(item => string(record(item.attributes).name))).join(', ') || null;
  const alternatives = uniqueText((Array.isArray(attributes.altTitles) ? attributes.altTitles : []).map(item => localized(item,language)));
  return manga({id,title,coverUrl:cover ? `https://uploads.mangadex.org/covers/${id}/${cover}` : null,
    secondaryTitle:alternatives.find(value => value !== title) ?? null,
    description:localized(attributes.description,language),author:names('author'),artist:names('artist'),
    status:string(attributes.status),type:string(attributes.publicationDemographic),ageRating:string(attributes.contentRating),
    releaseYear:attributes.year == null ? null : String(Math.trunc(finiteNumber(attributes.year))),
    tags:uniqueText(records(attributes.tags).map(tag => localized(record(tag.attributes).name,language,['en'])))});
}
export function parseChapter(value) {
  const item = requireRecord(value,'chapter'), attributes = requireRecord(item.attributes,'chapter.attributes');
  const scalar = value => typeof value === 'number' ? String(value) : string(value);
  const volume = scalar(attributes.volume), number = scalar(attributes.chapter), title = scalar(attributes.title);
  const prefix = [volume ? `Vol. ${volume}` : '', number ? `Ch. ${number}` : ''].filter(Boolean).join(' ');
  return chapter({id:requireText(item.id,'chapter.id'),number:finiteNumber(number),
    title:!title || title === number ? prefix || 'Chapter' : prefix ? `${prefix} - ${title}` : title,
    uploadedAt:isoDate(attributes.publishAt ?? attributes.readableAt ?? attributes.createdAt)});
}

// Shared implementation, separate ctx/cache/session for en and ru source IDs.
export default function createMangaDex(ctx) {
  const language = ctx.parameters.translatedLanguage;
  if (!['ru','en'].includes(language)) throw new Error('Unsupported MangaDex language configuration');
  async function json(path, query = {}) {
    const response = await ctx.http.request({method:'GET',url:urlWithQuery(path,'https://api.mangadex.org',query),responseType:'json',
      headers:{Accept:'application/json',Origin:'https://mangadex.org',Referer:'https://mangadex.org/'}});
    return requireRecord(response.body);
  }
  const related = recent(async mangaId => [...new Set(data(await json(`/manga/${encodeURIComponent(mangaId)}/recommendation`))
    .flatMap(item => records(requireRecord(item).relationships)).filter(item => item.type === 'manga')
    .map(item => string(item.id)).filter(id => id && id !== mangaId))]);
  function data(payload) { return requireArray(payload.data); }
  function collection(payload) { return data(payload).map(item => parseManga(item,language)); }
  async function byIds(ids) {
    if (!ids.length) return new Map();
    const items = collection(await json('/manga',{'ids[]':ids,limit:ids.length,'includes[]':['cover_art'],'contentRating[]':allRatings}));
    return new Map(items.map(item => [item.id,item]));
  }
  async function popular({page = 1} = {}) {
    return collection(await json('/manga',{limit:20,offset:Math.max(0,page-1)*20,'order[followedCount]':'desc',
      'availableTranslatedLanguage[]':[language],'includes[]':['cover_art'],'contentRating[]':defaultRatings,'originalLanguage[]':defaultLanguages}));
  }
  return {
    async getFilters() { return buildFilters(); },
    getPopular:popular,
    async getLatest({page = 1} = {}) {
      const entries = data(await json('/chapter',{limit:100,offset:Math.max(0,page-1)*100,'translatedLanguage[]':[language],
        'order[publishAt]':'desc',includeFuturePublishAt:'0',includeEmptyPages:'0','includes[]':['manga'],
        'contentRating[]':defaultRatings,'originalLanguage[]':defaultLanguages}));
      const ids = [...new Set(entries.map(item => relationshipId(requireRecord(item).relationships,'manga')).filter(Boolean))];
      const map = await byIds(ids);
      return ids.map(id => map.get(id)).filter(Boolean);
    },
    async search(query) {
      if (!query.searchTerm.trim() && !Object.values(query.selectedFilters ?? {}).some(items => values(items).length)) return popular(query);
      const direct = query.searchTerm.trim().match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/u)?.[0];
      if (direct) return collection(await json('/manga',{'ids[]':[direct],'includes[]':['cover_art'],'contentRating[]':allRatings})).slice(0,1);
      return collection(await json('/manga',searchParameters(query,language)));
    },
    async getDetails({mangaId}) {
      return parseManga((await json(`/manga/${encodeURIComponent(mangaId)}`,{'includes[]':['cover_art','author','artist']})).data,language);
    },
    async getChapters({mangaId}) {
      const result = [], seen = new Set();
      let offset = 0;
      for (let request = 0; request < 200; request++) {
        const payload = await json(`/manga/${encodeURIComponent(mangaId)}/feed`,{limit:500,offset,'translatedLanguage[]':[language],
          'order[volume]':'desc','order[chapter]':'desc','order[publishAt]':'desc',includeFuturePublishAt:'0',includeEmptyPages:'0','contentRating[]':allRatings});
        const entries = data(payload);
        if (!entries.length) return result;
        for (const item of entries) {
          const attributes = requireRecord(requireRecord(item).attributes);
          if (string(attributes.externalUrl) || finiteNumber(attributes.pages) <= 0) continue;
          const chapter = parseChapter(item);
          if (!seen.has(chapter.id)) { seen.add(chapter.id); result.push(chapter); }
        }
        const next = finiteNumber(payload.offset,offset) + finiteNumber(payload.limit,500);
        if (next >= finiteNumber(payload.total)) return result;
        if (next <= offset) throw new Error('MangaDex pagination did not advance');
        offset = next;
      }
      throw new Error('MangaDex chapter feed exceeded the request limit');
    },
    async getPages({chapterId}) {
      const payload = await json(`/at-home/server/${encodeURIComponent(chapterId)}`,{forcePort443:'true'});
      const base = requireText(payload.baseUrl,'baseUrl'), chapter = requireRecord(payload.chapter,'chapter');
      const hash = requireText(chapter.hash,'chapter.hash'), images = requireArray(chapter.data,'chapter.data');
      if (!images.length) throw Object.assign(new Error('Chapter does not expose internal pages'),{code:'chapter_not_found'});
      return images.map((file,index) => ({index,imageUrl:`${base}/data/${hash}/${requireText(file,'chapter.data[]')}`}));
    },
    async getRecommendations({mangaId,page = 1}) {
      const normalized = Math.max(1,page);
      const ids = await related(mangaId);
      const pageIds = ids.slice((normalized-1)*20,normalized*20), map = await byIds(pageIds);
      return {page:normalized,hasNextPage:normalized*20 < ids.length,items:pageIds.map(id => map.get(id)).filter(Boolean)};
    },
  };
}
