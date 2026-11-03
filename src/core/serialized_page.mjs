import {parseError} from './data.mjs';

// Read the data-only subset emitted by the SSR serializer. Never evaluate a
// script, function, constructor, property access or arbitrary expression.
export function serializedPage(scripts) {
  const code=scripts.find(value=>typeof value==='string'&&value.includes('$_TSR.router='));
  if(!code||code.length>12*1024*1024)throw parseError('Missing serialized page data.');
  const definitions=new Map(),fields=new Map(),values=new Map(),ends=new Map(),pending=new Set();
  let budget=300000;
  const fail=()=>{throw parseError('Invalid serialized page data.');};
  const space=p=>{while(/\s/u.test(code[p]??'')&&p<code.length)p++;return p;};
  function quoted(pos){
    const quote=code[pos++];let out='';
    while(pos<code.length){
      const c=code[pos++];if(c===quote)return {value:out,end:pos};
      if(c!=='\\'){out+=c;continue;}
      const esc=code[pos++],simple={'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f','v':'\v','0':'\0','\\':'\\','"':'"',"'":"'",'/':'/'};
      if(Object.hasOwn(simple,esc)){out+=simple[esc];continue;}
      const digits=esc==='x'?2:esc==='u'?4:0;
      if(!digits)fail();
      const raw=code.slice(pos,pos+digits);if(!new RegExp(`^[0-9a-f]{${digits}}$`,'iu').test(raw))fail();
      out+=String.fromCharCode(parseInt(raw,16));pos+=digits;
    }
    fail();
  }
  // Index references and field positions once, ignoring all quoted text.
  for(let pos=0;pos<code.length;){
    const c=code[pos];
    if(c==='"'||c==="'"){
      const item=quoted(pos),next=space(item.end);
      if(code[next]===':'){if(!fields.has(item.value))fields.set(item.value,[]);fields.get(item.value).push(next+1);}
      pos=item.end;continue;
    }
    if(c==='$'&&code.startsWith('$R[',pos)){
      const match=/^\$R\[(\d+)\]\s*=/u.exec(code.slice(pos,pos+32));
      if(match&&!definitions.has(Number(match[1])))definitions.set(Number(match[1]),pos+match[0].length);
    }
    if(/[a-zA-Z_$]/u.test(c)){
      const match=/^[\w$]+/u.exec(code.slice(pos,pos+128)),next=space(pos+match[0].length);
      if(code[next]===':'){if(!fields.has(match[0]))fields.set(match[0],[]);fields.get(match[0]).push(next+1);}
      pos+=match[0].length;
    }else pos++;
  }
  function reference(id,depth){
    if(values.has(id))return values.get(id);
    if(pending.has(id)||!definitions.has(id))fail();
    pending.add(id);
    const parsed=read(definitions.get(id),depth+1);
    pending.delete(id);values.set(id,parsed.value);ends.set(id,parsed.end);return parsed.value;
  }
  function read(pos,depth=0){
    if(depth>100||--budget<0)fail();pos=space(pos);
    const c=code[pos];
    if(c==='"'||c==="'")return quoted(pos);
    if(code.startsWith('$R[',pos)){
      const match=/^\$R\[(\d+)\]/u.exec(code.slice(pos,pos+24));if(!match)fail();
      const id=Number(match[1]);let end=space(pos+match[0].length);
      if(code[end]==='='){
        if(values.has(id))return {value:values.get(id),end:ends.get(id)};
        const parsed=read(end+1,depth+1);values.set(id,parsed.value);ends.set(id,parsed.end);return parsed;
      }
      return {value:reference(id,depth),end};
    }
    if(c==='['||c==='{'){
      const array=c==='[',value=array?[]:Object.create(null),close=array?']':'}';pos=space(pos+1);
      while(code[pos]!==close){
        let key;
        if(!array){
          if(code[pos]==='"'||code[pos]==="'"){const parsed=quoted(pos);key=parsed.value;pos=parsed.end;}
          else{const match=/^(?:[a-zA-Z_$][\w$]*|\d+)/u.exec(code.slice(pos,pos+128));if(!match)fail();key=match[0];pos+=key.length;}
          pos=space(pos);if(code[pos++]!==':')fail();
        }
        const parsed=read(pos,depth+1);if(array)value.push(parsed.value);else value[key]=parsed.value;
        pos=space(parsed.end);if(code[pos]===close)break;if(code[pos++]!==',')fail();pos=space(pos);
      }
      return {value,end:pos+1};
    }
    const constants=[['!0',true],['!1',false],['true',true],['false',false],['null',null],['undefined',null]];
    for(const [token,value] of constants)if(code.startsWith(token,pos)&&!/[\w$]/u.test(code[pos+token.length]??''))return {value,end:pos+token.length};
    const undef=/^void\s+0\b/u.exec(code.slice(pos,pos+20));if(undef)return {value:null,end:pos+undef[0].length};
    const number=/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu.exec(code.slice(pos,pos+64));
    if(number){const value=Number(number[0]);if(!Number.isFinite(value))fail();return {value,end:pos+number[0].length};}
    fail();
  }
  return {
    values(key){return (fields.get(key)??[]).map(pos=>read(pos).value);},
    first(key,predicate=()=>true){for(const pos of fields.get(key)??[]){const value=read(pos).value;if(predicate(value))return value;}throw parseError(`Missing page field: ${key}.`);},
  };
}
