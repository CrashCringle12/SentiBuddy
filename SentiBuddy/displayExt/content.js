// content.js — Multi-workspace aggregation + strict batch detection + live filter HUD
const DEBUG = true;
const DEBUG_TOKENS_VERBOSE = false;
const DEBUG_TAG = 'Incidents++/content';

function dlog(...args){ if(DEBUG) console.log(`[${DEBUG_TAG}]`, ...args); }
function dgroup(title, fn){ if(!DEBUG) return fn(); console.groupCollapsed(`[${DEBUG_TAG}] ${title}`); try{ fn(); } finally { console.groupEnd(); } }
function maskToken(tok){
  if(!tok) return tok;
  if(DEBUG_TOKENS_VERBOSE) return tok;
  const m = String(tok).match(/^\s*([A-Za-z]+)\s+(.+?)\s*$/);
  if(!m) return tok.slice(0,12)+'…'+tok.slice(-12);
  const [,sch,body]=m; return `${sch} ${body.slice(0,12)}…${body.slice(-12)}`;
}
function el(id){ return document.getElementById(id); }

// 1) Inject page hook
(function inject(){
  const s=document.createElement('script');
  s.src=chrome.runtime.getURL('injected.js'); s.type='text/javascript';
  (document.head||document.documentElement).appendChild(s);
  s.onload=()=>s.remove();
  dlog('Injected page hook injected.js');
})();

// 2) Panel UI (adds Workspaces tab + filter HUD)
const PANEL_ID='json-watcher-panel';
if(!document.getElementById(PANEL_ID)){
  const panel=document.createElement('div');
  panel.id=PANEL_ID;
  panel.innerHTML=`
    <div id="json-watcher-header">
      <div id="json-watcher-title">Sentinel Incidents++ <span class="small">(live)</span></div>
      <div id="json-watcher-controls">
        <button id="btn-refresh">Refresh</button>
        <button id="btn-pause">Pause Raw</button>
        <button id="btn-hide">Hide</button>
      </div>
    </div>
    <div id="tabs">
      <div class="tab active" data-tab="incidents">Incidents (Top 100)</div>
      <div class="tab" data-tab="workspaces">Workspaces</div>
      <div class="tab" data-tab="raw">Raw Watch</div>
    </div>

    <div id="filter-status" class="small" style="padding:6px 10px;border-bottom:1px solid #1f2937;opacity:.9">
      current filter: (not captured yet)
    </div>

    <div id="json-watcher-body">
      <div id="view-incidents">
        <table id="incidents-table">
          <thead>
            <tr>
              <th style="width:28%">Title</th>
              <th style="width:10%">Severity</th>
              <th style="width:12%">Status</th>
              <th style="width:16%">Owner</th>
              <th style="width:16%">Workspace</th>
              <th style="width:10%">Updated (UTC)</th>
              <th style="width:8%">Link</th>
            </tr>
          </thead>
          <tbody id="incidents-tbody"></tbody>
        </table>
      </div>

      <div id="view-workspaces" class="hidden" style="padding:10px">
        <div id="ws-help" class="small" style="margin-bottom:8px;opacity:.8">
          Discovered from portal activity. Toggle which workspaces to include. Cross-tenant access uses any captured <code>x-ms-authorization-auxiliary</code> tokens automatically.
        </div>
        <div style="margin-bottom:8px; display:flex; gap:8px;">
          <button id="ws-select-all">Select all</button>
          <button id="ws-select-none">Select none</button>
        </div>
        <div id="ws-list"></div>
      </div>

      <div id="view-raw" class="hidden">
        <table id="json-watcher-table">
          <thead>
            <tr>
              <th style="width:28%">URL</th>
              <th style="width:14%">Method</th>
              <th style="width:18%">Matched</th>
              <th style="width:40%">Summary</th>
            </tr>
          </thead>
          <tbody id="json-watcher-tbody"></tbody>
        </table>
      </div>
    </div>
    <div id="json-watcher-footer">
      Debug: ${DEBUG ? 'ON' : 'OFF'} ${DEBUG_TOKENS_VERBOSE ? '(tokens verbose)' : '(tokens masked)'}
    </div>
  `;
  document.documentElement.appendChild(panel);

  // draggable
  (function(){
    const header=panel.querySelector('#json-watcher-header');
    let dragging=false,sx=0,sy=0,sr=0,sb=0;
    header.addEventListener('mousedown',e=>{
      dragging=true; sx=e.clientX; sy=e.clientY;
      const r=panel.getBoundingClientRect(); sr=innerWidth-r.right; sb=innerHeight-r.bottom;
    });
    addEventListener('mousemove',e=>{
      if(!dragging) return;
      panel.style.right=`${Math.max(0, sr-(e.clientX-sx))}px`;
      panel.style.bottom=`${Math.max(0, sb-(e.clientY-sy))}px`;
    });
    addEventListener('mouseup',()=>dragging=false);
  })();

  // tabs
  const tabs=panel.querySelectorAll('.tab');
  tabs.forEach(t=>t.addEventListener('click',()=>{
    tabs.forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    el('view-incidents').classList.toggle('hidden', t.dataset.tab!=='incidents');
    el('view-workspaces').classList.toggle('hidden', t.dataset.tab!=='workspaces');
    el('view-raw').classList.toggle('hidden', t.dataset.tab!=='raw');
  }));
}

