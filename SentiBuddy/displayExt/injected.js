// injected.js — capture many workspaces, latest incidents filter, and auxiliary tokens; refresh on ANY /batch*
const DEBUG = true;
const DEBUG_TOKENS_VERBOSE = false;
const DEBUG_TAG = 'Incidents++/injected';

function dlog(...args){ if(DEBUG) console.log(`[${DEBUG_TAG}]`, ...args); }
function dgroup(title, fn){ if(!DEBUG) return fn(); console.groupCollapsed(`[${DEBUG_TAG}] ${title}`); try{ fn(); } finally { console.groupEnd(); } }
function maskToken(tok){ if(!tok) return tok; if(DEBUG_TOKENS_VERBOSE) return tok; const m=String(tok).match(/^\s*([A-Za-z]+)\s+(.+?)\s*$/); if(!m) return tok.slice(0,12)+'…'+tok.slice(-12); const [,sch,body]=m; return `${sch} ${body.slice(0,12)}…${body.slice(-12)}`; }

const MAX_BYTES = 2_000_000;

function emit(msg){ try{ window.postMessage(msg,'*'); }catch{} }
function decodeBuf(ab){ try{ return new TextDecoder('utf-8').decode(ab.byteLength>MAX_BYTES?ab.slice(0,MAX_BYTES):ab);}catch{return'';} }
function tryParseJson(t){ try{ return JSON.parse(t); } catch { return null; } }

// Batch URL detector: ANY GET/POST to /batch (regardless of api-version)
function isBatchUrl(u) {
  try {
    const url = new URL(u);
    return url.origin === 'https://management.azure.com' &&
           url.pathname.toLowerCase() === '/batch';
  } catch { return false; }
}

