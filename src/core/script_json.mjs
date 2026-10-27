import {parseError} from './data.mjs';

// Read data literals without executing the surrounding site's JavaScript.
export function jsonAt(text,start) {
  while (/\s/u.test(text[start] ?? '') && start < text.length) start++;
  const open = text[start], close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) throw parseError('Expected a JSON object or array.');
  const stack = [close]; let quoted = false, escaped = false;
  for (let i=start+1;i<text.length;i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) throw parseError('Unbalanced JSON data.');
      if (!stack.length) {
        try {return JSON.parse(text.slice(start,i+1));}
        catch {throw parseError('Invalid JSON data.');}
      }
    }
    if (stack.length > 128) throw parseError('JSON data is nested too deeply.');
  }
  throw parseError('Incomplete JSON data.');
}

export function flightData(scripts) {
  const chunks = [];
  for (const script of scripts) {
    if (typeof script !== 'string') continue;
    for (const match of script.matchAll(/self\.__next_f\.push\s*\(/gu)) {
      const part = jsonAt(script,match.index+match[0].length);
      if (part[0] === 1 && typeof part[1] === 'string') chunks.push(part[1]);
    }
  }
  if (!chunks.length) throw parseError('Missing server-rendered page data.');
  return chunks.join('');
}

export function flightValues(data,key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*(?=[{\\[])`,'gu');
  return [...data.matchAll(pattern)].map(match => jsonAt(data,match.index+match[0].length));
}

export function assignedJson(scripts,name) {
  const marker = new RegExp(`(?:^|[;\\s])(?:window\\.)?${name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')}\\s*=\\s*`,'u');
  for (const text of scripts) {
    if (typeof text !== 'string') continue;
    const match = marker.exec(text);
    if (match) return jsonAt(text,match.index+match[0].length);
  }
  throw parseError(`Missing ${name} data.`);
}
