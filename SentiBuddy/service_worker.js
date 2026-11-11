const notificationTab = {};
let queueActive = false;
// Holds data from last active incident in Sentinel
let lastAlertData = {};
const maxAgeInDays = 90;
const verbose = true;  // This is a flag, typically set to get detailed responses
// Set the API key
var abuseipdbAPIkey = '';
var VTkey = '';
var scamalyticsURL = '';
var ipInfoKey = '';
function loadKeys() {
  chrome.storage.local.get({
    abuseipdbAPIkey: '',
    vtkey: '',
    scamalyticsURL: '',
    ipInfoKey: ''
  }, (items) => {
    abuseipdbAPIkey = items.abuseipdbAPIkey;
    VTkey = items.vtkey;
    scamalyticsURL = items.scamalyticsURL;
    ipInfoKey = items.ipInfoKey;

  });
}
loadKeys();
function getSentiBuddyIconUrl() {
  return chrome.runtime.getURL('icon.png'); // Make sure 'icon.png' is the correct filename for your SentiBuddy icon
}

async function handleAPIRequests(request, sendResponse) {
  // Load API keys (ensure this function is async or handles promises correctly)
  await loadKeys();

  const relevantResponse = { abuseIPDB: {}, IPInfo: {}, Scamalytics: {}, ip: true };

  // Prepare promises for both requests
  const abuseIPDBPromise = abuseipdbAPIkey
    ? fetchAbuseIPDB(request.ip, abuseipdbAPIkey)
    : Promise.resolve({ error: "No AbuseIPDB ApiKey provided. Please provide a key in the configuration's menu via ALT+C" });

  const ipInfoPromise = ipInfoKey
    ? fetchIpInfo(request.ip, ipInfoKey)
    : Promise.resolve({ error: "No IpInfo APIKey provided. Please provide a key in the configuration's menu via ALT+C" });

  const ScamalyticsPromise = scamalyticsURL
    ? fetchScamalytics(request.ip, scamalyticsURL)
    : Promise.resolve({ error: "No Scamalytics URL provided. Please provide a URL in the configuration's menu via ALT+C" });

  // Execute both requests in parallel and wait for both to complete
  try {
    const [abuseIPDBData, ipInfoData, scamalyticsData] = await Promise.all([abuseIPDBPromise, ipInfoPromise, ScamalyticsPromise]);
    relevantResponse.abuseIPDB = abuseIPDBData.data;
    relevantResponse.IPInfo = ipInfoData;
    relevantResponse.Scamalytics = scamalyticsData

    sendResponse(relevantResponse);
  } catch (error) {
    sendResponse({ error: error.toString() });
  }
}

async function handleHashAPIRequests(request, sendResponse) {
  // Load API keys (ensure this function is async or handles promises correctly)
  await loadKeys();

  const relevantResponse = { VT: {}, ip: false };

  // Prepare promises for VT request
  const VirusTotalPromise = VTkey
    ? fetchVirusTotalHash(request.hash, VTkey)
    : Promise.resolve({ error: "No VirusTotal API Key provided. Please provide a URL in the configuration's menu via ALT+C" });

  // Execute both requests in parallel and wait for both to complete
  try {
    const [virusTotalData] = await Promise.all([VirusTotalPromise]);
    relevantResponse.VT = virusTotalData

    sendResponse(relevantResponse);
  } catch (error) {
    sendResponse({ error: error.toString() });
  }
}
function fetchAbuseIPDB(ip, apiKey) {
  const headers = new Headers({
    'Key': apiKey,
    'Accept': 'application/json'
  });
  const queryParams = new URLSearchParams({ ipAddress: ip, maxAgeInDays: maxAgeInDays, verbose: verbose });
  const url = `https://api.abuseipdb.com/api/v2/check?${queryParams}`;
  
  return fetch(url, { method: 'GET', headers: headers, mode: 'cors' })
    .then(response => response.json());
}

function fetchIpInfo(ip, token) {
  const url = `https://ipinfo.io/${ip}?token=${token}`;
  return fetch(url)
    .then(response => response.json());
}

function fetchScamalytics(ip, apiURL) {
  const headers = new Headers({
    'Accept': 'application/json'
  });
  const url = `${apiURL}&ip=${ip}`;
  return fetch(url, { headers: headers })
    .then(response => response.json());
}

function fetchVirusTotalIP(ip, VTkey) {
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-apikey': VTkey
    },
    mode: 'cors'
  };

  fetch(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`, options)
    .then(response => response.json())
    .then(data => {
      sendResponse({ VT: data });  // Send VT data as additional response
    })
    .catch(err => {
      console.error("VirusTotal API error:", err);
      sendResponse({ error: err.toString() });
    });
}

function fetchVirusTotalHash(hash, VTkey) {
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-apikey': VTkey
    },
    mode: 'cors'
  };
  return fetch(`https://www.virustotal.com/api/v3/files/${hash}`, options)
    .then(response => response.json());
}

// ---- Enhanced Queue: ARM incident listing (mirrors NewFeedTest worker, plus nextLink paging)
const EQ_API_VERSION_FALLBACK = '2021-10-01-preview';
const EQ_ORDERBY_FALLBACK = 'properties/lastModifiedTimeUtc desc';
const EQ_MAX_PAGES = 50;

async function listIncidentsAll({ token, auxHeader = null, auxTokens = null, ctx, top = 100, queryOverride = null }) {
  if (!token || !ctx?.subId || !ctx?.rg || !ctx?.workspace) throw new Error('Missing token or context');

  const base = `https://management.azure.com/subscriptions/${encodeURIComponent(ctx.subId)}` +
               `/resourceGroups/${encodeURIComponent(ctx.rg)}` +
               `/providers/Microsoft.OperationalInsights/workspaces/${encodeURIComponent(ctx.workspace)}` +
               `/providers/Microsoft.SecurityInsights/incidents`;

  const apiVersion = queryOverride?.apiVersion || EQ_API_VERSION_FALLBACK;
  let filter     = queryOverride?.filter     || null;
  const orderby    = queryOverride?.orderby    || EQ_ORDERBY_FALLBACK;

  // Fallback: if no filter captured from portal, apply a default 24-hour lookback
  if (!filter) {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startTime = oneDayAgo.toISOString();
    const endTime = now.toISOString();
    filter = `properties/lastModifiedTimeUtc ge ${startTime} and properties/lastModifiedTimeUtc le ${endTime}`;
  }

  const overrideTopNum = Number(queryOverride?.top || 0);
  const finalTop = Math.max(Number(top) || 100, isFinite(overrideTopNum) ? overrideTopNum : 0);

  const sp = new URLSearchParams();
  sp.set('api-version', apiVersion);
  if (filter)  sp.set('$filter',  filter);
  if (orderby) sp.set('$orderby', orderby);
  sp.set('$top', String(finalTop));

  const headers = new Headers({ 'Authorization': token });
  if (auxHeader && typeof auxHeader === 'string') {
    headers.set('x-ms-authorization-auxiliary', auxHeader);
  } else if (Array.isArray(auxTokens) && auxTokens.length > 0) {
    headers.set('x-ms-authorization-auxiliary', auxTokens.join(','));
  }

  const value = [];
  let url = `${base}?${sp.toString()}`;
  let pages = 0;
  let truncated = false;

  while (url) {
    if (pages >= EQ_MAX_PAGES) { truncated = true; break; }
    // nextLink must stay on ARM so the bearer token is never sent elsewhere.
    if (!url.startsWith('https://management.azure.com/')) break;

    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`ARM ${res.status} ${res.statusText} :: ${text.slice(0, 300)}`);

    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('JSON parse failed: ' + String(e) + ' :: ' + text.slice(0, 200)); }
    if (Array.isArray(data.value)) value.push(...data.value);

    url = data.nextLink || null;
    pages++;
  }

  return { value, pages, truncated, ctxEcho: ctx };
}

