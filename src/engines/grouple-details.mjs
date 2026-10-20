import {manga,normalizeText,parseError,record,string} from '../core/data.mjs';
import {requireArray,requireRecord} from '../core/http.mjs';
const text = selector => ({selector,text:true});
const texts = selector => ({selector,all:true,text:true,normalizeWhitespace:false});
export const detailsProjection = {fields:{legacy:{selector:'.expandable',fields:{category:text('span.elem_category'),age:text('.elem_limitation .element-link'),
  tags:texts('a[href*="/list/genre/"], a[href*="/list/tag/"], a[href*="/list/tags/"]'),alt:text('.another-names'),
  image:{selector:'img',fields:{full:{attr:'data-full'},original:{attr:'data-original'},src:{attr:'src'}}},
  author:text('span.elem_author, span.elem_screenwriter'),artist:text('span.elem_illustrator'),badges:texts('span.badge'),single:{selector:'b',all:true,containsText:['сингл']}}},
  directNames:texts('h1.names > span.name'),name:text('.names > .name'),english:text('h1.names .eng-name, h1.names .eng_name'),
  legacyAlt:{fields:Object.fromEntries(['.eng-name','.eng_name','.original-name','.names .eng-name','.names .eng_name','.all-names-popover .name'].map((selector,index) => [`a${index}`,texts(selector)]))},
  legacySummary:text('#tab-description .manga-description'),modernTitle:text('.cr-hero-names__main'),metaTitle:{selector:'meta[itemprop=name]',attr:'content'},
  modernRows:{selector:'.cr-hero .cr-info-details > *, .cr-info-details__item',all:true,fields:{label:text('.cr-info-details-item__title, .cr-info-details__title'),value:text('.cr-info-details-item__status, .cr-info-details__content')}},
  people:{selector:'.cr-main-person-item',all:true,fields:{role:text('.cr-main-person-item__role'),name:text('.cr-main-person-item__name a, .cr-main-person-item__name')}},
  category:text('.cr-hero-short-details a[href*="/list/category/"]'),age:text('.cr-hero-short-details a[href*="/list/limitation/"]'),tags:texts('.cr-tags .cr-tags__item'),
  modernAlt:{fields:Object.fromEntries(['.cr-hero-names__alt span:not(.cr-hero-names__alt-separator)','.eng-name','.eng_name'].map((selector,index) => [`a${index}`,texts(selector)]))},
  modalAlt:texts('#alt-names-dialog .modal-body .py-1'),modernSummary:text('.cr-description__content'),image:{selector:'.cr-hero-poster__img',fields:{src:{attr:'src'},lazy:{attr:'data-src'},original:{attr:'data-original'}}},
  background:{selector:'.cr-hero-overlay__bg',attr:'data-bg'},creation:{selector:'.creation-element-tags__content a.creation-element-tags__item',all:true,fields:{text:{text:true},spans:texts('span:not(.text-secondary)')}},
  chapters:{selector:'div.chapters',fields:{present:{text:true}}},prohibited:{selector:'body',containsText:['запрещен','запрещён']},copyright:{selector:'body',containsText:['копирайт']}}};
