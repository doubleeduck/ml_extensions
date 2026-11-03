import {parseError,string} from '../core/data.mjs';
import {requireArray,requireRecord} from '../core/http.mjs';

export function normalizeImageUrl(value) {
  const url=new URL(value);
  if(url.hostname!=='static.inuko.me')return value;
  const segments=url.pathname.split('/'),name=segments.at(-1),stem=name.split('.')[0];
  if(stem.length!==36||stem[14]!=='s')return value;
  segments[segments.length-1]=`${stem.slice(0,14)}x${stem.slice(15)}.${name.split('.').at(-1)}`;
  url.pathname=segments.join('/');return url.href;
}

export function parsePages(payload) {
  const seen=new Set();
  return requireArray(requireRecord(payload,'Inuko reader').pages,'Inuko pages').slice()
    .sort((a,b)=>Number(a?.index)-Number(b?.index)).map((item,index)=>{
      const row=requireRecord(item,'Inuko page'),value=string(row.image);
      let url;try{url=new URL(value);}catch{throw parseError('Invalid reader page URL.');}
      if(url.protocol!=='https:'||url.username||url.password||!Number.isInteger(row.index)||row.index<0||seen.has(row.index))throw parseError('Invalid reader page.');
      seen.add(row.index);return {index,imageUrl:normalizeImageUrl(value)};
    });
}