// ---- Playbook buttons (from the config): resolve the client's playbook and run it on an incident
const ARM = 'https://management.azure.com';
const PB_INCIDENT_API = '2023-11-01';
const PB_RUN_PLAYBOOK_API = '2024-01-01-preview';
// Segments exclude ? # % and whitespace so an ID (which can come from a crafted portal link)
// can't add query strings, fragments or encoded traversal to the ARM request path.
const PB_SEG = "[^/?#%\\s]+";
const PB_INCIDENT_ID_RE = new RegExp(`^/subscriptions/([0-9a-f-]{36})/resourceGroups/(${PB_SEG})/providers/Microsoft\\.OperationalInsights/workspaces/(${PB_SEG})/providers/Microsoft\\.SecurityInsights/incidents/(${PB_SEG})$`, 'i');
const PB_WORKFLOW_ID_RE = new RegExp(`^/subscriptions/([0-9a-f-]{36})/resourceGroups/(${PB_SEG})/providers/Microsoft\\.Logic/workflows/(${PB_SEG})$`, 'i');
// Buttons come from "playbooks" in the master config (configDataURL); see Playbook-Buttons.md.
// The config is remote input, so every field is validated and length-capped, and a button can
// only run Logic Apps that match its own matcher inside the incident's subscription/resource group.
const PLAYBOOK_CACHE_KEY = 'playbookConfigCache';
const PLAYBOOK_CACHE_MS = 30 * 60 * 1000;
const PLAYBOOK_MAX_BUTTONS = 20;
// No built-in buttons: without a "playbooks" section in the master config, none are shown.
const MATCH_KEYS = ['name', 'prefix', 'suffix', 'contains', 'regex'];

function cfgText(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}
function validRegex(src) {
  try { new RegExp(src, 'i'); return true; } catch { return false; }
}
function contrastText(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150 ? '#1b1a19' : '#ffffff';
}

function normalizeMatch(m) {
  if (!m || typeof m !== 'object') return null;
  const out = { versioned: m.versioned === true, exclude: [] };
  for (const k of ['name', 'prefix', 'suffix', 'contains']) {
    const v = cfgText(m[k], 120).toLowerCase();
    if (v) out[k] = v;
  }
  // "-isolate-host-v" + versioned: the version is matched separately, so drop the "-v".
  if (out.versioned && out.suffix?.endsWith('-v')) out.suffix = out.suffix.slice(0, -2);
  const re = cfgText(m.regex, 300);
  if (re) {
    if (!validRegex(re)) return null;
    out.regex = re;
  }
  if (Array.isArray(m.exclude)) {
    out.exclude = m.exclude.map(x => cfgText(x, 120).toLowerCase()).filter(Boolean).slice(0, 20);
  }
  return MATCH_KEYS.some(k => out[k]) ? out : null;
}

function normalizeButton(b) {
  if (!b || typeof b !== 'object') return null;
  const id = cfgText(b.id, 40).toLowerCase();
  const label = cfgText(b.label, 32);
  const match = normalizeMatch(b.match);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || !label || !match) return null;
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color.toLowerCase() : '#605e5c';
  const confirm = b.confirm && typeof b.confirm === 'object' ? b.confirm : {};
  return {
    id, label, color,
    textColor: contrastText(color),
    icon: Array.from(cfgText(b.icon, 16)).slice(0, 2).join(''),
    description: cfgText(b.description, 200) || `Run the ${label} playbook (asks for confirmation)`,
    scope: b.scope === 'subscription' ? 'subscription' : 'resourceGroup',
    match,
    confirm: {
      title: cfgText(confirm.title, 60) || label,
      question: cfgText(confirm.question, 300) || `Run ${label} on this incident? This will run:`,
      button: cfgText(confirm.button, 40) || `Yes, run ${label}`
    }
  };
}

function normalizePlaybookConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const seen = new Set();
  const buttons = (Array.isArray(src.buttons) ? src.buttons : [])
    .map(normalizeButton)
    .filter(b => b && !seen.has(b.id) && seen.add(b.id))
    .slice(0, PLAYBOOK_MAX_BUTTONS);
  const pattern = cfgText(src.workspaceClientPattern, 300);
  return { workspaceClientPattern: pattern && validRegex(pattern) ? pattern : '', buttons };
}

// "documentation" in the master config: incident-title regex → documentation (Confluence) link,
// checked in order, first match wins. Accepted shapes:
//   [{ "title": "<regex>", "url": "https://..." }, ...]   (also "pattern"/"match" and "link")
//   [["<regex>", "https://..."], ...]
//   { "<regex>": "https://...", ... }
const DOC_MAX_ENTRIES = 500;
function normalizeDocumentation(raw) {
  const pairs = Array.isArray(raw)
    ? raw.map(e => (Array.isArray(e) ? [e[0], e[1]] : e && typeof e === 'object' ? [e.title ?? e.pattern ?? e.match, e.url ?? e.link] : null))
    : raw && typeof raw === 'object' ? Object.entries(raw) : [];
  const out = [];
  for (const p of pairs) {
    if (!p) continue;
    const pattern = cfgText(p[0], 500);
    const url = cfgText(p[1], 2000);
    if (!pattern || !validRegex(pattern)) continue;
    try {
      if (new URL(url).protocol !== 'https:') continue;
    } catch { continue; }
    out.push({ pattern, url });
    if (out.length >= DOC_MAX_ENTRIES) break;
  }
  return out;
}

// Master config is fetched over https and cached for 30 minutes; on a failed fetch the last good
// copy for the same URL keeps working. One fetch serves both "playbooks" and "documentation".
async function loadMasterConfig() {
  const store = await chrome.storage.local.get({ configDataURL: '', [PLAYBOOK_CACHE_KEY]: null });
  const url = String(store.configDataURL || '').trim();
  const cache = store[PLAYBOOK_CACHE_KEY];
  const cacheUsable = cache?.url === url && Array.isArray(cache.documentation);
  if (cacheUsable && Date.now() - cache.at < PLAYBOOK_CACHE_MS) return cache;

  let raw = null;
  if (/^https:\/\//i.test(url)) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (e) {
      console.warn('SentiBuddy: master config fetch failed:', e);
      return cacheUsable ? cache : { url, config: normalizePlaybookConfig(null), documentation: [] };
    }
  }
  const entry = {
    url,
    at: Date.now(),
    config: normalizePlaybookConfig(raw?.playbooks ?? null),
    documentation: normalizeDocumentation(raw?.documentation)
  };
  await chrome.storage.local.set({ [PLAYBOOK_CACHE_KEY]: entry });
  return entry;
}

async function loadPlaybookConfig() {
  return (await loadMasterConfig()).config;
}