// 3) UI refs
const tbodyRaw=el('json-watcher-tbody');
const tbodyInc=el('incidents-tbody');
const wsListEl=el('ws-list');
const pauseBtn=el('btn-pause');
const hideBtn =el('btn-hide');
const refreshBtn=el('btn-refresh');
const wsAllBtn=el('ws-select-all');
const wsNoneBtn=el('ws-select-none');

let pausedRaw=false;
pauseBtn.addEventListener('click',()=>{
  pausedRaw=!pausedRaw;
  pauseBtn.textContent=pausedRaw?'Resume Raw':'Pause Raw';
  dlog('Raw view paused =',pausedRaw);
});
hideBtn.addEventListener('click',()=>{ el('json-watcher-panel').style.display='none'; });
refreshBtn.addEventListener('click',()=>{ dlog('Manual refresh'); fetchAllEnabled(); });

// 4) State: tokens, queries, workspaces
let armToken=null;                 // Authorization
let auxHeader=null;                // x-ms-authorization-auxiliary (raw header)
let auxTokens=[];                  // parsed auxiliary tokens (comma-separated in header)
let armQuery=null;                 // { apiVersion, filter, orderby, top }
let lastQuerySig='';               // signature to detect query change
let fetchDebounceTimer=null;

const ctxMap=new Map();            // key -> { subId, rg, workspace, enabled, lastSeen }

// Helpers for filter HUD + query change detection
function signatureOfQuery(q) {
  if (!q) return '';
  // ignore paging knobs in signature
  return JSON.stringify({
    apiVersion: q.apiVersion || '',
    filter:     q.filter     || '',
    orderby:    q.orderby    || ''
  });
}
function scheduleFetch(reason) {
  clearTimeout(fetchDebounceTimer);
  fetchDebounceTimer = setTimeout(() => {
    dlog('Refetch scheduled because:', reason);
    fetchAllEnabled();
  }, 60);
}
function updateFilterStatus() {
  const strip = el('filter-status'); if (!strip) return;
  if (!armQuery) { strip.textContent = 'current filter: (not captured yet)'; return; }
  const lines = [
    `api-version: ${armQuery.apiVersion || '(n/a)'}`,
    `$orderby: ${armQuery.orderby || '(n/a)'}`,
    `$filter: ${armQuery.filter || '(n/a)'}`
  ];
  strip.textContent = 'current filter: ' + lines.join(' | ');
}

// Workspace helpers
const ctxKey = (c)=> `${c.subId}/${c.rg}/${c.workspace}`;
function addOrUpdateCtx(c){
  const key=ctxKey(c);
  const prev=ctxMap.get(key);
  ctxMap.set(key,{...c, enabled: prev?.enabled ?? true, lastSeen: Date.now()});
  renderWorkspaceList();
}
function setCtxEnabled(key, enabled){
  const it=ctxMap.get(key); if(!it) return;
  it.enabled=enabled; ctxMap.set(key,it);
}
function getEnabledCtxs(){ return [...ctxMap.values()].filter(x=>x.enabled); }
function parseWorkspaceFromId(resourceId){
  const m=/\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.OperationalInsights\/workspaces\/([^/]+)/.exec(resourceId||'');
  if(!m) return null; return {subId:m[1],rg:m[2],workspace:m[3]};
}

