/** Source API v1. Node, sockets, filesystem and browser DOM are not provided. */
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type SourceErrorCode = 'cancelled'|'timeout'|'offline'|'network'|'rate_limited'|'auth_required'|
  'challenge_required'|'not_found'|'title_not_found'|'chapter_not_found'|'chapter_unavailable'|
  'parse_error'|'invalid_response'|'permission_denied'|'unsupported'|'incompatible_api'|
  'resource_limit'|'runtime_crashed'|'auth_session_changed'|'source_unavailable'|'access_denied';
export interface SourceHostError extends Error {
  readonly code:SourceErrorCode;
  readonly phase:string;
  readonly httpStatus?:number;
  readonly retryAfterSeconds?:number;
  readonly access?:ChapterAccessDto;
  /** Bounded response from this source's own allowed endpoint, for access DTOs. */
  readonly body?:Json;
}
export interface MangaDto {
  id:string; title:string; coverUrl:string|null; description:string|null;
  secondaryTitle:string|null; author:string|null; artist:string|null;
  status:string|null; type:string|null; ageRating:string|null; rating:number|null;
  releaseYear:string|null; pageCount:number|null; languageFlagUrl:string|null; tags:string[];
}
export interface ChapterAccessDto {
  type:'available'|'temporarilyUnavailable'|'paid'; availableAt:string|null;
  priceLabel:string|null; message:string|null;
}
export interface ChapterDto {
  id:string; title:string; number:number; uploadedAt:string|null; access:ChapterAccessDto;
}
export interface PageDto { index:number; imageUrl:string; }
export interface FilterOptionDto {value:string; label:string; caption:string|null;}
export interface FilterDto {
  key:string; label:string; caption:string|null;
  kind:'toggle'|'text'|'singleSelect'|'multiSelect'|'triStateMultiSelect'|'sort';
  options:FilterOptionDto[]; defaultValues:string[];
}
export interface SourceQueryDto {searchTerm:string; page:number; selectedFilters:Record<string,string[]>;}
export interface RecommendationPageDto {items:MangaDto[];page:number;hasNextPage:boolean;}
export interface SourceV1 {
  /** Required at runtime when the corresponding manifest capability is set. */
  getFilters?(args:{refresh?:boolean}):Promise<FilterDto[]>;
  getPopular?(args:{page?:number}):Promise<MangaDto[]>;
  getLatest?(args:{page?:number}):Promise<MangaDto[]>;
  search?(query:SourceQueryDto):Promise<MangaDto[]>;
  getDetails(args:{mangaId:string}):Promise<MangaDto>;
  getChapters(args:{mangaId:string}):Promise<ChapterDto[]>;
  getPages(args:{mangaId:string;chapterId:string}):Promise<PageDto[]>;
  getRecommendations?(args:{mangaId:string;page?:number}):Promise<RecommendationPageDto>;
}
export interface HttpRequestDto {
  /** Only small parser inputs. 'bytes' returns a numeric byte array (max 1 MiB);
   * text/JSON responses are bounded to 4 MiB before IPC. Reader images use the
   * native media path, not large byte arrays through JavaScript. */
  method:'GET'|'POST'|'HEAD'; url:string; responseType:'text'|'json'|'bytes';
  headers?:Record<string,string>; body?:Json; authRevision?:number; timeoutMs?:number;
  userAgentProfile?:'app'|'browser'|'reader'|'mobileSafari';
}
export interface HttpResponseDto {status:number;url:string;headers:Readonly<Record<string,string>>;body:Json;}
export interface HtmlProjectionDto {
  baseUrl?:string; selector?:string; fields?:Record<string,HtmlProjectionDto>;
  all?:boolean;required?:boolean;text?:boolean;attr?:string;html?:boolean;outerHtml?:boolean;
  absoluteUrl?:boolean;textEquals?:string;ascend?:number;nextSibling?:boolean;
  /** Text-only projection: remove matching descendants from a private clone. */
  exclude?:string;
  /** Text-only projection: false preserves internal whitespace (default true). */
  normalizeWhitespace?:boolean;
  /** Restrict selector matches to immediate children of the current root. */
  directChildren?:boolean;
  /** Output the selected element's lower-case tag name instead of its text. */
  tagName?:boolean;
  /** Boolean output: any of 1..8 literal substrings occurs in node text, case insensitive; <=256 characters per term. */
  containsText?:string[];
}
export interface SourceAuthSessionV1 {
  readonly authorized:boolean; readonly revision:number; readonly origin:string;
  readonly headers:Readonly<Record<string,string>>;
  readonly cookieHeader?:string;readonly accessToken?:string;readonly csrfToken?:string;
}
export interface SourceContextV1 {
  readonly sourceId:string; readonly baseUrl:string; readonly parameters:Readonly<Record<string,string>>;
  readonly http:{request(input:HttpRequestDto):Promise<HttpResponseDto>};
  readonly html:{extract(body:string,projection:HtmlProjectionDto):Promise<Json>};
  readonly settings:{get(key:string):Promise<Json>;set(key:string,value:Json):Promise<void>};
  readonly auth:{status():Promise<{authorized:boolean;revision:number}>;getSession(input:{url:string}):Promise<SourceAuthSessionV1>};
  readonly log:{info(event:string,fields?:Record<string,string|number|boolean>):void};
}
export type CreateSource = (context:SourceContextV1) => SourceV1;