// First documentation entry whose pattern matches the incident title (case-insensitive).
const docRegexCache = new Map();
async function findDocumentation(title) {
  const t = cfgText(title, 1000);
  if (!t) return null;
  const { documentation } = await loadMasterConfig();
  for (const d of documentation) {
    let re = docRegexCache.get(d.pattern);
    if (!re) {
      re = new RegExp(d.pattern, 'i');
      docRegexCache.set(d.pattern, re);
    }
    if (re.test(t)) return d.url;
  }
  return null;
}

// What the incident page needs to draw buttons and dialogs (matchers stay in the worker).
function publicButton(b) {
  const { id, label, color, textColor, icon, description, confirm } = b;
  return { id, label, color, textColor, icon, description, confirm };
}

async function findPlaybookButton(buttonId) {
  const config = await loadPlaybookConfig();
  const button = config.buttons.find(b => b.id === buttonId);
  if (!button) throw new Error('This playbook button is no longer in the SentiBuddy config');
  return { config, button };
}

// Returns { client, version } when a Logic App name matches the button's matcher, else null.
// "client" is whatever is left of the name once the matched text and version are removed,
// e.g. "(acme)-isolate-host-v4" with suffix "-isolate-host" → client "acme", version 4.
function matchPlaybook(name, match) {
  const lower = String(name || '').toLowerCase();
  if (!lower || match.exclude.some(x => lower.includes(x))) return null;
  if (match.regex) {
    const m = new RegExp(match.regex, 'i').exec(name);
    if (!m) return null;
    return { client: (m.groups?.client || '').toLowerCase(), version: Number(m.groups?.version) || 0 };
  }
  let rest = lower;
  let version = 0;
  if (match.versioned) {
    const v = /-v(\d+)$/.exec(rest);
    if (v) { version = Number(v[1]); rest = rest.slice(0, v.index); }
  }
  if (match.name) {
    if (rest !== match.name) return null;
    rest = '';
  }
  if (match.prefix) {
    if (!rest.startsWith(match.prefix)) return null;
    rest = rest.slice(match.prefix.length);
  }
  if (match.suffix) {
    if (!rest.endsWith(match.suffix)) return null;
    rest = rest.slice(0, rest.length - match.suffix.length);
  }
  if (match.contains) {
    const i = rest.indexOf(match.contains);
    if (i < 0) return null;
    rest = `${rest.slice(0, i)} ${rest.slice(i + match.contains.length)}`;
  }
  return { client: rest.replace(/[^a-z0-9]+/g, ' ').trim(), version };
}

function describeMatch(m) {
  if (m.regex) return `matching /${m.regex}/`;
  const parts = [];
  if (m.name) parts.push(`named "${m.name}"`);
  if (m.prefix) parts.push(`starting with "${m.prefix}"`);
  if (m.contains) parts.push(`containing "${m.contains}"`);
  if (m.suffix) parts.push(`ending with "${m.suffix}"`);
  return parts.join(', ') + (m.versioned ? ' (optionally followed by -vN)' : '');
}

function armHeaders({ token, auxHeader }) {
  const headers = new Headers({ 'Authorization': token, 'Content-Type': 'application/json' });
  if (auxHeader && typeof auxHeader === 'string') headers.set('x-ms-authorization-auxiliary', auxHeader);
  return headers;
}

async function armJson(path, auth, init = {}) {
  const res = await fetch(`${ARM}${path}`, { ...init, headers: armHeaders(auth) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `ARM ${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function parseIncidentArmId(incidentArmId) {
  const m = PB_INCIDENT_ID_RE.exec(incidentArmId || '');
  if (!m) throw new Error('Not a Sentinel incident resource ID');
  return { subId: m[1], rg: m[2], workspace: m[3], incidentName: m[4] };
}

// Pick the playbook whose client code matches the workspace. The pattern (playbooks.workspaceClientPattern,
// else the top-level workspaceClientPattern setting) extracts the code first, e.g. soc-acme1 → "acme";
// then name segments, then substrings.
function suggestPlaybook(candidates, workspace, clientPattern) {
  if (candidates.length === 1) return candidates[0];
  const ws = workspace.toLowerCase();
  const named = candidates.filter(c => c.client);
  if (clientPattern) {
    const m = new RegExp(clientPattern, 'i').exec(workspace);
    const code = (m?.groups?.client ?? m?.[1] ?? '').toLowerCase();
    const exact = code ? named.filter(c => c.client === code) : [];
    if (exact.length === 1) return exact[0];
  }
  const segments = new Set(ws.split(/[-_.\s]/));
  const hits = named.filter(c => segments.has(c.client));
  if (hits.length === 1) return hits[0];
  const loose = named.filter(c => ws.includes(c.client));
  return loose.length === 1 ? loose[0] : null;
}

async function listWorkflows(ctx, auth, scope) {
  const base = scope === 'subscription'
    ? `/subscriptions/${ctx.subId}`
    : `/subscriptions/${ctx.subId}/resourceGroups/${encodeURIComponent(ctx.rg)}`;
  const workflows = [];
  let next = `${base}/providers/Microsoft.Logic/workflows?api-version=2016-06-01`;
  for (let page = 0; next && page < 20; page++) {
    const data = await armJson(next, auth);
    if (Array.isArray(data?.value)) workflows.push(...data.value);
    next = data?.nextLink && data.nextLink.startsWith(ARM + '/') ? data.nextLink.slice(ARM.length) : null;
  }
  return workflows;
}

async function playbookResolve({ token, auxHeader, incidentArmId, buttonId }) {
  const { config, button } = await findPlaybookButton(buttonId);
  const auth = { token, auxHeader };
  const ctx = parseIncidentArmId(incidentArmId);

  const [incident, subscription, workflows] = await Promise.all([
    armJson(`${incidentArmId}?api-version=${PB_INCIDENT_API}`, auth),
    armJson(`/subscriptions/${ctx.subId}?api-version=2022-12-01`, auth),
    listWorkflows(ctx, auth, button.scope)
  ]);

  // Keep only the newest version per client.
  const byClient = new Map();
  for (const wf of workflows) {
    const m = matchPlaybook(wf.name, button.match);
    if (!m || !PB_WORKFLOW_ID_RE.test(wf.id || '')) continue;
    const cand = { name: wf.name, id: wf.id, client: m.client, version: m.version };
    const cur = byClient.get(cand.client);
    if (!cur || cand.version > cur.version) byClient.set(cand.client, cand);
  }
  const candidates = [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name));
  const { workspaceClientPattern: shared } = await chrome.storage.local.get({ workspaceClientPattern: '' });
  const sharedPattern = cfgText(shared, 300);
  const pattern = config.workspaceClientPattern || (sharedPattern && validRegex(sharedPattern) ? sharedPattern : '');
  const suggested = suggestPlaybook(candidates, ctx.workspace, pattern);

  return {
    button: publicButton(button),
    lookingFor: `No Logic App ${describeMatch(button.match)} was found in this workspace's ${button.scope === 'subscription' ? 'subscription' : 'resource group'}.`,
    workspace: ctx.workspace,
    tenantId: subscription?.tenantId || null,
    incident: {
      number: incident?.properties?.incidentNumber ?? null,
      title: incident?.properties?.title || '',
      severity: incident?.properties?.severity || '',
      status: incident?.properties?.status || ''
    },
    candidates,
    suggestedId: suggested?.id || null
  };
}

async function playbookRun({ token, auxHeader, incidentArmId, logicAppsResourceId, tenantId, buttonId }) {
  const { button } = await findPlaybookButton(buttonId);
  const ctx = parseIncidentArmId(incidentArmId);
  const wf = PB_WORKFLOW_ID_RE.exec(logicAppsResourceId || '');
  if (!wf || !matchPlaybook(wf[3], button.match)) {
    throw new Error(`Refusing to run: not a "${button.label}" playbook`);
  }
  // Only playbooks playbookResolve could have offered (incident's subscription, and resource group
  // unless the button is configured with "scope": "subscription").
  if (wf[1].toLowerCase() !== ctx.subId.toLowerCase()) {
    throw new Error('Refusing to run: playbook is outside the incident\'s subscription');
  }
  if (button.scope !== 'subscription' && wf[2].toLowerCase() !== ctx.rg.toLowerCase()) {
    throw new Error('Refusing to run: playbook is outside the incident\'s resource group');
  }
  if (tenantId != null && !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('Invalid tenant ID');
  const body = JSON.stringify({ logicAppsResourceId, tenantId });
  const auth = { token, auxHeader };
  const run = (apiVersion) => armJson(`${incidentArmId}/runPlaybook?api-version=${apiVersion}`, auth, { method: 'POST', body });
  try {
    await run(PB_RUN_PLAYBOOK_API);
  } catch (e) {
    // If ARM rejects the api-version it lists the supported ones; retry once with the newest.
    const listed = /api-versions? (?:are|is) '([^']+)'/i.exec(e.message || '');
    if (!listed) throw e;
    const newest = listed[1].split(',').map(s => s.trim()).filter(Boolean).sort().pop();
    if (!newest || newest === PB_RUN_PLAYBOOK_API) throw e;
    await run(newest);
  }
  return { ok: true };
}

