const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers}});
const error = (message, status) => json({error: message}, status);
const emailValid = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const bookingFields = 'id,slot_id,name,email,status,created_at';
const bookingJSON = "json_object('id',id,'slot_id',slot_id,'name',name,'email',email,'status',status,'created_at',created_at)";
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
async function digest(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
async function authorized(request, key) {
  if (!key) return false;
  return await digest(request.headers.get('X-API-Key') || '') === await digest(key);
}
async function bodyJSON(request) {
  // Bound actual bytes as well as Content-Length, which clients can omit.
  if (Number(request.headers.get('content-length')) > 65536) throw new Error('request body too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON body required');
  let size = 0; const chunks=[];
  for (;;) { const {value,done}=await reader.read(); if(done) break; size+=value.length; if(size>65536) {await reader.cancel(); throw new Error('request body too large');} chunks.push(value); }
  const all=new Uint8Array(size); let offset=0; for(const c of chunks){all.set(c,offset);offset+=c.length;}
  const parsed=JSON.parse(new TextDecoder().decode(all));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('JSON object required');
  return parsed;
}
export async function api(request, env) {
  if (!(await authorized(request,env.API_KEY))) return error('unauthorized',401);
  const db=env.DB, url=new URL(request.url), path=url.pathname, method=request.method;
  const q=(sql,...args)=>db.prepare(sql).bind(...args);
  try {
    if (path==='/reset' && method==='POST') {
      const b=await bodyJSON(request);
      if(!Array.isArray(b.slots) || b.slots.length>1000) return error('slots must be an array with at most 1000 entries',400);
      const seen=new Set();
      const dateValid=s=>typeof s==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
      for(const s of b.slots) {
        if(!s || !nonempty(s.id)||!nonempty(s.provider)||!dateValid(s.start)||!dateValid(s.end)||Date.parse(s.end)<=Date.parse(s.start)||seen.has(s.id)) return error('invalid or duplicate slot',400);
        seen.add(s.id);
      }
      await db.batch([q('DELETE FROM bookings'),q('DELETE FROM slots'),q('DELETE FROM idempotency'),q('DELETE FROM attempts'),...b.slots.map(s=>q('INSERT INTO slots(id,provider,start,end,start_ms) VALUES(?,?,?,?,?)',s.id,s.provider,s.start,s.end,Date.parse(s.start)))]);
      return json({ok:true});
    }
    if(path==='/slots' && method==='GET') {
      const provider=url.searchParams.get('provider');
      const rows=await q(`SELECT s.id,s.provider,s.start,s.end,NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status='confirmed') AS available FROM slots s ${provider!==null?'WHERE s.provider=?':''} ORDER BY s.start_ms,s.id`,...(provider!==null?[provider]:[])).all();
      return json({slots:rows.results.map(s=>({...s,available:!!s.available}))});
    }
    if(path==='/bookings' && method==='POST') {
      const b=await bodyJSON(request), now=Date.now(), id=crypto.randomUUID(), job=crypto.randomUUID();
      const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
      const name=typeof b.name==='string'?b.name.trim():'';
      const slot=typeof b.slot_id==='string'?b.slot_id:'';
      const valid=nonempty(slot)&&nonempty(name)&&emailValid(email)&&name.length<=200&&slot.length<=200;
      const key=request.headers.get('Idempotency-Key');
      if(key!==null && (!key.trim() || key.length>256)) return error('invalid Idempotency-Key',400);
      const fingerprint=await digest(JSON.stringify(canonical(b)));
      // One atomic D1 batch: nobody can change availability or counters between
      // these decisions and the insert. The partial unique index is a second guard.
      const result=await db.batch([
        q('DELETE FROM attempts WHERE at<=?',now-60000),
        q('INSERT INTO attempts(email,at) SELECT ?,? WHERE ? <> \'\' AND NOT EXISTS(SELECT 1 FROM idempotency WHERE key=?)',email,now,email,key),
        q(`INSERT INTO jobs(id,status,body,retry_after)
          SELECT ?,
          CASE WHEN i.key IS NOT NULL AND i.fingerprint<>? THEN 422 WHEN i.key IS NOT NULL THEN i.status
            WHEN ?<>'' AND (SELECT count(*) FROM attempts WHERE email=?)>5 THEN 429
            WHEN ?=0 THEN 400 WHEN s.id IS NULL THEN 404 WHEN s.start_ms<=? THEN 400
            WHEN EXISTS(SELECT 1 FROM bookings WHERE slot_id=? AND status='confirmed') THEN 409 ELSE 201 END,
          CASE WHEN i.key IS NOT NULL AND i.fingerprint<>? THEN json_object('error','Idempotency-Key reused with a different body') WHEN i.key IS NOT NULL THEN i.body
            WHEN ?<>'' AND (SELECT count(*) FROM attempts WHERE email=?)>5 THEN json_object('error','too many booking attempts')
            WHEN ?=0 THEN json_object('error','slot_id, name and a valid email are required') WHEN s.id IS NULL THEN json_object('error','slot not found') WHEN s.start_ms<=? THEN json_object('error','slot has already started')
            WHEN EXISTS(SELECT 1 FROM bookings WHERE slot_id=? AND status='confirmed') THEN json_object('error','slot already booked') ELSE NULL END,
          CASE WHEN i.key IS NOT NULL THEN i.retry_after WHEN ?<>'' AND (SELECT count(*) FROM attempts WHERE email=?)>5 THEN max(1,CAST(((SELECT min(at) FROM attempts WHERE email=?)+60000-?+999)/1000 AS INTEGER)) ELSE NULL END
          FROM (SELECT 1) LEFT JOIN slots s ON s.id=? LEFT JOIN idempotency i ON i.key=?`,job,fingerprint,email,email,valid?1:0,now,slot,fingerprint,email,email,valid?1:0,now,slot,email,email,email,now,slot,key),
        q("INSERT INTO bookings(id,slot_id,name,email,status,created_at) SELECT ?,?,?,?,'confirmed',? FROM jobs WHERE id=? AND status=201 AND body IS NULL",id,slot,name,email,new Date(now).toISOString(),job),
        q(`UPDATE jobs SET body=(SELECT ${bookingJSON} FROM bookings WHERE id=?) WHERE id=? AND body IS NULL`,id,job),
        q('INSERT INTO idempotency(key,fingerprint,status,body,retry_after) SELECT ?,?,status,body,retry_after FROM jobs WHERE id=? AND ? IS NOT NULL AND NOT EXISTS(SELECT 1 FROM idempotency WHERE key=?)',key,fingerprint,job,key,key),
        q('SELECT status,body,retry_after FROM jobs WHERE id=?',job),
        q('DELETE FROM jobs WHERE id=?',job)
      ]);
      const r=result[6].results[0];
      return json(JSON.parse(r.body),r.status,r.status===429?{'Retry-After':String(r.retry_after)}:{});
    }
    if(path==='/bookings' && method==='GET') {
      const email=(url.searchParams.get('email')||'').trim().toLowerCase();
      if(!emailValid(email)) return error('valid email is required',400);
      const raw=url.searchParams.get('limit')??'10';
      if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>50) return error('limit must be an integer from 1 to 50',400);
      const limit=Number(raw); let after=0;
      if(url.searchParams.has('cursor')) {
        try {const cursor=JSON.parse(atob(url.searchParams.get('cursor'))); if(cursor.email!==email||!Number.isSafeInteger(cursor.seq)||cursor.seq<1) throw 0; after=cursor.seq;} catch {return error('invalid cursor',400);}
      }
      const r=await q(`SELECT seq,${bookingFields} FROM bookings WHERE email=? AND seq>? ORDER BY seq LIMIT ?`,email,after,limit+1).all();
      const more=r.results.length>limit, rows=r.results.slice(0,limit);
      return json({bookings:rows.map(({seq,...b})=>b),next_cursor:more?btoa(JSON.stringify({email,seq:rows.at(-1).seq})):null});
    }
    const match=path.match(/^\/bookings\/([^/]+)$/);
    if(match && ['GET','DELETE'].includes(method)) {
      let id; try{id=decodeURIComponent(match[1]);}catch{return error('invalid booking id',400);}
      if(method==='GET') {const b=await q(`SELECT ${bookingFields} FROM bookings WHERE id=?`,id).first(); return b?json(b):error('booking not found',404);}
      const r=await db.batch([q(`UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed' RETURNING ${bookingFields}`,id),q(`SELECT ${bookingFields} FROM bookings WHERE id=?`,id)]);
      return r[0].results[0]?json(r[0].results[0]):r[1].results[0]?error('already cancelled',409):error('booking not found',404);
    }
    return error('endpoint not found',404);
  } catch(e) {
    if(e instanceof SyntaxError || /JSON|request body/.test(e.message)) return error('invalid JSON body',400);
    console.error('API request failed',e.message);
    return error('internal server error',500);
  }
}