const splitTitles = value => String(value ?? '').split(/[/;\n]+/gu).map(normalizeText).filter(Boolean);
const dedupe = values => { const seen = new Set(); return values.filter(value => { const key = value.trim().toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; }); };
const alternativeTitles = input => dedupe(Object.values(requireRecord(input,'GroupLe alternative titles')).flatMap(values => requireArray(values,'GroupLe titles').flatMap(splitTitles)));
const ageLabel = value => ({'NC-17':'18+','R18+':'18+',R:'16+',G:'16+',PG:'16+','PG-13':'12+'}[normalizeText(value)] ?? normalizeText(value));
const latin = value => /[A-Za-z]/u.test(value) && !/[\u0400-\u04ff]/u.test(value);
const cyrillic = value => /[\u0400-\u04ff]/u.test(value) && !/[A-Za-z]/u.test(value);
function preferred(values,title,language) {
  const candidates = values.map(value => value.trim()).filter(value => value && value !== title);
  return candidates.find(value => language === 'eng' ? latin(value) : language === 'rus' && cyrillic(value)) ?? candidates[0] ?? null;
}
function titles(title,alternative,language) {
  let main = language === 'eng' && alternative && alternative !== title ? alternative : title;
  let secondary = [title,alternative].find(value => value && value !== main) ?? null;
  const matches = language === 'eng' ? latin : language === 'rus' ? cyrillic : () => true;
  if (secondary && !matches(main) && matches(secondary)) [main,secondary] = [secondary,main];
  return {title:main,secondaryTitle:secondary};
}
const description = (names,summary) => [names?.trim() ? `Alternative names:\n${names.trim()}` : null,string(summary)].filter(Boolean).join('\n\n') || null;
function status(release,translation,legacy = false) {
  const value = release.toLowerCase();
  if (/продолж|начат/u.test(value)) return 'ongoing';
  if (value.includes('заверш')) return (legacy ? /переведен|переведён/u.test(translation) : translation.includes('заверш')) ? 'completed' : 'finished';
  return /приост|заморож/u.test(value) ? 'hiatus' : null;
}
export function parseDetails(input,id,base,settings = {}) {
  const data = requireRecord(input,'GroupLe details'), legacy = data.legacy == null ? null : requireRecord(data.legacy,'GroupLe legacy details');
  const language = settings.titleLanguage ?? 'eng', creation = requireArray(data.creation,'GroupLe creation tags').map(row => {
    const parts = requireArray(row.spans,'GroupLe tag spans').map(normalizeText).filter(Boolean);
    return (parts.length ? parts.join(' ') : normalizeText(row.text)).replace(/^#\s*/u,'').trim();
  }).filter(Boolean);
  if (legacy) {
    const names = requireArray(data.directNames,'GroupLe primary names').map(normalizeText).filter(Boolean), title = names.at(-1) ?? normalizeText(data.name);
    if (!title) throw parseError('GroupLe legacy title is missing.');
    const english = normalizeText(data.english), other = normalizeText(legacy.alt), alternatives = [english,...alternativeTitles(data.legacyAlt),...splitTitles(other)];
    const alternative = language === 'eng' && english && english !== title ? english : preferred(alternatives,title,language);
    const category = normalizeText(legacy.category), age = ageLabel(legacy.age), image = record(legacy.image), badges = requireArray(legacy.badges,'GroupLe status badges').map(normalizeText).join(' ').toLowerCase();
    const restricted = data.prohibited === true && data.copyright === true && data.chapters == null;
    const raw = image.full ?? image.original ?? image.src;
    return manga({id,...titles(title,alternative,language),coverUrl:string(raw) ? new URL(raw,base).href : null,description:description(other,normalizeText(data.legacySummary)),
      author:string(normalizeText(legacy.author)),artist:string(normalizeText(legacy.artist)),type:string(category),
      status:restricted ? 'licensed' : Array.isArray(legacy.single) && legacy.single.some(value => value === true) ? 'completed' : status(badges,badges,true),
      tags:dedupe([category,age,...requireArray(legacy.tags,'GroupLe tags').map(normalizeText),...creation])});
  }
  const title = normalizeText(data.modernTitle ?? data.metaTitle); if (!title) throw parseError('GroupLe modern title is missing.');
  const info = {};
  for (const row of requireArray(data.modernRows,'GroupLe metadata')) {
    const key = normalizeText(row.label).toLowerCase(), value = normalizeText(row.value); if (key && value && !Object.hasOwn(info,key)) info[key] = value;
  }
  const people = requireArray(data.people,'GroupLe people'), authors = [], artists = [];
  for (const person of people) { const role = normalizeText(person.role).toLowerCase(), name = normalizeText(person.name); if (!name) continue;
    if (/автор|сценар/u.test(role)) authors.push(name); if (/худож|иллюст/u.test(role)) artists.push(name); }
  const alternatives = [...alternativeTitles(data.modernAlt),...requireArray(data.modalAlt,'GroupLe modal titles').map(normalizeText).filter(Boolean)];
  const category = normalizeText(data.category), age = ageLabel(data.age), image = record(data.image), raw = image.src ?? image.lazy ?? image.original ?? data.background;
  return manga({id,...titles(title,preferred(alternatives,title,language),language),coverUrl:string(raw) ? new URL(raw,base).href : null,
    description:description(alternatives.join(' / '),normalizeText(data.modernSummary)),author:[...new Set(authors)].join(', ') || null,artist:[...new Set(artists)].join(', ') || null,
    status:status(Object.entries(info).find(([key]) => key.includes('выпуск'))?.[1] ?? '',(Object.entries(info).find(([key]) => key.includes('перевод'))?.[1] ?? '').toLowerCase()),
    type:string(category),tags:dedupe([category,age,...requireArray(data.tags,'GroupLe modern tags').map(normalizeText),...creation])});
}
