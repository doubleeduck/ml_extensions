/** Signed, declarative registrations. IDs are the existing persistent app IDs. */
const browse = ['browse','latest','search','filters'];
const origin = host => `https://${host}`;
function source(id,name,host,module,extra = {}) {
  const base = origin(host), {origins = [],images = [],auth = null,recommendations = false,custom = false,refresh = false,
    template = '/{id}',encoding = 'pathSegment',idPart,capabilities = browse,parameters = {},settings,metadataOnly = false,bindings = {},nsfw = false,media = {},network = {}} = extra;
  return {id,name,language:id.split('.')[0],baseUrl:base,engine:extra.engine ?? 'Handwritten JS',status:'experimental',isNsfw:nsfw,
    supportsCustomBaseUrl:custom,supportsFilterRefresh:refresh,capabilities:[...capabilities,...(recommendations ? ['recommendations'] : []),...(auth ? ['account'] : [])],
    features:{webLinks:true,auth:auth != null,authCompletion:auth?.completionUrl != null,recommendations},
    web:{mangaUrlTemplate:template,idEncoding:encoding,...(idPart ? {idPart} : {})},parameters,
    filterBindings:bindings,metadataOnly,...(settings ? {settings} : {}),...(auth ? {auth} : {}),
    network:{origins:[base,...origins].filter((value,index,all) => all.indexOf(value) === index),imageOrigins:[base,...images].filter((value,index,all) => all.indexOf(value) === index),
      authOrigins:auth?.cookieOrigins ?? [base],allowSubdomains:true,methods:['GET','POST','HEAD'],maxConcurrentRequests:2,...network},
    media:{userAgentProfile:'browser',refererOrigin:base,sendOrigin:false,...media},
    // Build-only dispatcher mapping; not a source-manifest property.
    _module:module};
}
const cookieAuth = (host,login = '/login/') => ({profileId:'host.cookie.v1',loginUrl:new URL(login,origin(host)).href,
  cookieOrigins:[origin(host)],sessionExport:{headers:['Cookie'],values:[]}});
const libApis = ['api.cdnlibs.org','api2.mangalib.me','hapi.hentaicdn.org','api.imglib.info'].map(origin);
// Cookie Domain roots are explicit grants, not shared cookie jars. Every
// instance still receives only the browser/HTTP session belonging to its ID.
const libCookieRoots = ['cdnlibs.org','mangalib.me','hentaicdn.org','imglib.info'].map(origin);
const libImages = ['mixlib.me','imglib.info','mangalib.me','hentaicdn.org','cdnlib.org','cdnlibs.org','mangalib.org','mangalib.net'].map(origin);
const libgroup = (id,name,host,siteId,nsfw = false) => source(id,name,host,'engines/libgroup.mjs',{engine:'LibGroup JS',nsfw,refresh:true,recommendations:true,
  parameters:{siteId:String(siteId)},settings:{version:1,profileId:'host.libgroup.v1'},origins:libApis,images:libImages,
  auth:{...cookieAuth(host,'/ru'),profileId:'host.libgroup.v1',cookieOrigins:[...new Set([origin(host),...libApis,...libCookieRoots])],sessionExport:{headers:['Cookie','Authorization','X-XSRF-TOKEN'],values:['accessToken','csrfToken']}},
  template:'/ru/manga/{id}',bindings:{author:'authors',artist:'artists',tags:'tags'},media:{sendOrigin:true}});