// ---- Comments tab: comments + change history for the incident open in the sender's tab.
// The incident ID and ARM token always come from the portal's top frame (not from the
// requesting iframe), so a frame can only act on the incident the user is viewing.
const COMMENT_MAX_CHARS = 30000;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getTopIncidentContext(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'incident-context' }, { frameId: 0 }, (res) => {
      void chrome.runtime.lastError;
      resolve(res || null);
    });
  });
}

async function listComments(incidentArmId, auth) {
  const out = [];
  let next = `${incidentArmId}/comments?api-version=${PB_INCIDENT_API}`;
  for (let page = 0; next && page < 20; page++) {
    const data = await armJson(next, auth);
    if (Array.isArray(data?.value)) out.push(...data.value);
    next = data?.nextLink && data.nextLink.startsWith(ARM + '/') ? data.nextLink.slice(ARM.length) : null;
  }
  return out.map(c => ({
    id: c.name,
    time: c.properties?.createdTimeUtc || null,
    author: c.properties?.author?.name || c.properties?.author?.email || c.properties?.author?.userPrincipalName || 'Unknown',
    message: typeof c.properties?.message === 'string' ? c.properties.message : ''
  }));
}

// Log Analytics query through ARM so the portal's ARM token works. Best-effort: callers show
// "unavailable" with the reason instead of failing the whole tab.
async function workspaceQuery(ctx, auth, query) {
  const path = `/subscriptions/${ctx.subId}/resourceGroups/${encodeURIComponent(ctx.rg)}` +
    `/providers/Microsoft.OperationalInsights/workspaces/${encodeURIComponent(ctx.workspace)}/api/query?api-version=2017-01-01-preview`;
  try {
    const data = await armJson(path, auth, { method: 'POST', body: JSON.stringify({ query }) });
    const table = data?.tables?.[0];
    if (!table) return { rows: [] };
    const cols = table.columns.map(c => c.name || c.ColumnName);
    return { rows: table.rows.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]]))) };
  } catch (e) {
    return { unavailable: e.message || String(e) };
  }
}

// "Activities": change history from SecurityIncident (one row per incident update).
// The incident name is validated as a GUID before being placed in KQL (no injection).
function incidentHistory(ctx, auth) {
  if (!GUID_RE.test(ctx.incidentName)) return { unavailable: 'Unexpected incident ID format' };
  return workspaceQuery(ctx, auth, [
    'SecurityIncident',
    `| where IncidentName == '${ctx.incidentName}'`,
    '| where TimeGenerated > ago(365d)',
    '| project LastModifiedTime, ModifiedBy, Status, Severity, Owner, Classification, Labels, Title',
    '| order by LastModifiedTime asc',
    '| take 1000'
  ].join('\n'));
}

// "Automation health": automation rule / playbook runs for this incident from SentinelHealth
// (requires Sentinel health monitoring to be enabled on the workspace).
function automationHealth(ctx, auth) {
  if (!GUID_RE.test(ctx.incidentName)) return { unavailable: 'Unexpected incident ID format' };
  return workspaceQuery(ctx, auth, [
    'SentinelHealth',
    '| where TimeGenerated > ago(365d)',
    "| where SentinelResourceType in ('Automation rule', 'Playbook')",
    `| where tostring(ExtendedProperties) has '${ctx.incidentName}'`,
    '| project TimeGenerated, SentinelResourceType, SentinelResourceName, Status, Description, Reason',
    '| order by TimeGenerated asc',
    '| take 500'
  ].join('\n'));
}

async function handleIncidentOp(request, sender) {
  if (!sender.tab) throw new Error('No tab');
  const top = await getTopIncidentContext(sender.tab.id);
  if (!top?.incidentArmId) throw new Error('Not on an incident page');
  if (!top.token) throw new Error('SentiBuddy hasn\'t captured an Azure sign-in token yet; refresh the page');
  const id = top.incidentArmId;
  const ctx = parseIncidentArmId(id);
  // The frame tells us which incident it rendered; refuse if the user has since navigated away.
  if (request.incidentArmId && request.incidentArmId.toLowerCase() !== id.toLowerCase()) {
    throw new Error('The incident changed; reopen the Comments tab');
  }
  const auth = { token: top.token, auxHeader: top.auxHeader };

  switch (request.op) {
    case 'comments':
      return { comments: await listComments(id, auth) };
    case 'history':
      return await incidentHistory(ctx, auth);
    case 'automation':
      return await automationHealth(ctx, auth);
    case 'add-comment': {
      const message = request.message;
      if (typeof message !== 'string' || !message.trim()) throw new Error('Comment is empty');
      if (message.length > COMMENT_MAX_CHARS) throw new Error(`Comment exceeds ${COMMENT_MAX_CHARS} characters`);
      const data = await armJson(`${id}/comments/${crypto.randomUUID()}?api-version=${PB_INCIDENT_API}`, auth,
        { method: 'PUT', body: JSON.stringify({ properties: { message } }) });
      return { ok: true, id: data?.name || null };
    }
    default:
      throw new Error('Unknown operation');
  }
}

