import {chapter,filter,isoDate,manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord,urlWithQuery} from '../core/http.mjs';

const base = 'https://weebcentral.com';
const tags = ['Action','Adult','Adventure','Comedy','Doujinshi','Drama','Ecchi','Fantasy','Gender Bender','Harem','Hentai',
  'Historical','Horror','Isekai','Josei','Lolicon','Martial Arts','Mature','Mecha','Mystery','Psychological','Romance',
  'School Life','Sci-fi','Seinen','Shotacon','Shoujo','Shoujo Ai','Shounen','Shounen Ai','Slice of Life','Smut','Sports',
  'Supernatural','Tragedy','Yaoi','Yuri','Other'];
const optionLabel = value => ({'Gender Bender':'Gender bender','Martial Arts':'Martial arts','School Life':'School life',
  'Shoujo Ai':'Shoujo ai','Shounen Ai':'Shounen ai','Slice of Life':'Slice of life'}[value] ?? value);
const booleanOptions = [['Any','Any'],['True','Yes'],['False','No']];
export function buildFilters() {
  return [filter('sort','sort','Sort',[['Best Match','Best match'],['Alphabet','Alphabet'],['Popularity','Popularity'],['Subscribers','Subscribers'],['Recently Added','Recently added'],['Latest Updates','Latest updates']]),
    filter('singleSelect','official','Official translation',[['Any','Any'],['True','Official only'],['False','Fan translations']]),
    filter('singleSelect','anime','Anime adaptation',booleanOptions),filter('singleSelect','adult','Adult content',booleanOptions),
    {...filter('text','author','Author'),caption:'Author or artist name'},
    filter('multiSelect','status','Series status',['Ongoing','Complete','Hiatus','Canceled'].map(value => [value,value])),
    filter('multiSelect','type','Series type',['Manga','Manhwa','Manhua','OEL'].map(value => [value,value])),
    {...filter('triStateMultiSelect','tag','Tags',tags.map(value => [value,optionLabel(value)])),caption:'Tap a tag again to switch between include and exclude.'}];
}
export function searchUrl({page = 1,searchTerm = '',selectedFilters = {}} = {},defaultSort = 'Best Match') {
  const sort = selectedFilters.sort ?? [];
  const query = {text:searchTerm.replace(/[!#:(),-]/gu,' ').replace(/\s+/gu,' ').trim(),sort:string(sort[0]) ?? defaultSort,
    order:sort.length < 2 || sort[1] !== 'asc' ? 'Descending' : 'Ascending',official:selectedFilters.official?.[0] ?? 'Any',
    anime:selectedFilters.anime?.[0] ?? 'Any',adult:selectedFilters.adult?.[0] ?? 'Any',limit:'32',offset:String((Math.max(1,page)-1)*32),display_mode:'Full Display'};
  for (const [key,param] of [['status','included_status'],['type','included_type'],['author','author']]) {
    const values = (selectedFilters[key] ?? []).map(value => value.trim()).filter(Boolean); if (values.length) query[param] = values;
  }
  for (const [prefix,param] of [['include:','included_tag'],['exclude:','excluded_tag']]) {
    const values = (selectedFilters.tag ?? []).filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length).trim()).filter(Boolean);
    if (values.length) query[param] = values;
  }
  return urlWithQuery('/search/data',base,query);
}
function idFrom(input,prefix) {
  const value = string(input); if (!value) return null;
  let path; try { path = new URL(value,base).pathname; } catch { return null; }
  const match = path.match(new RegExp(`^/${prefix}/([^/?#]+)`,'u'));
  return match?.[1] ?? (!value.includes('/') ? value : null);
}
export const seriesId = input => idFrom(input,'series') ?? (string(input)?.split('/')[0] || null);
export const chapterId = input => idFrom(input,'chapters');
const normalizeLabel = value => normalizeText(value).toLowerCase().replaceAll(':','');
const uniqueText = values => [...new Set(requireArray(values,'Weeb Central values').map(normalizeText).filter(Boolean))];
const imageFields = {source:{selector:'picture source[srcset]',attr:'srcset'},
  image:{selector:'img[src], img[data-src]',fields:{src:{attr:'src'},lazy:{attr:'data-src'}}}};
const rows = {selector:'li, div, p, dt, dd',all:true,fields:{labels:{selector:'strong, b, dt, .label',all:true,text:true},
  text:{text:true},links:{selector:'a',all:true,text:true},items:{selector:'li',all:true,text:true}}};