const groupleCookieRoots = {'a.zazaza.me':'zazaza.me','2.mintmanga.one':'mintmanga.one','1.seimanga.me':'seimanga.me','1.selfmanga.live':'selfmanga.live','20.allhen.online':'allhen.online'};
const grouple = (id,name,host,nsfw = false) => source(id,name,host,'engines/grouple.mjs',{engine:'GroupLe JS',nsfw,custom:true,refresh:true,recommendations:true,
  template:'/{id}',encoding:'path',settings:{version:1,profileId:'host.grouple.v1'},
  auth:{...cookieAuth(host),profileId:'host.grouple.v1',loginUrl:'https://3.grouple.co/internal/auth/login',cookieOrigins:[origin(host),...(groupleCookieRoots[host] ? [origin(groupleCookieRoots[host])] : []),'https://3.grouple.co','https://grouple.co'],completionUrl:origin(host),successUrl:'https://3.grouple.co/',sessionExport:{headers:['Cookie'],values:[]}},
  origins:['https://3.grouple.co'],images:['https://one-way.work','https://manga1.ru','https://manga2.ru','https://manga3.ru','https://mangap.ru','https://mangapoisk.org','https://readmanga.io',...(id === 'ru.allhentai' ? ['https://aaa200.one'] : [])],media:{sendOrigin:true}});
const imhentai = language => source(`${language}.imhentai`,'IMHentai','imhentai.xxx','sources/imhentai.mjs',{nsfw:true,custom:true,recommendations:true,auth:cookieAuth('imhentai.xxx'),
  template:'/gallery/{id}/',images:['https://imhentai.xxx','https://imhentai.me','https://imhentai.com'],bindings:{author:'groups',artist:'artists',tags:'tags'}});