// Comment drafts live in session storage (memory only, cleared when the browser closes).
function handleDraft(request, sendResponse) {
  const key = `draft:${String(request.incidentArmId || '').toLowerCase()}`;
  if (!PB_INCIDENT_ID_RE.test(request.incidentArmId || '')) { sendResponse({ error: 'Bad incident' }); return; }
  if (request.op === 'get') {
    chrome.storage.session.get(key, (s) => sendResponse({ text: s[key] || '' }));
  } else if (typeof request.text === 'string' && request.text.length <= COMMENT_MAX_CHARS * 2) {
    if (request.text) chrome.storage.session.set({ [key]: request.text }, () => sendResponse({ ok: true }));
    else chrome.storage.session.remove(key, () => sendResponse({ ok: true }));
  } else {
    sendResponse({ error: 'Bad draft' });
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  switch(request.type) {
    case 'search-ip':
      handleAPIRequests(request, sendResponse).then(() => {
        //fetchVirusTotal(request, sendResponse); // Moved VirusTotal logic into a function
      }).catch(error => {
        sendResponse({ error: error.toString() });
      });
      return true;  // Must return true when async response is expected
    case 'search-hash':
      handleHashAPIRequests(request, sendResponse).then(() => {
        //fetchVirusTotal(request, sendResponse); // Moved VirusTotal logic into a function
      }).catch(error => {
        sendResponse({ error: error.toString() });
      });
      return true;  // Must return true when async response is expected
    case 'get-queue-state':
      sendResponse({ active: queueActive });
      return true;
    case 'set-queue-state':
        queueActive = request.active
        return true;
    case 'set-notifications':
      console.log('Handling set-notifications message');
    // Update the configuration in storage
      chrome.storage.local.set({ desktopNotifications: request.enabled }, () => {
        console.log('Notification settings updated: ' + request.enabled);
      });
      if (request.enabled) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: getSentiBuddyIconUrl(),
          title: 'Notifications Enabled',
          message: 'Notifications have been turned on.'
        }, (notificationId) => {
          console.log('Notification created with ID:', notificationId);
          sendResponse({ success: true });
        });
      } else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: getSentiBuddyIconUrl(),
          title: 'Notifications Disabled',
          message: 'Notifications have been turned off.'
        }, (notificationId) => {
          console.log('Notification created with ID:', notificationId);
          sendResponse({ success: true });
        });
      }
      return true;
    case 'notification':
      console.log(request.info);
      chrome.storage.local.get({ desktopNotifications: false }, (items) => {
        if (items.desktopNotifications) {
          const notId = 'notification' + Math.random();
          notificationTab[notId] = sender.tab.id;
          chrome.notifications.create(notId, {
            type: 'basic',
            iconUrl: getSentiBuddyIconUrl(),
            title: `${request.info.eventType} ${request.info.severity} ${request.info.client} Incident w/ ${request.info.numAlerts} Alert(s)`,
            message: `INC: ${request.info.incID} - ${request.info.title}`,
          });
        }
      });
      break;
    case 'contentScriptReady':
      contentScriptReady = true;
      break;
    case 'set-lastAlertData':
      lastAlertData = request.info;
      break;
    case 'lastAlertData':
      sendResponse({data: lastAlertData});
      break;
    case 'toggle-queue-filtering':
      queueActive = !queueActive;
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "toggle-queue-filtering" }, function (response) {
            if (chrome.runtime.lastError) {
              console.log("Error sending message:", chrome.runtime.lastError.message);
            } else {
              console.log("Toggle message sent successfully");
              queueActive = !queueActive;
            }
          });
        } else {
          console.log("No active tab found");
        }
      });
      sendResponse({ active: queueActive });
      break;
    case 'toggle-enhanced-queue':
      toggleEnhancedQueue().then((active) => sendResponse({ active }));
      return true;
    case 'listIncidentsAll':
      listIncidentsAll(request)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    case 'playbook-buttons':
      loadPlaybookConfig()
        .then((config) => sendResponse({ buttons: config.buttons.map(publicButton) }))
        .catch((e) => sendResponse({ buttons: [], error: e.message || String(e) }));
      return true;
    case 'tt-context':
      if (sender.tab && sender.frameId === 0) ttQueue(() => ttOnContext(sender.tab.id, request.ctx, request.active === true));
      return;
    case 'tt-remove-away':
      if (sender.tab && sender.frameId === 0 && typeof request.at === 'number') ttQueue(() => ttRemoveAway(request.at));
      return;
    case 'tt-reset':
      // From the popup (an extension page, so no sender.tab).
      if (!sender.tab && sender.id === chrome.runtime.id) {
        ttQueue(ttReset).then(() => sendResponse({ ok: true }));
        return true;
      }
      return;
    case 'eq-notifier':
      sendResponse({ notifier: !!sender.tab && isNotifierTab(sender.tab.id) });
      return;
    case 'eq-notify':
      if (sender.tab && Array.isArray(request.records)) {
        const tabId = sender.tab.id;
        eqNotifyChain = eqNotifyChain.then(() => processEqNotifications(request.records, tabId)).catch((e) => {
          console.warn('SentiBuddy: Enhanced Queue notifications failed:', e);
        });
      }
      return;
    case 'documentation-lookup':
      findDocumentation(request.title)
        .then((url) => sendResponse({ url }))
        .catch((e) => sendResponse({ url: null, error: e.message || String(e) }));
      return true;
    case 'playbook-resolve':
      playbookResolve(request)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message || String(e) }));
      return true;
    case 'playbook-run':
      playbookRun(request)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message || String(e) }));
      return true;
    case 'incident-op':
      handleIncidentOp(request, sender)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message || String(e) }));
      return true;
    case 'comment-draft':
      handleDraft(request, sendResponse);
      return true;
    // Relay between the incident page's React iframe and the portal's top frame.
    // (incident-frame-query / incident-route are also used by the Comments tab.)
    case 'incident-frame-query':
    case 'playbook-frame-click':
      if (!sender.tab) return;
      chrome.tabs.sendMessage(sender.tab.id, { type: request.type, buttonId: request.buttonId }, { frameId: 0 }, (res) => {
        void chrome.runtime.lastError;
        sendResponse(res || null);
      });
      return true;
    case 'incident-route':
      if (!sender.tab) return;
      chrome.tabs.sendMessage(sender.tab.id, { type: 'incident-route', incidentArmId: request.incidentArmId,
        view: request.view === 'old' ? 'old' : request.view === 'new' ? 'new' : null }, () => {
        void chrome.runtime.lastError;
      });
      return;
    default:
      console.log(request)
      console.log('Unhandled message type:', request.type);
  }
  
});


function faviconURL(u) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", u);
  url.searchParams.set("size", "32");
  return url.toString();
}


async function toggleEnhancedQueue() {
  const { enhancedQueueEnabled } = await chrome.storage.local.get({ enhancedQueueEnabled: true });
  await chrome.storage.local.set({ enhancedQueueEnabled: !enhancedQueueEnabled });
  return !enhancedQueueEnabled;
}

chrome.commands.onCommand.addListener(function (command) {
  switch (command) {
    case 'toggle-enhanced-queue':
      toggleEnhancedQueue();
      break;
    case 'open-config':
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          window.open(chrome.runtime.getURL('options.html'));
        }
      break;
    case 'toggle-queue-filtering':
      console.log('Toggling queue filtering...');
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "toggle-queue-filtering" }, function (response) {
            if (chrome.runtime.lastError) {
              console.log("Error sending message:", chrome.runtime.lastError.message);
            } else {
              console.log("Toggle message sent successfully");
              queueActive = !queueActive;
            }
          });
        } else {
          console.log("No active tab found");
        }
      });
      break;  
  }
});

