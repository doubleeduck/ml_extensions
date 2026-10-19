import {filter, manga, parseError, record, string} from '../core/data.mjs';
import {finiteNumber, requireArray, requireRecord} from '../core/http.mjs';

const sortOptions = [['POPULARITY','Popularity'],['TRENDING','Trending'],['SCORE','Score'],['FAVOURITES','Favourites'],
  ['START_DATE','Start date'],['UPDATED_AT','Recently updated']];
const formatOptions = [['MANGA','Manga'],['ONE_SHOT','One shot'],['DOUJINSHI','Doujinshi'],['MANHWA','Manhwa'],
  ['MANHUA','Manhua'],['NOVEL','Novel'],['OEL','OEL']];
const statusOptions = [['RELEASING','Releasing'],['FINISHED','Finished'],['HIATUS','Hiatus'],
  ['CANCELLED','Cancelled'],['NOT_YET_RELEASED','Not yet released']];
const countryOptions = [['JP','Japan'],['KR','Korea'],['CN','China'],['TW','Taiwan']];
const fields = `id siteUrl isAdult title {romaji english native} synonyms description(asHtml:false)
  format status averageScore startDate {year} genres coverImage {extraLarge large}`;
const values = input => (Array.isArray(input) ? input : []).map(value => value.trim()).filter(Boolean);
const displayFormat = input => string(input)?.toLowerCase().split('_').map(part => part ? part[0].toUpperCase()+part.slice(1) : '').join(' ') ?? null;
const status = input => ({RELEASING:'ongoing',FINISHED:'completed',HIATUS:'hiatus',CANCELLED:'cancelled',NOT_YET_RELEASED:'not yet released'}[input] ?? string(input));
function numericId(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) {
    throw parseError('AniList manga ID is invalid');
  }
  return Number(value);
}
export function parseManga(input) {
  const item = requireRecord(input,'AniList manga'), titles = record(item.title);
  const title = ['userPreferred','english','romaji','native'].map(key => string(titles[key])).find(Boolean);
  if (item.id == null || !title) return null;
  const secondaryTitle = ['romaji','native','english'].map(key => string(titles[key])).find(value => value && value !== title) ?? null;
  const score = finiteNumber(item.averageScore,null), cover = record(item.coverImage);
  return manga({id:String(item.id),title,secondaryTitle,description:string(item.description),
    coverUrl:string(cover.extraLarge ?? cover.large),status:status(item.status),type:displayFormat(item.format),
    ageRating:item.isAdult === true ? '18+' : null,rating:score == null ? null : score/10,
    releaseYear:record(item.startDate).year == null ? null : String(item.startDate.year),
    tags:requireArray(item.genres ?? [],'AniList genres').map(string).filter(Boolean)});
}
export function browseRequest({page = 1, searchTerm = '', selectedFilters = {}}, fallbackSort) {
  const normalizedSearch = searchTerm.trim(), sort = values(selectedFilters.sort);
  const variables = {page:Math.max(1,page),perPage:24,
    sort:[sort.length ? `${sort[0]}_${sort[1] === 'asc' ? 'ASC' : 'DESC'}` : fallbackSort],isAdult:false};
  const declarations = ['$page:Int!','$perPage:Int!','$sort:[MediaSort!]','$isAdult:Boolean'];
  const parameters = ['type:MANGA','sort:$sort','isAdult:$isAdult'];
  for (const [key,type,parameter,value] of [
    ['search','String','search',normalizedSearch || null],
    ['formatIn','[MediaFormat]','format_in',values(selectedFilters.format)],
    ['statusIn','[MediaStatus]','status_in',values(selectedFilters.status)],
    ['country','CountryCode','countryOfOrigin',values(selectedFilters.country)[0] ?? null],
    ['genreIn','[String]','genre_in',values(selectedFilters.genre)],
  ]) {
    if (value == null || Array.isArray(value) && !value.length) continue;
    declarations.push(`$${key}:${type}`); parameters.push(`${parameter}:$${key}`); variables[key] = value;
  }
  return {query:`query BrowseTitles(${declarations.join(',')}) {Page(page:$page,perPage:$perPage) {media(${parameters.join(',')}) {${fields}}}}`,variables};
}

export default function createAniList(ctx) {
  let genres = null;
  async function graphql(body) {
    const response = await ctx.http.request({method:'POST',url:'https://graphql.anilist.co',responseType:'json',
      headers:{Accept:'application/json','Content-Type':'application/json'},body});
    const envelope = requireRecord(response.body,'AniList response');
    if (envelope.errors != null && requireArray(envelope.errors,'AniList errors').length) {
      throw Object.assign(new Error('AniList request failed'),{code:'invalid_response'});
    }
    return requireRecord(envelope.data,'AniList data');
  }
  async function browse(args, sort) {
    const data = await graphql(browseRequest(args,sort));
    const seen = new Set();
    return requireArray(requireRecord(data.Page,'AniList Page').media,'AniList media').map(parseManga)
      .filter(item => item && !seen.has(item.id) && seen.add(item.id));
  }
  return {
    async getFilters({refresh = false} = {}) {
      if (genres === null || refresh) {
        const data = await graphql({query:'query GenreCollection {GenreCollection}',variables:{}});
        genres = [...new Set(requireArray(data.GenreCollection,'AniList genres').map(string).filter(Boolean))].map(value => [value,value]);
      }
      return [filter('sort','sort','Sort',sortOptions),filter('multiSelect','format','Format',formatOptions),
        filter('multiSelect','status','Status',statusOptions),filter('singleSelect','country','Country',countryOptions),
        filter('multiSelect','genre','Genre',genres)];
    },
    async getPopular({page = 1} = {}) { return browse({page},'POPULARITY_DESC'); },
    async getLatest({page = 1} = {}) { return browse({page},'START_DATE_DESC'); },
    async search(query) { return browse(query,query.searchTerm.trim() ? 'SEARCH_MATCH' : 'POPULARITY_DESC'); },
    async getDetails({mangaId}) {
      const data = await graphql({query:`query TitleDetails($id:Int!) {Media(id:$id,type:MANGA) {${fields}}}`,variables:{id:numericId(mangaId)}});
      const item = parseManga(data.Media);
      if (!item) throw parseError('AniList title is missing');
      return item;
    },
    async getChapters() { return []; },
    async getPages() { throw parseError('AniList titles do not provide chapters for reading'); },
    async getRecommendations({mangaId,page = 1}) {
      const normalized = Math.max(1,page);
      const data = await graphql({query:`query media($id:Int!,$page:Int!,$perPage:Int!) {
        Media(id:$id,type:MANGA) {id recommendations(page:$page,perPage:$perPage,sort:[RATING_DESC,ID]) {
          pageInfo {hasNextPage} nodes {mediaRecommendation {id siteUrl isAdult
            title {userPreferred romaji english native} description(asHtml:false) format status(version:2)
            startDate {year} genres bannerImage coverImage {extraLarge large}}}}}}`,
        variables:{id:numericId(mangaId),page:normalized,perPage:25}});
      const recommendations = requireRecord(requireRecord(data.Media,'AniList media').recommendations,'AniList recommendations');
      const seen = new Set([mangaId]);
      const items = requireArray(recommendations.nodes,'AniList recommendation nodes')
        .map(node => requireRecord(node,'AniList recommendation node').mediaRecommendation)
        .filter(value => value != null).map(parseManga).filter(item => item && !seen.has(item.id) && seen.add(item.id));
      return {items,page:normalized,hasNextPage:requireRecord(recommendations.pageInfo,'AniList page info').hasNextPage === true};
    },
  };
}
