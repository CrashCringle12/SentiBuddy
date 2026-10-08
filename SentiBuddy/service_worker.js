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

// ---- Playbook buttons (Escalate, Tuning, ...): resolve the client's playbook and run it on an incident
const ARM = 'https://management.azure.com';
const ESC_INCIDENT_API = '2023-11-01';
const ESC_RUN_PLAYBOOK_API = '2024-01-01-preview';
// Segments exclude ? # % and whitespace so an ID (which can come from a crafted portal link)
// can't add query strings, fragments or encoded traversal to the ARM request path.
const ESC_SEG = "[^/?#%\\s]+";
const ESC_INCIDENT_ID_RE = new RegExp(`^/subscriptions/([0-9a-f-]{36})/resourceGroups/(${ESC_SEG})/providers/Microsoft\\.OperationalInsights/workspaces/(${ESC_SEG})/providers/Microsoft\\.SecurityInsights/incidents/(${ESC_SEG})$`, 'i');
const ESC_WORKFLOW_ID_RE = new RegExp(`^/subscriptions/([0-9a-f-]{36})/resourceGroups/(${ESC_SEG})/providers/Microsoft\\.Logic/workflows/(${ESC_SEG})$`, 'i');
// Buttons come from "playbooks" in the master config (configDataURL); see Playbook-Buttons.md.
// The config is remote input, so every field is validated and length-capped, and a button can
// only run Logic Apps that match its own matcher inside the incident's subscription/resource group.
const PLAYBOOK_CACHE_KEY = 'playbookConfigCache';
const PLAYBOOK_CACHE_MS = 30 * 60 * 1000;
const PLAYBOOK_MAX_BUTTONS = 20;
// Used when the master config has no "playbooks" section.
const DEFAULT_PLAYBOOKS = {
  workspaceClientPattern: '^xdrworkspace-([a-z][a-z0-9]*?)\\d*$',
  buttons: [
    { id: 'escalate', label: 'Escalate', color: '#c50f1f', icon: '⚠',
      description: 'Run this client\'s escalate-to-client playbook (asks for confirmation)',
      match: { suffix: '-escalate-to-client', versioned: true },
      confirm: { title: 'Escalate to client', question: 'Are you sure you want to escalate this incident? This will run:', button: 'Yes, escalate' } },
    { id: 'tuning', label: 'Tuning', color: '#107c10', icon: '🔧',
      description: 'Run this client\'s tuning-candidate-request playbook (asks for confirmation)',
      match: { suffix: '-tuning-candidate-request-playbook', versioned: true },
      confirm: { title: 'Request tuning', question: 'Submit this incident as a tuning candidate? This will run:', button: 'Yes, request tuning' } }
  ]
};
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
  // "-escalate-to-client-v" + versioned: the version is matched separately, so drop the "-v".
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

// Master config is fetched over https and cached for 30 minutes; on a failed fetch the last good
// copy for the same URL keeps working.
async function loadPlaybookConfig() {
  const store = await chrome.storage.local.get({ configDataURL: '', [PLAYBOOK_CACHE_KEY]: null });
  const url = String(store.configDataURL || '').trim();
  const cache = store[PLAYBOOK_CACHE_KEY];
  if (cache?.url === url && Date.now() - cache.at < PLAYBOOK_CACHE_MS) return cache.config;

  let raw = null;
  if (/^https:\/\//i.test(url)) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = (await res.json())?.playbooks ?? null;
    } catch (e) {
      console.warn('SentiBuddy: playbook config fetch failed:', e);
      return cache?.url === url ? cache.config : normalizePlaybookConfig(null);
    }
  }
  const config = normalizePlaybookConfig(raw);
  await chrome.storage.local.set({ [PLAYBOOK_CACHE_KEY]: { url, at: Date.now(), config } });
  return config;
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
// e.g. "(dev)-escalate-to-client-v4" with suffix "-escalate-to-client" → client "dev", version 4.
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
  const m = ESC_INCIDENT_ID_RE.exec(incidentArmId || '');
  if (!m) throw new Error('Not a Sentinel incident resource ID');
  return { subId: m[1], rg: m[2], workspace: m[3], incidentName: m[4] };
}

// Pick the playbook whose client code matches the workspace. workspaceClientPattern (from the
// config) extracts the code first, e.g. xdrworkspace-dev4 → "dev"; then name segments, then substrings.
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
    armJson(`${incidentArmId}?api-version=${ESC_INCIDENT_API}`, auth),
    armJson(`/subscriptions/${ctx.subId}?api-version=2022-12-01`, auth),
    listWorkflows(ctx, auth, button.scope)
  ]);

  // Keep only the newest version per client.
  const byClient = new Map();
  for (const wf of workflows) {
    const m = matchPlaybook(wf.name, button.match);
    if (!m || !ESC_WORKFLOW_ID_RE.test(wf.id || '')) continue;
    const cand = { name: wf.name, id: wf.id, client: m.client, version: m.version };
    const cur = byClient.get(cand.client);
    if (!cur || cand.version > cur.version) byClient.set(cand.client, cand);
  }
  const candidates = [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name));
  const suggested = suggestPlaybook(candidates, ctx.workspace, config.workspaceClientPattern);

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
  const wf = ESC_WORKFLOW_ID_RE.exec(logicAppsResourceId || '');
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
    await run(ESC_RUN_PLAYBOOK_API);
  } catch (e) {
    // If ARM rejects the api-version it lists the supported ones; retry once with the newest.
    const listed = /api-versions? (?:are|is) '([^']+)'/i.exec(e.message || '');
    if (!listed) throw e;
    const newest = listed[1].split(',').map(s => s.trim()).filter(Boolean).sort().pop();
    if (!newest || newest === ESC_RUN_PLAYBOOK_API) throw e;
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
  let next = `${incidentArmId}/comments?api-version=${ESC_INCIDENT_API}`;
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
      const data = await armJson(`${id}/comments/${crypto.randomUUID()}?api-version=${ESC_INCIDENT_API}`, auth,
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
  if (!ESC_INCIDENT_ID_RE.test(request.incidentArmId || '')) { sendResponse({ error: 'Bad incident' }); return; }
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
    // (escalate-frame-query / escalate-route are also used by the Comments tab.)
    case 'escalate-frame-query':
    case 'playbook-frame-click':
      if (!sender.tab) return;
      chrome.tabs.sendMessage(sender.tab.id, { type: request.type, buttonId: request.buttonId }, { frameId: 0 }, (res) => {
        void chrome.runtime.lastError;
        sendResponse(res || null);
      });
      return true;
    case 'escalate-route':
      if (!sender.tab) return;
      chrome.tabs.sendMessage(sender.tab.id, { type: 'escalate-route', incidentArmId: request.incidentArmId }, () => {
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
  const { enhancedQueueEnabled } = await chrome.storage.local.get({ enhancedQueueEnabled: false });
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

// chrome.webRequest.onBeforeSendHeaders.addListener(
//   function(details) {
//       console.log(details)
//     if (details.url.contains("top=50")) {
//       let url = details.url
//       console.log(details)
//       console.log(url)
//       console.log(details)
//       return {redirectUrl: url};
//     }
//     console.log(details)
//     return {};
//   },
//   {urls: ["*://management.azure.com/*"]},
//   ["requestHeaders", "extraHeaders"]
// );

// chrome.webRequest.onBeforeRequest.addListener(
//   function(details) {
//     console.log(details)
//     return {cancel: details.url.indexOf("://www.evil.com/") != -1};
//   },
//   {urls: ["<all_urls>"]},
//   ["blocking"]
// );