// Set desktop notifications to off on install or update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ desktopNotifications: false }, () => {
      console.log('Notification settings initialized to off');
    });
  }
});

chrome.notifications.onClicked.addListener(function callback(notificationId) {
  var updateProperties = { 'active': true };
  chrome.tabs.update(notificationTab[notificationId], updateProperties);
  chrome.notifications.clear(notificationId);
  window.focus();
});

// ---- Time tracking ------------------------------------------------------------------------------
// One tracker for the whole browser, so several portal tabs can never count the same time twice.
//
// Target: the portal context (workspace, plus incident if any) of the portal tab the user was most
// recently on; time-tracking/top.js reports each tab's context and when the user is on that tab.
// Switching to another portal tab switches the target. Leaving the portal (another site, another
// app, e.g. writing notes) keeps counting for the target unless "Auto-pause when I leave the portal
// tab" is on. Pause, idle (system-wide: no input for N minutes, or locked) and closing the target
// tab stop it. Opening the SentiBuddy menu doesn't count as leaving (only browser focus is checked).
//
// Counting is elapsed time, not a ticker: the running stretch ("since") is credited when anything
// changes and every minute (chrome.alarms), so it survives the service worker sleeping. If the
// minute alarm was missed (computer asleep), only one minute past the last checkpoint is credited.
//
// Stored in chrome.storage.local as timeTracking.days[YYYY-MM-DD][workspace][incidentId|_workspace]
// = { ms, n } (n = incident number, for display); nothing else about the incident. It survives
// browser restarts and is kept until the user presses Reset (popup) or the optional daily auto-reset
// time passes. The running stretch is timeTrackingCurrent (read by the page timer and the popup for
// live totals). When the user comes back to the tracked tab after more than a minute was counted
// while they were away, timeTrackingAwayNotice drives the page timer's "+time" (removable).
const TT_KEY = 'timeTracking';
const TT_CUR = 'timeTrackingCurrent';
const TT_NOTICE = 'timeTrackingAwayNotice';
const TT_ALARM = 'sb-time-tracking';
const TT_AWAY_NOTICE_MIN_MS = 60000; // "+time" notice only when more than this was counted away
let ttChain = Promise.resolve();
let ttIdleStartedAt = null; // when the current idle period began (credited time stops there)

const ttQueue = (fn) => { ttChain = ttChain.then(fn).catch((e) => console.warn('SentiBuddy: time tracking:', e)); return ttChain; };

function ttDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A workspace + incident id / "_workspace", or general portal time ("_portal" / "_general": any portal
// page without a single workspace, e.g. the multi-workspace queue).
function ttValidContext(ctx) {
  if (ctx && ctx.ws === '_portal') return ctx.id === '_general';
  return ctx && /^[a-z0-9][a-z0-9\-_.()]{0,89}$/.test(ctx.ws || '') && /^(_workspace|[a-z0-9-]{1,64})$/.test(ctx.id || '');
}

async function ttLoadData() {
  const { [TT_KEY]: saved } = await chrome.storage.local.get({ [TT_KEY]: null });
  return saved && typeof saved.days === 'object' ? saved : { days: {} };
}

// Credit [start, end) to a context, split at local midnights. Returns the ms credited.
// Tracked time is kept until the user resets it (popup) or the optional daily auto-reset runs.
async function ttCredit(ctx, start, end) {
  if (!(end > start)) return 0;
  const data = await ttLoadData();
  for (let t = start; t < end;) {
    const d = new Date(t);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const segEnd = Math.min(end, nextMidnight);
    const rec = ((data.days[ttDay(d)] ||= {})[ctx.ws] ||= {})[ctx.id] ||= { ms: 0, n: null };
    rec.ms += segEnd - t;
    if (/^\d{1,10}$/.test(String(ctx.n ?? ''))) rec.n = Number(ctx.n);
    t = segEnd;
  }
  await chrome.storage.local.set({ [TT_KEY]: data });
  return end - start;
}

// Take `ms` back from a context (newest day first): the "+time" notice's remove button.
async function ttUncredit(ctx, ms) {
  const data = await ttLoadData();
  let left = ms;
  for (const day of Object.keys(data.days).sort().reverse()) {
    const rec = data.days[day]?.[ctx.ws]?.[ctx.id];
    if (!rec || left <= 0) continue;
    const take = Math.min(rec.ms, left);
    rec.ms -= take;
    left -= take;
  }
  await chrome.storage.local.set({ [TT_KEY]: data });
}

// Credit the running stretch up to `now` (capped when checkpoints were missed / idle began).
// Returns the ms credited.
async function ttCommit(cur, now) {
  if (!cur?.since) return 0;
  let end = now;
  const last = cur.checkpoint || cur.since;
  if (end - last > 3 * 60000) end = last + 60000; // the minute alarm was missed: computer asleep / browser closed
  if (ttIdleStartedAt && ttIdleStartedAt < end) end = Math.max(cur.since, ttIdleStartedAt);
  return ttCredit(cur, cur.since, end);
}

// Close the running stretch; time counted while the user was away from the tracked tab is added up
// (awayMs) for the "+time" notice.
async function ttStop(cur, now) {
  const credited = await ttCommit(cur, now);
  return { ...cur, since: null, checkpoint: null, awayMs: cur.awayStart ? (cur.awayMs || 0) + credited : 0 };
}

async function ttTargetTabFocused(tabId) {
  try {
    const win = await chrome.windows.getLastFocused();
    if (!win?.focused) return false;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab?.id === tabId;
  } catch {
    return false;
  }
}

// Start/stop the running stretch to match the current conditions, and note when the user leaves
// and comes back to the tracked tab (opening the SentiBuddy menu doesn't count as leaving).
async function ttEvaluate() {
  const s = await chrome.storage.local.get({ timeTrackingEnabled: true, timeTrackingPaused: false, timeTrackingIdle: false,
    timeTrackingAutoPause: false, [TT_CUR]: null });
  let cur = s[TT_CUR];
  if (!cur) return;
  const before = JSON.stringify(cur);
  const now = Date.now();
  const onTab = await ttTargetTabFocused(cur.tabId);
  const counting = s.timeTrackingEnabled && !s.timeTrackingPaused && !s.timeTrackingIdle && (!s.timeTrackingAutoPause || onTab);
  const leaving = !onTab && !cur.awayStart;
  const returning = onTab && !!cur.awayStart;
  const updates = {};
  if (cur.since && (!counting || leaving || returning)) cur = await ttStop(cur, now);
  if (leaving) cur = { ...cur, awayStart: now, awayMs: 0 };
  if (returning) {
    if ((cur.awayMs || 0) > TT_AWAY_NOTICE_MIN_MS) {
      updates[TT_NOTICE] = { ws: cur.ws, id: cur.id, n: cur.n || null, ms: cur.awayMs, at: now };
    }
    cur = { ...cur, awayStart: null, awayMs: 0 };
  }
  if (counting && !cur.since) cur = { ...cur, since: now, checkpoint: now };
  if (JSON.stringify(cur) !== before || Object.keys(updates).length) {
    await chrome.storage.local.set({ [TT_CUR]: cur, ...updates });
  }
}

// Make `ctx` (from tab `tabId`) the target, or clear it (ctx null).
async function ttSetTarget(tabId, ctx) {
  const { [TT_CUR]: cur } = await chrome.storage.local.get({ [TT_CUR]: null });
  const same = cur && ctx && cur.tabId === tabId && cur.ws === ctx.ws && cur.id === ctx.id;
  if (same) {
    if (ctx.n && ctx.n !== cur.n) await chrome.storage.local.set({ [TT_CUR]: { ...cur, n: ctx.n } });
    return ttEvaluate();
  }
  if (cur?.since) await ttCommit(cur, Date.now());
  await chrome.storage.local.set({ [TT_CUR]: ctx ? { tabId, ws: ctx.ws, id: ctx.id, n: ctx.n || null, since: null, checkpoint: null } : null });
  return ttEvaluate();
}

// time-tracking/top.js: this tab's context changed, or the user is on this tab now ("active").
// Another tab's context only matters if it's the current target (e.g. it navigated).
async function ttOnContext(tabId, ctx, active) {
  const valid = ttValidContext(ctx) ? { ws: ctx.ws, id: ctx.id, n: /^\d{1,10}$/.test(String(ctx.n ?? '')) ? String(ctx.n) : null } : null;
  const { [TT_CUR]: cur } = await chrome.storage.local.get({ [TT_CUR]: null });
  if (active) {
    if (valid) return ttSetTarget(tabId, valid);
    // On a portal page with nothing to track: stop if this tab was the target.
    if (cur?.tabId === tabId) return ttSetTarget(tabId, null);
    return;
  }
  if (cur?.tabId === tabId) return ttSetTarget(tabId, valid);
}

// "+time" notice remove button: take back exactly what was counted while away.
async function ttRemoveAway(at) {
  const { [TT_NOTICE]: notice } = await chrome.storage.local.get({ [TT_NOTICE]: null });
  if (!notice || notice.at !== at || !ttValidContext(notice)) return;
  await ttUncredit(notice, notice.ms);
  await chrome.storage.local.remove(TT_NOTICE);
}

// Reset: drop all tracked time (a running stretch restarts from now).
async function ttReset() {
  const { [TT_CUR]: cur } = await chrome.storage.local.get({ [TT_CUR]: null });
  const now = Date.now();
  await chrome.storage.local.set({
    [TT_KEY]: { days: {} },
    timeTrackingEdits: {}, // the popup's per-day merges / hour edits / row order are relative to tracked time
    timeTrackingLastReset: now,
    ...(cur ? { [TT_CUR]: { ...cur, since: cur.since ? now : null, checkpoint: cur.since ? now : null, awayMs: 0,
      awayStart: cur.awayStart ? now : null } } : {})
  });
  await chrome.storage.local.remove(TT_NOTICE);
}

// Optional daily auto-reset at a local time ("HH:MM" from Options / the central config's
// timeTrackingAutoResetTime; empty = never, the default).
async function ttMaybeAutoReset() {
  const s = await chrome.storage.local.get({ timeTrackingAutoResetTime: '', timeTrackingLastReset: 0 });
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s.timeTrackingAutoResetTime || '').trim());
  if (!m) return;
  const now = new Date();
  const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]));
  if (boundary > now) boundary.setDate(boundary.getDate() - 1); // most recent reset time that has passed
  if (!s.timeTrackingLastReset) {
    await chrome.storage.local.set({ timeTrackingLastReset: Date.now() }); // first run: start counting from now
    return;
  }
  if (s.timeTrackingLastReset < boundary.getTime()) {
    const { [TT_CUR]: cur } = await chrome.storage.local.get({ [TT_CUR]: null });
    if (cur?.since) await ttCommit(cur, Date.now());
    await ttReset();
  }
}