// 5) Messages from injected.js
addEventListener('message',(event)=>{
  if(event.source!==window) return;
  const msg=event.data; if(!msg) return;

  if(msg.__jsonWatcher===true){ if(!pausedRaw) addRawRow(msg.payload); }

  if(msg.__armAuth===true && msg.token){
    dgroup('Auth token captured',()=> dlog('token(masked)=',maskToken(msg.token)));
    armToken=msg.token;
  }
  if(msg.__armAux===true){
    auxHeader = msg.header || null;
    auxTokens = Array.isArray(msg.tokens) ? msg.tokens : [];
    dgroup('Aux tokens captured', ()=>{
      dlog('auxHeader=', !!auxHeader ? (auxHeader.slice(0,40)+'…') : '(none)');
      dlog('auxTokens count=', auxTokens.length);
    });
  }
  if(msg.__armCtx===true && msg.ctx){ addOrUpdateCtx(msg.ctx); }
  if(msg.__armCtxAdd===true && Array.isArray(msg.ctxs)){ msg.ctxs.forEach(addOrUpdateCtx); }

  if (msg.__armQuery === true && msg.query) {
    const newSig = signatureOfQuery(msg.query);
    const changed = newSig !== lastQuerySig;
    armQuery = msg.query;
    updateFilterStatus();
    if (changed) {
      dgroup('Portal query UPDATED', () => dlog(armQuery));
      lastQuerySig = newSig;
      scheduleFetch('portal query changed');
    } else {
      dlog('Portal query unchanged');
    }
  }

  if (msg.__armBatchSeen === true) {
    dlog('Batch refresh seen; token?', !!armToken, 'workspaces=', ctxMap.size, 'have query?', !!armQuery);
    scheduleFetch('batch seen');
  }
});

// 6) Raw view
function addRawRow({url,method,matchedBy,json}){
  const tr=document.createElement('tr');
  const summary=summarizeJson(json);
  tr.innerHTML=`
    <td>${url}</td>
    <td>${method}</td>
    <td>${matchedBy||''}</td>
    <td><pre style="white-space:pre-wrap;margin:0">${summary}</pre></td>
  `;
  tbodyRaw.insertBefore(tr,tbodyRaw.firstChild);
  const MAX_ROWS=200; while(tbodyRaw.children.length>MAX_ROWS) tbodyRaw.removeChild(tbodyRaw.lastChild);
}
function summarizeJson(obj){
  if(obj==null || typeof obj!=='object') return String(obj);
  const keys=Object.keys(obj);
  const preview=keys.slice(0,5).map(k=>`${k}: ${JSON.stringify(obj[k])}`);
  let text=`{ ${preview.join(', ')}${keys.length>5?', ...':''} }`;
  if(text.length>500) text=text.slice(0,500)+'…';
  return text;
}

// 7) Workspaces tab
function renderWorkspaceList(){
  wsListEl.innerHTML='';
  if(ctxMap.size===0){ wsListEl.textContent='No workspaces discovered yet. Interact with the portal queue to populate.'; return; }
  for(const [key,c] of ctxMap){
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1f2937';
    row.innerHTML=`
      <input type="checkbox" ${c.enabled?'checked':''} data-key="${key}" />
      <code style="font-size:12px">${c.subId}</code>
      <span>/</span>
      <span>${c.rg}</span>
      <span>/</span>
      <strong>${c.workspace}</strong>
      <span class="small" style="margin-left:auto;opacity:.7">last seen: ${new Date(c.lastSeen).toISOString()}</span>
    `;
    row.querySelector('input').addEventListener('change',e=>{
      setCtxEnabled(key, e.target.checked);
    });
    wsListEl.appendChild(row);
  }
}
wsAllBtn?.addEventListener('click', ()=>{
  [...ctxMap.keys()].forEach(k=>setCtxEnabled(k,true));
  renderWorkspaceList(); fetchAllEnabled();
});
wsNoneBtn?.addEventListener('click', ()=>{
  [...ctxMap.keys()].forEach(k=>setCtxEnabled(k,false));
  renderWorkspaceList(); fetchAllEnabled();
});