// Collect ALL workspace contexts present in a blob of text
function extractAllCtx(text){
  const out=new Map();
  const re=/\/subscriptions\/([0-9a-fA-F-]{36})\/resourceGroups\/([^\/]+)\/providers\/Microsoft\.OperationalInsights\/workspaces\/([^\/\?"'\s]+)/g;
  let m; while((m=re.exec(text))!==null){
    const ctx={subId:m[1], rg:m[2], workspace:m[3]};
    out.set(`${ctx.subId}/${ctx.rg}/${ctx.workspace}`, ctx);
  }
  return [...out.values()];
}

// Only accept "incidents list" URLs; ignore aggregations/cases/etc.
function isIncidentsListUrl(u) {
  try {
    const url = new URL(u.startsWith('http') ? u : ('https://management.azure.com' + (u.startsWith('/') ? '' : '/') + u));
    const p = url.pathname.toLowerCase();
    const isIncidents = p.includes('/providers/microsoft.securityinsights/incidents') &&
                        !p.includes('/providers/microsoft.securityinsights/aggregations/cases') &&
                        !p.includes('/providers/microsoft.securityinsights/entities') &&
                        !p.includes('/providers/microsoft.securityinsights/incidentrelations');
    return isIncidents;
  } catch { return false; }
}
function parseFilterWindow(filterStr) {
  if (!filterStr) return { start: null, end: null };
  const ge = filterStr.match(/last(?:modified|update)timeutc\s+ge\s+([0-9T:\.\-Z]+)/i);
  const le = filterStr.match(/last(?:modified|update)timeutc\s+le\s+([0-9T:\.\-Z]+)/i);
  const start = ge ? (Date.parse(ge[1]) || null) : null;
  const end   = le ? (Date.parse(le[1]) || null) : null;
  return { start, end };
}
function sanitizeQueryParts(sp) {
  const apiVersion = sp.get('api-version') || sp.get('apiVersion') || null;
  const filter     = sp.get('$filter') || null;
  const orderby    = sp.get('$orderby') || null;
  const top        = sp.get('$top') || null;
  return { apiVersion, filter, orderby, top };
}

// Extract the "best" incidents query (freshest time window) from a JSON batch payload or text
function extractIncidentsQuery(text) {
  const candidates = [];
  const j = tryParseJson(text);

  // 1) requests[]
  if (j && Array.isArray(j.requests)) {
    for (const r of j.requests) {
      const u = r && (r.relativeUrl || r.url);
      if (typeof u === 'string' && isIncidentsListUrl(u)) {
        const urlObj = new URL(u.startsWith('http') ? u : ('https://management.azure.com' + (u.startsWith('/') ? '' : '/') + u));
        const q = sanitizeQueryParts(urlObj.searchParams);
        const { end } = parseFilterWindow(q.filter || '');
        candidates.push({ ...q, url: urlObj.toString(), endTime: end || 0 });
      }
    }
  }

  // 2) responses[*].content (sometimes echoes URLs or objects)
  if (j && Array.isArray(j.responses)) {
    for (const r of j.responses) {
      const c = r && r.content;
      let possible = null;
      if (typeof c === 'string') possible = c;
      else if (c && typeof c === 'object') possible = JSON.stringify(c);
      if (possible && /\/providers\/Microsoft\.SecurityInsights\/incidents\?/i.test(possible)) {
        const m = possible.match(/https?:\/\/management\.azure\.com\/[^\s"']+\/providers\/Microsoft\.SecurityInsights\/incidents\?[^"'\s]+/i);
        if (m && m[0] && isIncidentsListUrl(m[0])) {
          const urlObj = new URL(m[0]);
          const q = sanitizeQueryParts(urlObj.searchParams);
          const { end } = parseFilterWindow(q.filter || '');
          candidates.push({ ...q, url: urlObj.toString(), endTime: end || 0 });
        }
      }
    }
  }

  // 3) Fallback: regex scan for "relativeUrl":"...incidents?..."
  if (candidates.length === 0) {
    const rx = /"relativeUrl"\s*:\s*"([^"]*\/providers\/Microsoft\.SecurityInsights\/incidents\?[^"]+)"/gi;
    let m;
    while ((m = rx.exec(text)) !== null) {
      const u = m[1];
      if (!isIncidentsListUrl(u)) continue;
      const urlObj = new URL(u.startsWith('http') ? u : ('https://management.azure.com' + (u.startsWith('/') ? '' : '/') + u));
      const q = sanitizeQueryParts(urlObj.searchParams);
      const { end } = parseFilterWindow(q.filter || '');
      candidates.push({ ...q, url: urlObj.toString(), endTime: end || 0 });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.endTime - b.endTime));
  return candidates[candidates.length - 1]; // freshest
}

// Parse auxiliary header into individual bearer tokens
function parseAuxHeader(val){ if(!val) return []; return val.split(',').map(s=>s.trim()).filter(Boolean); }

// Scrape outgoing headers to capture Authorization and x-ms-authorization-auxiliary
function handleHeadersForMgmt(url, headersLike){
  try{
    const H=new Headers(headersLike||{});
    const auth=H.get('Authorization');
    if(auth && url.startsWith('https://management.azure.com/')){
      dlog('Auth header found', url, 'token(masked)=', maskToken(auth));
      emit({ __armAuth:true, token: auth });
    }
    const aux=H.get('x-ms-authorization-auxiliary');
    if(aux && url.startsWith('https://management.azure.com/')){
      const tokens=parseAuxHeader(aux);
      dgroup('Aux header found', ()=>{ dlog('aux count =', tokens.length); });
      emit({ __armAux:true, header: aux, tokens });
    }
  }catch{}
}

// --- fetch hook ---
(function(){
  if(!window.fetch) return;
  const orig=window.fetch;
  window.fetch=async function(...args){
    const input=args[0]; const init=args[1]||{};
    const method=(init.method)||(input&&input.method)||'GET';
    const url=typeof input==='string'?input:(input&&input.url)||'';

    handleHeadersForMgmt(url, init.headers || (input && input.headers) || {});

    // Capture batch request body if present (rare for fetch here, but safe)
    const reqText = (isBatchUrl(url) && typeof init.body === 'string') ? init.body : null;

    const res=await orig(...args);
    try{
      const ct=res.headers.get('content-type')||''; const isJson=ct.includes('application/json');
      const text=isJson?decodeBuf(await res.clone().arrayBuffer()):'';

      if(isBatchUrl(url)){
        // contexts + filter from request body too
        if (reqText) {
          const ctxs_req = extractAllCtx(reqText);
          if(ctxs_req.length) emit({ __armCtxAdd:true, ctxs: ctxs_req });
          const qReq = extractIncidentsQuery(reqText);
          if(qReq) emit({ __armQuery:true, query:qReq });
        }

        const ctxs=extractAllCtx(text); if(ctxs.length) emit({ __armCtxAdd:true, ctxs });
        const q=extractIncidentsQuery(text); if(q) emit({ __armQuery:true, query:q });
        emit({ __armBatchSeen:true });

        emit({ __jsonWatcher:true, payload:{ url, method, matchedBy:'/batch(fetch)', json: tryParseJson(text) ?? {text:text.slice(0,2000)+'…'} }});
      } else if(url.startsWith('https://management.azure.com/')){
        const ctxs=extractAllCtx(text); if(ctxs.length) emit({ __armCtxAdd:true, ctxs });
        const q2=extractIncidentsQuery(text); if(q2) emit({ __armQuery:true, query:q2 });
      }
    }catch(e){ dlog('fetch hook err:', e); }
    return res;
  };
})();

// --- XHR hook ---
(function(){
  const Orig=window.XMLHttpRequest; if(!Orig) return;
  function Wrapped(){
    const xhr=new Orig();
    let _url='', _method='GET', _reqBody=null, _headers={};

    const oOpen=xhr.open;
    xhr.open=function(method,url,...rest){ _method=method||'GET'; _url=url||''; return oOpen.call(xhr,method,url,...rest); };

    const oSet=xhr.setRequestHeader;
    xhr.setRequestHeader=function(k,v){ _headers[k]=v; return oSet.call(xhr,k,v); };

    const oSend=xhr.send;
    xhr.send=function(body){ _reqBody=body; handleHeadersForMgmt(_url,_headers); return oSend.call(xhr,body); };

    xhr.addEventListener('readystatechange', function(){
      try{
        if(xhr.readyState!==4) return;
        const ct=xhr.getResponseHeader && xhr.getResponseHeader('content-type') || '';
        const isJson=ct.includes('application/json');

        if(isBatchUrl(_url)){
          if (typeof _reqBody==='string') {
            const ctxs_req = extractAllCtx(_reqBody);
            if(ctxs_req.length) emit({ __armCtxAdd:true, ctxs: ctxs_req });
            const qReq = extractIncidentsQuery(_reqBody);
            if(qReq) emit({ __armQuery:true, query:qReq });
          }
          if(isJson && xhr.responseText){
            const ctxs_res=extractAllCtx(xhr.responseText); if(ctxs_res.length) emit({ __armCtxAdd:true, ctxs: ctxs_res });
            const qRes=extractIncidentsQuery(xhr.responseText); if(qRes) emit({ __armQuery:true, query:qRes });
          }
          emit({ __armBatchSeen:true });
        }

        if(isJson && _url.startsWith('https://management.azure.com/')){
          let data=null; try{ data=JSON.parse(xhr.responseText); }catch{}
          emit({ __jsonWatcher:true, payload:{ url:_url, method:_method, matchedBy: isBatchUrl(_url)?'/batch(xhr)':'management(xhr)', json:data??{len:(xhr.responseText||'').length} }});
        }
      }catch(e){ dlog('xhr hook err:', e); }
    });
    return xhr;
  }
  Wrapped.prototype=Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  window.XMLHttpRequest=Wrapped;
  dlog('XHR hooked');
})();