function labeledRow(input,candidates) {
  for (const value of requireArray(input,'Weeb Central metadata rows')) {
    const row = requireRecord(value,'Weeb Central metadata row'), labels = requireArray(row.labels,'Weeb Central metadata labels');
    if (labels.length !== 1) continue; // Never select a wrapper containing all metadata labels.
    const name = normalizeLabel(labels[0]);
    if (candidates.some(candidate => normalizeLabel(candidate) === name || normalizeLabel(candidate).replaceAll('(s)','') === name.replaceAll('(s)',''))) return row;
  }
  return null;
}
function values(input,candidates) {
  const row = labeledRow(input,candidates); if (!row) return [];
  const links = uniqueText(row.links); if (links.length) return links;
  const text = normalizeText(row.text).replace(normalizeText(row.labels[0]),'').trim();
  return text ? [text] : [];
}
const text = (input,candidates) => values(input,candidates).join(', ') || null;
const list = (input,candidates) => { const row = labeledRow(input,candidates); return row ? uniqueText(row.items) : []; };
const status = value => { const text = normalizeText(value).toLowerCase(); return text.includes('ongoing') ? 'ongoing' : text.includes('complete') ? 'completed' : text.includes('hiatus') ? 'hiatus' : text.includes('cancel') ? 'cancelled' : null; };
function imageUrl(input) {
  const item = requireRecord(input,'Weeb Central image fields'), source = typeof item.source === 'string' ? item.source.split(',')[0].split(' ')[0].trim() : '';
  if (source) return new URL(source.replace('/cover/small/','/cover/normal/'),base).href;
  const raw = string(record(item.image).src ?? record(item.image).lazy); return raw ? new URL(raw,base).href : null;
}
const tileFields = {main:{selector:'a.line-clamp-1[href*="/series/"]',fields:{href:{attr:'href'},text:{text:true}}},
  fallback:{selector:'a[href*="/series/"]',fields:{href:{attr:'href'},text:{text:true}}},truncate:{selector:'div.truncate',text:true},
  tags:{selector:'a[href*="included_tag="]',all:true,text:true},rows,...imageFields};
export const catalogProjection = {selector:'article.bg-base-300.flex.gap-4.p-4',all:true,fields:tileFields};
export function parseManga(input) {
  const row = requireRecord(input,'Weeb Central catalog card'), link = requireRecord(row.main ?? row.fallback,'Weeb Central title link');
  const id = seriesId(link.href), title = string(normalizeText(link.text)) ?? string(normalizeText(row.truncate));
  if (!id || !title) return null;
  const tags = uniqueText(row.tags);
  return manga({id,title,coverUrl:imageUrl(row),status:status(text(row.rows,['status'])),type:text(row.rows,['type']),
    ageRating:tags.some(tag => tag.toLowerCase() === 'adult') ? '18+' : null,tags});
}
export function parseCatalog(input,excludeId = null) {
  const result = [], seen = new Set();
  for (const row of requireArray(input,'Weeb Central catalog')) {
    // Empty/ad tiles are not manga, as in the legacy parser.
    if (!record(row).main && !record(row).fallback) continue;
    const item = parseManga(row); if (!item || item.id === excludeId || seen.has(item.id)) continue;
    seen.add(item.id); result.push(item);
  }
  return result;
}
export const detailsProjection = {fields:{sections:{selector:'section[x-data] > section',all:true,fields:{heading:{selector:'h1',text:true},rows,...imageFields}},
  heading:{selector:'h1',text:true},...imageFields}};
