// Per-factory, bounded reuse for paired title/details/chapters reads. Never use
// this for catalog refresh or writes. Account/settings changes replace the
// factory in the host; neither successful pages nor failures cross that scope.
export function recent(load,{ttlMs = 15000,limit = 2,now = () => Date.now()} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(limit) || limit < 1 || limit > 128) throw new TypeError('Invalid title cache bounds.');
  const entries = new Map();
  return function(key) {
    const old = entries.get(key);
    if (old && old.expires > now()) {
      entries.delete(key); entries.set(key,old); return old.promise;
    }
    entries.delete(key);
    while (entries.size >= limit) entries.delete(entries.keys().next().value);
    const entry = {expires:Infinity,promise:null};
    entry.promise = Promise.resolve().then(() => load(key)).then(value => {
      entry.expires = now()+ttlMs; return value;
    },error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key,entry);
    return entry.promise;
  };
}

export function recentRequest(load) {
  const cached = recent(async key => {
    const response = await load(JSON.parse(key));
    if (typeof response.body !== 'string' || !response.body.trim()) {
      throw Object.assign(Error('Empty title page.'),{code:'invalid_response',phase:'http'});
    }
    return response;
  });
  return input => input.method === 'GET' && input.responseType === 'text' ? cached(JSON.stringify(input)) : load(input);
}