// Every minute: credit the running stretch so stored totals stay current and missed minutes
// (sleep) are detectable; also runs the optional daily auto-reset.
async function ttCheckpoint() {
  await ttMaybeAutoReset();
  const { [TT_CUR]: cur } = await chrome.storage.local.get({ [TT_CUR]: null });
  if (!cur?.since) return ttEvaluate();
  const now = Date.now();
  const credited = await ttCommit(cur, now);
  const missed = now - (cur.checkpoint || cur.since) > 3 * 60000;
  await chrome.storage.local.set({ [TT_CUR]: { ...cur, since: now, checkpoint: now,
    awayMs: cur.awayStart ? (cur.awayMs || 0) + credited : 0 } });
  if (missed) await ttEvaluate();
}

chrome.alarms.create(TT_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === TT_ALARM) ttQueue(ttCheckpoint); });
chrome.windows.onFocusChanged.addListener(() => ttQueue(ttEvaluate));
chrome.tabs.onActivated.addListener(() => ttQueue(ttEvaluate));
chrome.tabs.onRemoved.addListener((tabId) => ttQueue(async () => {
  const { [TT_CUR]: cur } = await chrome.storage.local.get({ [TT_CUR]: null });
  if (cur?.tabId === tabId) await ttSetTarget(tabId, null);
}));
// Browser restart: tab ids from the last session are gone. Close the old stretch (credited up to
// a minute past its last checkpoint) and wait for the user to come back to a portal page.
chrome.runtime.onStartup.addListener(() => ttQueue(async () => {
  const { [TT_CUR]: cur } = await chrome.storage.local.get({ [TT_CUR]: null });
  if (cur?.since) await ttCommit(cur, Date.now());
  await chrome.storage.local.set({ [TT_CUR]: null });
  await chrome.storage.local.remove(TT_NOTICE);
}));