export function parseDetails(input,id,realUrl) {
  const data = requireRecord(input,'Weeb Central details'), sections = requireArray(data.sections,'Weeb Central detail sections');
  const info = record(sections[0]), details = record(sections[1]);
  const title = string(normalizeText(details.heading)) ?? string(normalizeText(data.heading));
  if (!title) throw parseError('Weeb Central title is missing.');
  const infoRows = info.rows ?? [], detailRows = details.rows ?? [];
  const authors = values(infoRows,['author(s)','author','artist(s)','artist']), names = list(detailRows,['associated name(s)']);
  const related = list(detailRows,['related series(s)']);
  const description = [text(detailRows,['description']),names.length ? `Associated Name(s):\n${names.map(name => `- ${name}`).join('\n')}` : null,
    related.length ? `Related Series(s):\n${related.map(name => `- ${name}`).join('\n')}` : null].filter(value => value?.trim()).join('\n\n') || null;
  const adult = values(infoRows,['adult content'])[0]?.toLowerCase();
  return manga({id:seriesId(realUrl) ?? id,title,coverUrl:sections[0] ? imageUrl(info) ?? imageUrl(data) : imageUrl(data),description,
    secondaryTitle:names.join(', ') || null,author:authors.join(', ') || null,artist:authors.join(', ') || null,
    tags:values(infoRows,['tag(s)','tags','genre(s)','genres']),type:values(infoRows,['type'])[0] ?? null,
    status:status(values(infoRows,['status'])[0]),releaseYear:values(infoRows,['released'])[0] ?? null,ageRating:['yes','true'].includes(adult) ? '18+' : null});
}
export const chaptersProjection = {selector:'div[x-data] > a[href*="/chapters/"]',all:true,fields:{href:{attr:'href'},
  title:{selector:'span.flex > span',text:true},text:{text:true},date:{selector:'time[datetime]',attr:'datetime'}}};
export function parseChapters(input) {
  const result = [];
  for (const value of requireArray(input,'Weeb Central chapters')) {
    const row = requireRecord(value,'Weeb Central chapter'), id = chapterId(row.href);
    const title = string(normalizeText(row.title)) ?? string(normalizeText(row.text));
    if (!id || !title) continue;
    const number = Number(title.match(/(?:chapter|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/iu)?.[1] ?? title.match(/(\d+(?:\.\d+)?)/u)?.[1] ?? 0);
    result.push(chapter({id:`/chapters/${id}`,title,number,uploadedAt:isoDate(row.date)}));
  }
  return result;
}
export const recommendationsProjection = {selector:'section',all:true,fields:{heading:{selector:'h2',text:true},items:{selector:'li',all:true,fields:tileFields}}};
export default function createWeebCentral(ctx) {
  const titleUrl = id => new URL(`/series/${id}`,base).href;
  async function html(url,projection) {
    const response = await ctx.http.request({method:'GET',url,responseType:'text',userAgentProfile:'browser',headers:{
      Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9',Origin:base,Referer:`${base}/`}});
    if (typeof response.body !== 'string' || !response.body.trim()) throw Object.assign(Error('Weeb Central returned an empty page.'),{code:'invalid_response',phase:'http'});
    return {url:response.url ?? url,data:await ctx.html.extract(response.body,{...projection,baseUrl:response.url ?? url})};
  }
  return {
    async getFilters() { return buildFilters(); },
    async getPopular({page = 1} = {}) { return parseCatalog((await html(searchUrl({page},'Popularity'),catalogProjection)).data); },
    async getLatest({page = 1} = {}) { return parseCatalog((await html(searchUrl({page},'Latest Updates'),catalogProjection)).data); },
    async search(query) {
      if (query.searchTerm?.trim().toLowerCase().startsWith('id:')) {
        const id = seriesId(query.searchTerm.trim().slice(3)); return id ? [await this.getDetails({mangaId:id})] : [];
      }
      return parseCatalog((await html(searchUrl(query),catalogProjection)).data);
    },
    async getDetails({mangaId:id}) { const page = await html(titleUrl(id),detailsProjection); return parseDetails(page.data,id,page.url); },
    async getChapters({mangaId:id}) { return parseChapters((await html(`${titleUrl(id)}/full-chapter-list`,chaptersProjection)).data); },
    async getPages({chapterId:id}) {
      const normalized = chapterId(id); if (!normalized) throw parseError('Weeb Central chapter id is missing.');
      const {data} = await html(`${base}/chapters/${normalized}/images?is_prev=False&reading_style=long_strip`,{selector:'section[x-data*=scroll] img, section[x-data~=scroll] img',all:true,attr:'src'});
      const images = requireArray(data,'Weeb Central pages').map(string).filter(Boolean).map(value => new URL(value,base).href);
      if (!images.length) throw parseError('Weeb Central pages were not found.');
      return images.map((imageUrl,index) => ({index,imageUrl}));
    },
    async getRecommendations({mangaId:id,page = 1}) {
      const normalized = Math.max(1,page); if (normalized > 1) return {items:[],page:normalized,hasNextPage:false};
      const {data} = await html(titleUrl(id),recommendationsProjection);
      const section = requireArray(data,'Weeb Central recommendations').find(value => normalizeText(record(value).heading).toLowerCase() === 'recommendations');
      return {items:section ? parseCatalog(section.items,id) : [],page:normalized,hasNextPage:false};
    },
  };
}