const senkuro = (adult = false) => {
  const host = adult ? 'senkognito.com' : 'senkuro.me', api = adult ? 'api.senkognito.com' : 'api.senkuro.me';
  return source(adult ? 'ru.senkognito' : 'ru.senkuro',adult ? 'Senkognito' : 'Senkuro',host,'engines/senkuro.mjs',{engine:'Senkuro GraphQL JS',nsfw:adult,refresh:true,recommendations:true,
    capabilities:['browse','search','filters'],origins:[origin(api)],images:['https://senkuro.me','https://senkuro.com','https://senkognito.com','https://senkuro.net'],
    auth:{...cookieAuth(host,'/'),profileId:'host.senkuro.v1',cookieOrigins:[origin(host),origin(api)],sessionExport:{headers:['Cookie','Authorization'],values:['accessToken']}},
    template:'/manga/{id}',idPart:{separator:',,',index:1}});
};
const metadata = (id,name,host,module,extra = {}) => source(id,name,host,module,{...extra,metadataOnly:true,recommendations:true,auth:cookieAuth(host,extra.login ?? '/login'),template:extra.template ?? '/manga/{id}'});
export const registrations = [
  source('ru.inkstory','InkStory','inkstory.net','sources/inkstory.mjs',{engine:'InkStory API/HTML JS',custom:true,refresh:true,recommendations:true,
    template:'/{id}',encoding:'path',origins:['https://api.inuko.me'],images:['https://inuko.me','https://inkstory.net'],bindings:{tags:'genre'},media:{codecProfile:'inkstory.xor.v1'}}),
  ...['ru','en'].map(language => source(`${language}.mangadex`,'MangaDex','mangadex.org','engines/mangadex.mjs',{engine:'MangaDex API JS',parameters:{translatedLanguage:language},origins:['https://api.mangadex.org'],images:['https://uploads.mangadex.org','https://mangadex.network'],template:'/title/{id}',bindings:{tags:'tags'}})),
  libgroup('ru.mangalib','MangaLib','mangalib.me',1),libgroup('ru.hentailib','HentaiLib','hentailib.me',4,true),libgroup('ru.yaoilib','YaoiLib','v2.shlib.life',2,true),
  grouple('ru.readmanga','ReadManga','a.zazaza.me'),grouple('ru.mintmanga','MintManga','2.mintmanga.one',true),grouple('ru.seimanga','SeiManga','1.seimanga.me'),
  grouple('ru.selfmanga','SelfManga','1.selfmanga.live'),grouple('ru.usagi','Usagi','a.zazaza.me'),grouple('ru.rumix','RuMIX','rumix.me'),grouple('ru.allhentai','AllHentai','20.allhen.online',true),
  senkuro(),senkuro(true),...['all','en','ru'].map(imhentai),
  source('all.pururin','Pururin','pururin.me','sources/pururin.mjs',{nsfw:true,template:'/{id}',encoding:'path',images:['https://pururin.me'],bindings:{author:'circles',artist:'artists',tags:'tags'}}),
  source('en.mangafox','MangaFox','fanfox.net','sources/mangafox.mjs',{origins:['https://m.fanfox.net'],images:['https://fanfox.net','https://mangafox.me','https://mangafox.la','https://mfcdn.net'],template:'/manga/{id}/',bindings:{author:'author',artist:'artist',tags:'genres'},
    media:{refererOrigin:'https://m.fanfox.net',userAgentProfile:'mobileSafari'},network:{cookieDefaults:[{origin:'https://fanfox.net',name:'isAdult',value:'1'},{origin:'https://m.fanfox.net',name:'isAdult',value:'1'},{origin:'https://m.fanfox.net',name:'readway',value:'2'}]}}),
  source('en.mangakakalot','Mangakakalot','www.mangakakalot.gg','sources/mangakakalot.mjs',{engine:'MangaBox HTML/API JS',origins:['https://mangakakalot.gg','https://www.mangakakalove.com','https://mangakakalove.com'],images:['https://2xstorage.com','https://mangakakalot.gg','https://mangakakalove.com','https://manganelo.com','https://manganato.com'],template:'/manga/{id}',
    // Explicit parent Domain grants for this source's own anti-bot cookies;
    // no account/raw session export and no shared browser jar.
    network:{authOrigins:['https://www.mangakakalot.gg','https://mangakakalot.gg','https://www.mangakakalove.com','https://mangakakalove.com']}}),
  source('en.weebcentral','Weeb Central','weebcentral.com','sources/weebcentral.mjs',{recommendations:true,images:['https://planeptune.us','https://weebcentral.com','https://compsci88.com'],template:'/series/{id}',bindings:{author:'author',artist:'author',tags:'tag'}}),
  source('ru.hchan','H-chan','x2.h-chan.me','engines/chan.mjs',{nsfw:true,custom:true,recommendations:true,capabilities:['latest','search','filters'],template:'/{id}',encoding:'path',images:['https://h-chan.me'],bindings:{tags:'tags'}}),
  source('ru.mangachan','MangaChan','im.manga-chan.me','engines/chan.mjs',{recommendations:true,template:'/{id}',encoding:'path',images:['https://manga-chan.me'],bindings:{tags:'genres'}}),
  source('ru.mangashi','MangaShi','manga-shi.org','sources/mangashi.mjs',{refresh:true,recommendations:true,auth:cookieAuth('manga-shi.org'),template:'/{id}',encoding:'path',images:['https://manga-shi.org'],bindings:{tags:'tags'}}),
  source('ru.desu','Desu','desu.uno','sources/desu.mjs',{custom:true,refresh:true,recommendations:true,template:'/{id}',encoding:'path',images:['https://desu.uno','https://desu.me'],bindings:{tags:'genres'}}),
  metadata('ru.shikimori','Shikimori','shikimori.io','sources/shikimori.mjs',{template:'/mangas/{id}',login:'/users/sign_in',images:['https://shikimori.io','https://shikimori.one']}),
  metadata('en.anilist','AniList','anilist.co','sources/anilist.mjs',{origins:['https://graphql.anilist.co'],images:['https://anilist.co'],login:'/login'}),
  metadata('en.myanimelist','MyAnimeList','myanimelist.net','sources/myanimelist.mjs',{origins:['https://api.myanimelist.net'],images:['https://myanimelist.net'],login:'/login.php',network:{authOrigins:['https://myanimelist.net','https://api.myanimelist.net']}}),
];
export function sourceDefinitions() { return registrations.map(({_module,...definition}) => definition); }
export function manifestDefinition({version,publisherKeyId}) {
  return {schemaVersion:1,extensionId:'official.mangalaunch.sources',name:'MangaLaunch Official Sources',version,publisherKeyId,
    sourceApiVersion:1,minAppVersion:'1.0.0',minRuntimeAbi:1,entrypoint:'src/index.mjs',license:'LicenseRef-Proprietary',permissions:['http','html','sourceSettings','sourceSession'],sources:sourceDefinitions(),files:{}};
}