// Away detection (system-wide, so typing in another app counts as active). Time stops counting
// from when the idle period began, not from when it was detected.
function setupIdleDetection() {
  chrome.storage.local.get({ timeTrackingIdleMinutes: 5 }, (s) => {
    const minutes = Math.min(120, Math.max(1, Number(s.timeTrackingIdleMinutes) || 5));
    chrome.idle.setDetectionInterval(minutes * 60);
    chrome.idle.queryState(minutes * 60, (state) => chrome.storage.local.set({ timeTrackingIdle: state !== 'active' }));
  });
}
chrome.idle.onStateChanged.addListener((state) => {
  chrome.storage.local.get({ timeTrackingIdleMinutes: 5 }, (s) => {
    const minutes = Math.min(120, Math.max(1, Number(s.timeTrackingIdleMinutes) || 5));
    ttIdleStartedAt = state === 'idle' ? Date.now() - minutes * 60000 : state === 'locked' ? Date.now() : null;
    chrome.storage.local.set({ timeTrackingIdle: state !== 'active' });
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.timeTrackingIdleMinutes) setupIdleDetection();
  // A newly set / changed auto-reset time starts from now (no immediate reset for past boundaries).
  if (changes.timeTrackingAutoResetTime) chrome.storage.local.set({ timeTrackingLastReset: Date.now() });
  if (['timeTrackingEnabled', 'timeTrackingPaused', 'timeTrackingIdle', 'timeTrackingAutoPause'].some(k => k in changes)) {
    ttQueue(async () => {
      await ttEvaluate();
      if (changes.timeTrackingIdle && !changes.timeTrackingIdle.newValue) ttIdleStartedAt = null;
    });
  }
});
setupIdleDetection();

// ---- Enhanced Queue desktop notifications ---------------------------------------------------
// Every portal tab with the Enhanced Queue sends its filtered incidents after each fetch; this
// decides what's actually new or changed. State lives in chrome.storage.session (shared by all tabs,
// survives the worker going night night, cleared when the browser goes bye bye)
// Keys stored as sha256
const EQ_NOTIFY_KEY = 'eqNotifyState';
const EQ_NEW_SLACK_MS = 10 * 60 * 1000; // ingestion delay allowed for "New" after a workspace is first seen
const EQ_MAX_TRACKED = 5000;
const EQ_SEVERITIES = new Set(['High', 'Medium', 'Low', 'Informational']);
const EQ_STATUSES = new Set(['New', 'Active', 'Closed']);
let eqNotifyChain = Promise.resolve();

async function eqHash(salt, value) {
  const bytes = new TextEncoder().encode(`${salt}|${value}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
}

async function processEqNotifications(records, tabId) {
  const store = await chrome.storage.local.get({ desktopNotifications: true, onlyAlertOnLatest: false });
  const { [EQ_NOTIFY_KEY]: saved } = await chrome.storage.session.get({ [EQ_NOTIFY_KEY]: null });
  const state = saved && typeof saved === 'object' && typeof saved.salt === 'string'
    ? saved
    : { salt: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''),
      workspaces: {}, incidents: {} };
  const now = Date.now();
  const hashed = await Promise.all(records.filter(r => r && typeof r.key === 'string').map(async r => ({
    r,
    id: await eqHash(state.salt, `i:${r.key}`),
    ws: await eqHash(state.salt, `w:${r.ws}`),
    // "Unassigned" stays a plain marker: change notifications only apply to incidents that had an owner.
    owner: r.owner === 'Unassigned' ? 'u' : await eqHash(state.salt, `o:${r.owner}`)
  })));

  // A workspace seen for the first time is seeded silently (its existing incidents aren't "new").
  const firstSeen = new Set(hashed.map(h => h.ws).filter(ws => !state.workspaces[ws]));
  firstSeen.forEach(ws => { state.workspaces[ws] = now; });

  const events = [];
  for (const { r, id, ws, owner } of hashed) {
    const prev = state.incidents[id];
    // Tabs can finish fetches out of order; never let an older snapshot overwrite a newer one.
    if (prev && r.modified && prev.m && r.modified < prev.m) continue;
    const severity = EQ_SEVERITIES.has(r.severity) ? r.severity : '';
    const status = EQ_STATUSES.has(r.status) ? r.status : '';
    if (!prev) {
      // New only if created after we started watching its workspace (so widening the portal's time
      // range or a newly discovered workspace doesn't replay old incidents).
      if (!firstSeen.has(ws) && r.created >= (state.workspaces[ws] || now) - EQ_NEW_SLACK_MS) {
        events.push({ type: 'New', r });
      }
    } else if (prev.o !== 'u') {
      // Same rules as the native-grid notifications: changes on incidents that already had an owner.
      if (prev.o !== owner) events.push({ type: `${r.owner} claimed`, r });
      else if (prev.v !== severity) events.push({ type: `${prev.v || 'Severity'} -->`, r });
      else if (prev.t !== status) events.push({ type: 'Updated', r });
    }
    state.incidents[id] = { o: owner, v: severity, t: status, m: r.modified || 0, s: now };
  }

  // Keep the tracked set bounded (oldest-seen first out).
  const keys = Object.keys(state.incidents);
  if (keys.length > EQ_MAX_TRACKED) {
    keys.sort((a, b) => state.incidents[a].s - state.incidents[b].s)
      .slice(0, keys.length - EQ_MAX_TRACKED)
      .forEach(k => delete state.incidents[k]);
  }
  await chrome.storage.session.set({ [EQ_NOTIFY_KEY]: state });

  if (!store.desktopNotifications || !events.length) return;
  events.sort((a, b) => b.r.created - a.r.created);
  for (const e of store.onlyAlertOnLatest ? events.slice(0, 1) : events) {
    const notId = 'notification' + Math.random();
    notificationTab[notId] = tabId;
    chrome.notifications.create(notId, {
      type: 'basic',
      iconUrl: getSentiBuddyIconUrl(),
      title: `${e.type} ${e.r.severity} ${e.r.client} Incident w/ ${e.r.alerts || 0} Alert(s)`,
      message: `INC: ${e.r.number} - ${e.r.title}`
    });
  }
}

// Background refreshing for notifications: of the portal tabs asking (hidden ones), only the lowest
// tab id that asked recently keeps polling, so alerts still arrive without every tab fetching.
const eqNotifierTabs = new Map(); // tabId -> last asked
function isNotifierTab(tabId) {
  const now = Date.now();
  eqNotifierTabs.set(tabId, now);
  for (const [id, at] of eqNotifierTabs) if (now - at > 20000) eqNotifierTabs.delete(id);
  return Math.min(...eqNotifierTabs.keys()) === tabId;
}
chrome.tabs.onRemoved.addListener((tabId) => eqNotifierTabs.delete(tabId));

// Renewed ARM tokens. The portal renews its sign-in token before it expires, but most of its ARM
// calls come from its React iframes, which the top-page hook (enhanced-queue/injected.js) can't
// see, so SentiBuddy kept the old token until it expired. This observes those requests
// and hands a changed token to the tab's top frame, where
// enhanced-queue/content.js keeps whichever token expires last.
// Only requests made by the Azure portal itself count: the request must come from portal.azure.com
// or one of its React view frames, and the tab must be on portal.azure.com. ARM calls made by any
// other site or tab are ignored entirely.
const PORTAL_INITIATOR_RE = /^https:\/\/(portal\.azure\.com|[a-z0-9-]+\.reactblade\.portal\.azure\.net)$/i;
const lastArmTokenByTab = new Map();
chrome.webRequest.onSendHeaders.addListener((details) => {
  if (details.tabId < 0 || !PORTAL_INITIATOR_RE.test(details.initiator || '')) return;
  let token = null;
  let aux = null;
  for (const h of details.requestHeaders || []) {
    const name = h.name.toLowerCase();
    if (name === 'authorization') token = h.value;
    else if (name === 'x-ms-authorization-auxiliary') aux = h.value;
  }
  if (!/^Bearer [A-Za-z0-9\-_.]+$/.test(token || '') || lastArmTokenByTab.get(details.tabId) === token) return;
  chrome.tabs.get(details.tabId, (tab) => {
    if (chrome.runtime.lastError || !/^https:\/\/portal\.azure\.com\//i.test(tab?.url || '')) return;
    lastArmTokenByTab.set(details.tabId, token);
    chrome.tabs.sendMessage(details.tabId, { type: 'arm-token', token, auxHeader: aux }, { frameId: 0 },
      () => void chrome.runtime.lastError);
  });
}, { urls: ['https://management.azure.com/*'], types: ['xmlhttprequest'] }, ['requestHeaders']);
chrome.tabs.onRemoved.addListener((tabId) => lastArmTokenByTab.delete(tabId));

// chrome.webRequest.onBeforeRequest.addListener(
//   function(details) {
//     console.log(details)
//     return {cancel: details.url.indexOf("://www.evil.com/") != -1};
//   },
//   {urls: ["<all_urls>"]},
//   ["blocking"]
// );