// 8) Aggregate fetch across enabled workspaces
async function fetchAllEnabled(){
  if(!armToken || ctxMap.size===0) { dlog('Fetch skipped: missing token or workspaces'); return; }

  const ctxs=getEnabledCtxs();
  if(ctxs.length===0){ dlog('No enabled workspaces'); tbodyInc.innerHTML=''; return; }

  dgroup(`Fetch all (${ctxs.length})`, ()=> dlog(ctxs));

  // Parallel but gentle: small stagger to reduce ARM burst
  const promises = ctxs.map((c, i)=> delay(i*150).then(()=> callWorkerList(c)));
  const results = await Promise.allSettled(promises);

  const allItems=[];
  results.forEach((r,idx)=>{
    const ctx=ctxs[idx];
    if(r.status==='fulfilled' && r.value && Array.isArray(r.value.value)){
      r.value.value.forEach(it=>{
        if(!it.properties) it.properties={};
        it.properties.__ws = ctx.workspace;
        it.properties.__subId = ctx.subId;
        it.properties.__rg = ctx.rg;
      });
      allItems.push(...r.value.value);
    } else {
      dlog('Workspace fetch failed:', ctx, r.reason||r.value);
    }
  });

  // Dedupe by (subId/rg/ws, incidentNumber), keep newest
  const { deduped, preCount, postCount } = dedupeIncidents(allItems);
  dlog(`Deduped incidents: ${preCount} → ${postCount}`);
  const items = deduped;

  // Sort newest first
  items.sort((a,b)=>{
    const pa=a.properties||{}, pb=b.properties||{};
    const ta=new Date(pa.lastModifiedTimeUtc||pa.lastUpdateTimeUtc||0).getTime();
    const tb=new Date(pb.lastModifiedTimeUtc||pb.lastUpdateTimeUtc||0).getTime();
    return tb-ta;
  });

  renderIncidents(items);
}
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function callWorkerList(ctx){
  const msg = {
    type:'listIncidentsTopN',
    token: armToken,
    auxHeader,                 // raw header if we captured it
    auxTokens,                 // parsed tokens (optional; worker prefers header if provided)
    ctx,
    top: 100,
    queryOverride: armQuery || null
  };
  const res = await chrome.runtime.sendMessage(msg);
  if(res?.error) throw new Error(res.error);
  return res; // { value, nextLink, ctxEcho }
}

// 9) Dedupe helpers
function getWorkspaceTuple(it) {
  const p = it.properties || {};
  const fromId = parseWorkspaceFromId(it.id||'') || {};
  return {
    subId : p.__subId || fromId.subId || '',
    rg    : p.__rg    || fromId.rg    || '',
    ws    : p.__ws    || fromId.workspace || ''
  };
}
function getIncidentNumber(it) {
  const p = it.properties || {};
  return p.incidentNumber ?? p.IncidentNumber ?? p.incidentnumber ?? p.additionalData?.incidentNumber ?? null;
}
function getIncidentTime(it) {
  const p = it.properties || {};
  return new Date(p.lastModifiedTimeUtc || p.lastUpdateTimeUtc || 0).getTime();
}
function dedupeIncidents(items) {
  const map = new Map();  // key -> chosen incident
  for (const it of items) {
    const { subId, rg, ws } = getWorkspaceTuple(it);
    const num = getIncidentNumber(it) ?? (it.name || it.id);
    const key = `${subId}/${rg}/${ws}::${String(num)}`;
    const cur = map.get(key);
    if (!cur) { map.set(key, it); continue; }
    if (getIncidentTime(it) >= getIncidentTime(cur)) map.set(key, it);
  }
  return { deduped: [...map.values()], preCount: items.length, postCount: map.size };
}

// 10) Render incidents table (with workspace + link)
function renderIncidents(items){
  tbodyInc.innerHTML='';
  for(const it of items){
    const p=it.properties||{};
    const title=(p.title||it.name||'').toString();
    const sev=(p.severity||'').toString();
    const status=(p.status||'').toString();
    const owner=(p.owner&&p.owner.assignedTo)||'';
    const updated=(p.lastUpdateTimeUtc||p.lastModifiedTimeUtc||'').toString();
    const ws = p.__ws || (parseWorkspaceFromId(it.id||'')?.workspace) || '';
    const link = it.id ? `https://portal.azure.com/#view/Microsoft_Azure_Security_Insights/IncidentBlade/id/${encodeURIComponent(it.id)}` : '';
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${escapeHtml(title)}</td>
      <td><span class="badge">${escapeHtml(sev)}</span></td>
      <td><span class="badge">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(owner)}</td>
      <td>${escapeHtml(ws)}</td>
      <td>${escapeHtml(updated)}</td>
      <td>${link ? `<a class="link" href="${link}" target="_blank" rel="noopener">Open</a>` : ''}</td>
    `;
    tbodyInc.appendChild(tr);
  }
  dlog('Rendered incidents rows =', items.length);
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
