import {load} from 'cheerio';

// Anonymous Node counterpart of the host's data-only HTML projection. Website
// scripts are never executed. Keep these modes aligned with source-api.d.ts.
export function extractHtml(body, projection) {
  const $ = load(body), base = projection.baseUrl;
  let nodes = 0, textSize = 0;
  const fail = message => {throw Object.assign(Error(message),{code:'parse_error'});};
  const text = (node, normalize = true) => {
    const value = $(node).text();
    return normalize ? value.replace(/\s+/gu,' ').trim() : value.trim();
  };
  function project(root, query, depth) {
    if (++nodes > 100000 || depth > 8) fail('HTML projection exceeds its node/depth limit');
    let matches = query.selector == null ? [root] : $(root).find(query.selector).toArray();
    if (matches.length > 10000) fail('HTML selector exceeds its match limit');
    if (query.directChildren) matches = matches.filter(node => node.parent === root);
    if (query.textEquals != null) matches = matches.filter(node => text(node) === query.textEquals);
    if (!query.all) matches = matches.slice(0,1);
    const modes = [query.fields != null,query.text,query.attr != null,query.html,query.outerHtml,query.tagName,query.containsText != null];
    if (modes.filter(Boolean).length !== 1) fail('HTML projection requires one output mode');
    const values = [];
    for (let node of matches) {
      for (let index = 0; index < (query.ascend ?? 0); index++) node = node?.parent;
      if (query.nextSibling) node = node ? $(node).next()[0] : null;
      if (!node) continue;
      let value;
      if (query.fields) value = Object.fromEntries(Object.entries(query.fields).map(([key,field]) => [key,project(node,field,depth+1)]));
      else if (query.containsText) value = query.containsText.some(term => text(node,false).toLowerCase().includes(term.toLowerCase()));
      else if (query.tagName) value = node.type === 'root' ? null : node.name;
      else if (query.text) {
        if (query.exclude) {
          const clone = $(node).clone();
          clone.find(query.exclude).remove();
          value = text(clone,query.normalizeWhitespace !== false);
        } else value = text(node,query.normalizeWhitespace !== false);
      } else if (query.attr != null) value = $(node).attr(query.attr) ?? null;
      else value = node.type === 'root' ? null : query.outerHtml ? $.html(node) : $(node).html();
      if (query.absoluteUrl && typeof value === 'string' && value.trim()) {
        const url = new URL(value.trim(),base);
        if (url.protocol !== 'https:' || url.username || url.password) fail('Invalid extracted URL');
        value = url.href;
      }
      if (query.required && (value == null || value === '')) fail('Required HTML field missing');
      if (typeof value === 'string' && (textSize += value.length) > 1024*1024) fail('HTML projection exceeds its text limit');
      values.push(value);
    }
    if (query.required && !values.length) fail('Required HTML element missing');
    return query.all ? values : values[0] ?? null;
  }
  if (typeof body !== 'string' || body.length > 8*1024*1024) fail('Invalid HTML input');
  return project($.root()[0],projection,0);
}
