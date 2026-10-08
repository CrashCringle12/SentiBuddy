// worker.js — fetch per-workspace using latest portal filter; supports auxiliary header (multi-tenant)
const DEBUG = true;
const DEBUG_TAG = 'Incidents++/worker';

const API_VERSION_FALLBACK = '2021-10-01-preview';
const ORDERBY_FALLBACK = 'properties/lastModifiedTimeUtc desc';

function dlog(...args){ if(DEBUG) console.log(`[${DEBUG_TAG}]`, ...args); }
function dgroup(title, fn){ if(!DEBUG) return fn(); console.groupCollapsed(`[${DEBUG_TAG}] ${title}`); try{ fn(); } finally { console.groupEnd(); } }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'listIncidentsTopN') {
        const { token, auxHeader=null, auxTokens=null, ctx, top=100, queryOverride=null } = msg;
        dgroup('listIncidentsTopN', ()=> {
          dlog('ctx=', ctx);
          dlog('have token?', !!token, 'auxHeader?', !!auxHeader, 'auxTokens?', Array.isArray(auxTokens)?auxTokens.length:0);
          dlog('top=', top, 'queryOverride=', queryOverride);
        });
        if(!token || !ctx?.subId || !ctx?.rg || !ctx?.workspace) throw new Error('Missing token or context');

        const base = `https://management.azure.com/subscriptions/${encodeURIComponent(ctx.subId)}` +
                     `/resourceGroups/${encodeURIComponent(ctx.rg)}` +
                     `/providers/Microsoft.OperationalInsights/workspaces/${encodeURIComponent(ctx.workspace)}` +
                     `/providers/Microsoft.SecurityInsights/incidents`;

        const apiVersion = queryOverride?.apiVersion || API_VERSION_FALLBACK;
        const filter     = queryOverride?.filter     || null;
        const orderby    = queryOverride?.orderby    || ORDERBY_FALLBACK;

        const overrideTopNum = Number(queryOverride?.top || 0);
        const finalTop = Math.max(Number(top)||100, isFinite(overrideTopNum)?overrideTopNum:0);

        const sp = new URLSearchParams();
        sp.set('api-version', apiVersion);
        if (filter)  sp.set('$filter',  filter);
        if (orderby) sp.set('$orderby', orderby);
        sp.set('$top', String(finalTop));

        const url = `${base}?${sp.toString()}`;
        const headers = new Headers({ 'Authorization': token });
        if (auxHeader && typeof auxHeader === 'string') {
          headers.set('x-ms-authorization-auxiliary', auxHeader);
        } else if (Array.isArray(auxTokens) && auxTokens.length > 0) {
          headers.set('x-ms-authorization-auxiliary', auxTokens.join(','));
        }

        dgroup('ARM GET', ()=> dlog(url, 'aux=', headers.get('x-ms-authorization-auxiliary') ? '(present)' : '(none)'));

        const res = await fetch(url, { method: 'GET', headers });
        const ct = res.headers.get('content-type') || '';
        const text = await res.text();

        dgroup('ARM response', ()=>{
          dlog('status', res.status, res.statusText);
          dlog('content-type', ct);
          dlog('body (first 800)=', text.slice(0,800) + (text.length>800?'…':''));
        });

        if(!res.ok) throw new Error(`ARM ${res.status} ${res.statusText} :: ${text.slice(0,300)}`);

        let data; try { data = JSON.parse(text); } catch(e){ throw new Error('JSON parse failed: '+String(e)+' :: '+text.slice(0,200)); }
        const value = Array.isArray(data.value) ? data.value : [];

        sendResponse({ value, nextLink: data.nextLink || null, ctxEcho: ctx });
        return;
      }
      sendResponse({ ok:true });
    } catch (e) {
      dlog('worker error:', e);
      sendResponse({ error:String(e) });
    }
  })();
  return true;
});
