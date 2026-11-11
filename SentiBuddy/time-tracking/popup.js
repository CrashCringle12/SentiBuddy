// Time tab of the popup: hours per client (a group of workspaces) for a day as tracked by
// SentiBuddy, side by side with the organisation's metrics endpoint (e.g. a Logic App running the
// timesheet query), pause/resume, the time-entry button and a CSV export using either source or
// their average.
//
// SentiBuddy's hours come from time-tracking/top.js via the service worker (storage key
// timeTracking: days → workspace → incident id | "_workspace" → { ms, n }). Per-incident detail is
// collected but only shown behind the "Per-incident detail (preview)" toggle while it's validated.
//
// The Time tab is an experimental feature: it (and every request to the metrics endpoint) only runs
// with "Show experimental features" on. Time is recorded in the background either way.
//
// Everything organisation-specific comes from the central config, so nothing about one company's
// setup is hardcoded. Workspace names map to clients with the top-level "workspaceClientPattern"
// (stored by the options page); the rest comes from "timeTracking" (passed in by popup.js):
//   "timeTracking": {
//     "metricsEndpoint": "https://…",   // POSTed { email, date, timezone }; defaults to the top-level incidentLookbackEndpoint
//     "codeLabel": "Project Code",      // what the time-entry codes are called (column, prompts, CSV header)
//     "clients": [{ "client": "ACME1", "code": "PRJ-1001-01", "workspaces": ["…"], "adxClusters": ["…"] }],  // or { "ACME1": "PRJ-…" }
//     "general": { "client": "GENERAL", "code": "…", "task": "…" },  // general portal time row (optional)
//     "defaults": { "code": "N/A", "task": "… ({shift})", "location": "", "description": "…",
//                   "reviewAboveHours": 4, "reviewCode": "PLEASE-REVIEW" },
//     "csv": { "columns": [{ "header": "Work Date", "value": "{date}" }, …], "dateFormat": "MM/DD/YYYY",
//              "hoursDecimals": 3, "fileName": "TimeEntry-{monthName} {dd}.csv" }
//   }
// Codes from the metrics endpoint's response take precedence over the config's.
(() => {
  // ---------- DEBUG (local testing only; keep these off / empty in anything you ship)
  const DEBUG = {
    bypassMetricsCooldown: false, // true: no 30-minute Refresh limit, and codes refetch on every popup open
    metricsEmail: '' // e.g. 'first.last@company.com': sent to the metrics endpoint instead of your portal email
  };

  const defaultColumns = (codeLabel) => [
    { header: 'Work Date', value: '{date}' },
    { header: 'Client', value: '{client}' },
    { header: codeLabel, value: '{code}' },
    { header: 'Location', value: '{location}' },
    { header: 'Task', value: '{task}' },
    { header: 'Hours', value: '{hours}' },
    { header: 'Description', value: '{description}' },
    { header: 'Handy Info', value: '{client} - {hours}hrs' }
  ];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];
  const WORKSPACE_ONLY = '_workspace';
  // General portal time (any portal page without a single workspace), from time-tracking/top.js.
  const GENERAL_WS = '_portal';
  const GENERAL_ID = '_general';
  // Azure Data Explorer cluster pages, tracked as "adx.<cluster>" (time-tracking/top.js).
  const ADX_PREFIX = 'adx.';
  const METRICS_AUTO_MS = 4 * 60 * 60 * 1000; // background metrics run while the Time page is open
  const METRICS_COOLDOWN_MS = 30 * 60 * 1000; // manual Compare / Refresh
  const METRICS_RETRY_MS = 5 * 60 * 1000; // manual, after a failed run

  let config = normalizeConfig(null);
  let tracked = { days: {} };
  let prefs = { enabled: false, experimental: false, paused: false, idle: false, timeEntryTitle: 'Time entry', timeEntryLink: '' };
  let workspacePattern = null; // RegExp from the top-level workspaceClientPattern setting
  const metrics = {}; // day → { status: 'loading' | 'ok' | 'error', data, error }
  const expandedClients = new Set();
  let showIncidents = localStorage.getItem('ttShowIncidents') === '1';
  let exportSource = localStorage.getItem('ttExportSource') || 'sentibuddy';
  let codeOverrides = {}; // CLIENT → code the user set in the popup (timeTrackingCodeOverrides)
  let current = null; // the service worker's running stretch (timeTrackingCurrent), for live totals
  const $ = (id) => document.getElementById(id);

  // ---------- Config (remote input: validated and length-capped)
  // Function declarations (not const arrows): normalizeConfig runs above, before this point.
  function text(v, max) {
    return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
  }
  function httpsUrl(v) {
    try { return new URL(v).protocol === 'https:' ? new URL(v).href : ''; } catch { return ''; }
  }
  function validRegex(src) {
    try { new RegExp(src, 'i'); return true; } catch { return false; }
  }
  function normalizeConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const d = src.defaults && typeof src.defaults === 'object' ? src.defaults : {};
    const defaults = {
      code: text(d.code, 80), // used for clients with no code from any source, if set
      task: text(d.task, 200),
      location: text(d.location, 80),
      description: text(d.description, 300)
    };
    const review = Number(d.reviewAboveHours);
    const clients = new Map(); // CLIENT → { code, task, location, description }
    const workspaces = new Map(); // workspace (lower case) → CLIENT
    const entries = Array.isArray(src.clients)
      ? src.clients.map(c => [c?.client, c])
      : src.clients && typeof src.clients === 'object' ? Object.entries(src.clients) : [];
    for (const [name, value] of entries.slice(0, 1000)) {
      const client = text(name, 40).trim().toUpperCase();
      if (!client) continue;
      const v = typeof value === 'string' ? { code: value } : value && typeof value === 'object' ? value : {};
      clients.set(client, {
        code: text(v.code, 80),
        task: text(v.task, 200),
        location: text(v.location, 80),
        description: text(v.description, 300)
      });
      if (Array.isArray(v.workspaces)) v.workspaces.forEach(ws => { if (typeof ws === 'string') workspaces.set(ws.toLowerCase(), client); });
      if (Array.isArray(v.adxClusters)) v.adxClusters.forEach(c => { if (typeof c === 'string') workspaces.set(`${ADX_PREFIX}${c.toLowerCase()}`, client); });
    }
    // General portal time (no single workspace): its own row, named "GENERAL" unless the config says
    // otherwise, with optional code / task / location / description like any client.
    const g = src.general && typeof src.general === 'object' ? src.general : {};
    const generalClient = text(g.client, 40).trim().toUpperCase() || 'GENERAL';
    const gInfo = { code: text(g.code, 80), task: text(g.task, 200),
      location: text(g.location, 80), description: text(g.description, 300) };
    const base = clients.get(generalClient) || { code: '', task: '', location: '', description: '' };
    clients.set(generalClient, Object.fromEntries(Object.entries(base).map(([k, v]) => [k, gInfo[k] || v])));
    const csvRaw = src.csv && typeof src.csv === 'object' ? src.csv : {};
    const columns = Array.isArray(csvRaw.columns)
      ? csvRaw.columns.filter(c => c && typeof c.header === 'string' && typeof c.value === 'string')
        .map(c => ({ header: text(c.header, 80), value: text(c.value, 300) })).slice(0, 40)
      : [];
    const codeLabel = text(src.codeLabel, 40).trim() || 'Code';
    return {
      metricsEndpoint: httpsUrl(src.metricsEndpoint),
      codeLabel,
      clients,
      workspaces,
      generalClient,
      defaults,
      reviewAboveHours: Number.isFinite(review) && review > 0 ? review : null,
      reviewCode: text(d.reviewCode, 80) || 'PLEASE-REVIEW',
      // Placeholder when no code can be found (and no defaults.code): easy to spot and
      // replace in the popup (click it) or in the CSV.
      missingCode: text(d.missingCode, 80) || 'MISSING-CODE',
      columns: columns.length ? columns : defaultColumns(codeLabel),
      dateFormat: text(csvRaw.dateFormat, 20) || 'MM/DD/YYYY',
      hoursDecimals: Number.isInteger(csvRaw.hoursDecimals) ? Math.min(6, Math.max(0, csvRaw.hoursDecimals)) : 3,
      fileName: text(csvRaw.fileName, 120) || 'TimeEntry-{monthName} {dd}.csv'
    };
  }

  // Workspace → client mappings from metrics responses ("workspaces"), for workspaces that don't
  // follow the naming pattern. Kept for the popup's lifetime and used for every day shown.
  const metricsWorkspaces = new Map();

  // Workspace → client from the central config's Development table (tableData.devData), when its rows
  // have both fields: { "client": "HOOLI5 - Hooli", "sentinelName": "soc-hooli5" } → soc-hooli5 = HOOLI5.
  // Optional: organisations without that table just skip this source.
  const devDataWorkspaces = new Map();
  function loadDevDataWorkspaces(master) {
    devDataWorkspaces.clear();
    const rows = master?.tableData?.devData;
    for (const row of Array.isArray(rows) ? rows.slice(0, 5000) : []) {
      const ws = text(String(row?.sentinelName ?? row?.workspace ?? ''), 90).trim().toLowerCase();
      const client = /^\s*([A-Za-z0-9]{1,40})/.exec(text(String(row?.client ?? ''), 200))?.[1];
      if (ws && client) devDataWorkspaces.set(ws, client.toUpperCase());
    }
  }

  // Workspace → client: metrics endpoint mapping, then the Development table (devData), then config
  // "workspaces", then workspaceClientPattern, else the workspace name itself.
  function clientFor(ws) {
    if (ws === GENERAL_WS) return config.generalClient;
    const fromMetrics = metricsWorkspaces.get(ws);
    if (fromMetrics) return fromMetrics;
    const fromDevData = devDataWorkspaces.get(ws);
    if (fromDevData) return fromDevData;
    const explicit = config.workspaces.get(ws);
    if (explicit) return explicit;
    // An unmapped cluster gets its own row (drag it onto the right client, or map it in the config).
    if (ws.startsWith(ADX_PREFIX)) return `ADX ${ws.slice(ADX_PREFIX.length).toUpperCase()}`;
    if (workspacePattern) {
      const m = workspacePattern.exec(ws);
      const code = m?.groups?.client ?? m?.[1];
      if (code) return code.toUpperCase();
    }
    return ws.toUpperCase();
  }

  // ---------- SentiBuddy's tracked time
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Stored time for a day, plus (for today) the service worker's running, not-yet-credited stretch.
  function dayData(day) {
    const data = { ...(tracked.days?.[day] || {}) };
    if (current?.since && day === dayKey(new Date())) {
      const live = Math.max(0, Date.now() - current.since);
      const ws = { ...(data[current.ws] || {}) };
      const rec = ws[current.id] || { ms: 0, n: current.n ?? null };
      ws[current.id] = { ...rec, ms: (Number(rec.ms) || 0) + live, n: rec.n ?? current.n ?? null };
      data[current.ws] = ws;
    }
    return data;
  }

  // CLIENT → { ms, workspaces:Set, incidents: Map(key → { n, ms }) } for a day.
  function trackedByClient(day) {
    const byClient = new Map();
    for (const [ws, incidents] of Object.entries(dayData(day))) {
      const client = clientFor(ws);
      const row = byClient.get(client) || { ms: 0, workspaces: new Set(), incidents: new Map() };
      row.workspaces.add(ws);
      for (const [id, rec] of Object.entries(incidents || {})) {
        const ms = Number(rec?.ms) || 0;
        row.ms += ms;
        const key = id === WORKSPACE_ONLY ? WORKSPACE_ONLY : rec?.n ? `#${rec.n}` : id;
        const cur = row.incidents.get(key) || { n: id === WORKSPACE_ONLY ? null : rec?.n ?? null, ms: 0 };
        cur.ms += ms;
        row.incidents.set(key, cur);
      }
      byClient.set(client, row);
    }
    return byClient;
  }

  // ---------- Metrics endpoint
  // Field access that tolerates casing differences (Client / client / CLIENT).
  function pick(obj, ...names) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const name of names) {
      const key = Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase());
      if (key !== undefined && obj[key] != null) return obj[key];
    }
    return undefined;
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  // Accepts the documented shape ({ clients: [...], codes, shift }) and the old daily
  // timesheet query's shape ({ UserStats: { Stats: [...], Shift } }, optionally inside value[]).
  function normalizeMetrics(payload) {
    let src = payload;
    if (Array.isArray(pick(src, 'value'))) src = pick(src, 'value')[0] || {};
    const userStats = pick(src, 'UserStats');
    if (userStats) src = { clients: pick(userStats, 'Stats'), shift: pick(userStats, 'Shift') };
    const rows = pick(src, 'clients', 'stats');
    const clients = new Map();
    for (const r of Array.isArray(rows) ? rows.slice(0, 2000) : []) {
      const client = text(String(pick(r, 'client') ?? ''), 40).trim().toUpperCase();
      if (!client) continue;
      const incidents = new Map();
      for (const i of Array.isArray(pick(r, 'incidents', 'TimeSpentPerIncident')) ? pick(r, 'incidents', 'TimeSpentPerIncident') : []) {
        const n = num(pick(i, 'incident', 'incidentNumber'));
        const hours = num(pick(i, 'hours'));
        if (n != null && hours != null) incidents.set(`#${n}`, { n, hours: (incidents.get(`#${n}`)?.hours || 0) + hours });
      }
      const prev = clients.get(client);
      clients.set(client, {
        hours: (prev?.hours || 0) + (num(pick(r, 'hours', 'TotalTimePerDay')) || 0),
        averageHours: num(pick(r, 'averageHours', 'AverageTimePerDay')),
        code: text(String(pick(r, 'code') ?? ''), 80) || prev?.code || '',
        incidents: prev ? new Map([...prev.incidents, ...incidents]) : incidents
      });
    }
    const codes = new Map();
    const codesRaw = pick(src, 'codes');
    const codeEntries = Array.isArray(codesRaw)
      ? codesRaw.map(c => [pick(c, 'client'), pick(c, 'code')])
      : codesRaw && typeof codesRaw === 'object' ? Object.entries(codesRaw) : [];
    for (const [client, code] of codeEntries.slice(0, 2000)) {
      const c = text(String(client ?? ''), 40).trim().toUpperCase();
      const v = text(String(code ?? ''), 80);
      if (c && v) codes.set(c, v);
    }
    // { "<workspace>": "<CLIENT>" } or [{ "workspace": "…", "client": "…" }]
    const wsRaw = pick(src, 'workspaces');
    const wsEntries = Array.isArray(wsRaw)
      ? wsRaw.map(w => [pick(w, 'workspace', 'workspaceName'), pick(w, 'client')])
      : wsRaw && typeof wsRaw === 'object' ? Object.entries(wsRaw) : [];
    // A cluster listed for more than one client is shared, so it can't tell the client: left unmapped.
    const seen = new Map();
    for (const [ws, client] of wsEntries.slice(0, 2000)) {
      const w = text(String(ws ?? ''), 90).trim().toLowerCase();
      const c = text(String(client ?? ''), 40).trim().toUpperCase();
      if (!w || !c || w === ADX_PREFIX) continue;
      seen.set(w, seen.has(w) && seen.get(w) !== c ? null : c);
    }
    seen.forEach((c, w) => { if (c) metricsWorkspaces.set(w, c); else metricsWorkspaces.delete(w); });
    return { clients, codes, shift: text(String(pick(src, 'shift') ?? ''), 40) };
  }

  // The user's email comes from the portal (popup.js fills #lookbackEmail when the tab opens).
  async function portalEmail() {
    for (let i = 0; i < 20; i++) {
      const v = ($('lookbackEmail')?.value || '').trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
      await new Promise(r => setTimeout(r, 500));
    }
    return '';
  }

  // Two kinds of request to the metrics endpoint, both only while the Time page is open:
  //   - codes only (fast): at most one attempt per day, so tracked hours can be matched to codes
  //   - full metrics (the expensive live query): in the background every METRICS_AUTO_MS, and on Compare /
  //     Refresh at most once per METRICS_COOLDOWN_MS. A failed run is not retried automatically.
  // Full results stay hidden until the user presses Compare (metrics[day].shown).
  let lastRun = { at: 0, ok: true }; // last full metrics run, auto or manual (timeTrackingMetricsLastRun)
  // Client → time-entry code. Not incident data. Codes from a full metrics run overwrite these.
  let codesStore = { attemptDay: '', at: 0, codes: {} }; // timeTrackingCodes
  let stateLoaded = false;
  let codesInFlight = false;
  let codesTriedThisPopup = false;

  function metricsCooldownLeft() {
    if (DEBUG.bypassMetricsCooldown) return 0;
    const wait = lastRun.ok ? METRICS_COOLDOWN_MS : METRICS_RETRY_MS;
    return Math.max(0, (Number(lastRun.at) || 0) + wait - Date.now());
  }
  function setLastRun(run) {
    lastRun = run;
    chrome.storage.local.set({ timeTrackingMetricsLastRun: run });
  }
  const timeTabOpen = () => $('incidentsSection')?.style.display === 'block';
  // Metrics data for a day only once the user has pressed Compare; until then the table is SentiBuddy-only.
  const shownMetrics = (day) => (metrics[day]?.status === 'ok' && metrics[day].shown ? metrics[day].data : null);
  const storedCode = (client) => (Object.hasOwn(codesStore.codes, client) ? codesStore.codes[client] : '');
  // The code a client's time is recorded under (the same order as combinedRows, minus the metrics row).
  function codeFor(client) {
    return codeOverrides[client] || storedCode(client) || config.clients.get(client)?.code || config.defaults.code || '';
  }

  // The on-page timer (time-tracking/top.js) can't map workspaces to clients or codes itself, so the
  // popup publishes { codeLabel, byWorkspace: { ws: { client, code } } } for it. Written only when it
  // changes; called from render(), so it follows config, codes, overrides and the running stretch.
  let lastLabelsJson = '';
  function publishLabels() {
    const wsKeys = new Set([GENERAL_WS]);
    if (current?.ws) wsKeys.add(current.ws);
    Object.keys(tracked.days?.[dayKey(new Date())] || {}).forEach(ws => wsKeys.add(ws));
    const byWorkspace = {};
    for (const ws of wsKeys) {
      if (!ws) continue;
      const client = clientFor(ws);
      byWorkspace[ws] = { client, code: codeFor(client) };
    }
    const labels = { codeLabel: config.codeLabel, byWorkspace };
    const json = JSON.stringify(labels);
    if (json === lastLabelsJson) return;
    lastLabelsJson = json;
    chrome.storage.local.set({ timeTrackingLabels: labels });
  }

  // replace: the daily codes-only lookup (the full current list); otherwise merge (a metrics run's codes win).
  function saveCodes(codes, replace) {
    if (!codes.size) return; // a failed lookup returns {}: keep what we have
    const next = replace ? {} : { ...codesStore.codes };
    codes.forEach((code, client) => { next[client] = code; });
    codesStore = { ...codesStore, at: Date.now(), codes: next };
    chrome.storage.local.set({ timeTrackingCodes: codesStore });
  }

  // Show a day's earlier results, if this browser session has them. Never calls the endpoint.
  async function restoreMetrics(day) {
    if (!config.metricsEndpoint || !prefs.enabled || metrics[day]) return;
    const cacheKey = `ttMetrics:${day}`;
    const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
    // Only results for the same user: the DEBUG override's, or (without it) your own.
    const sameUser = (cached?.debugEmail || '') === text(DEBUG.metricsEmail, 254).trim();
    if (cached && sameUser && !metrics[day]) {
      metrics[day] = { status: 'ok', data: normalizeMetrics(cached.payload), at: cached.at, shown: !!cached.shown };
      render();
    }
  }

  async function metricsEmail() {
    const debugEmail = text(DEBUG.metricsEmail, 254).trim();
    if (debugEmail) console.warn(`[SentiBuddy] DEBUG: metrics requested for ${debugEmail}, not your portal email.`);
    return debugEmail || portalEmail();
  }

  async function postMetrics(email, day, codesOnly) {
    const body = { email, date: day, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    if (codesOnly) body.returnOnly = 'codes-only';
    const res = await fetch(config.metricsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Codes only (the Logic App's quick path: no hours query). Automatic: one attempt per day (success or
  // not), on the first time the Time page is open that day. Manual (Refresh codes): every press.
  async function fetchCodes(manual) {
    const today = dayKey(new Date());
    if (codesInFlight) return;
    if (!manual && (codesTriedThisPopup || (codesStore.attemptDay === today && !DEBUG.bypassMetricsCooldown))) return;
    codesInFlight = true;
    const btn = $('ttRefreshCodes');
    if (btn) btn.disabled = true;
    if (manual) setStatus('Refreshing codes…');
    try {
      const email = await metricsEmail();
      if (!email) { // not counted as an attempt: tried again the next time the page is opened
        if (manual) setStatus('Couldn\'t detect your email. Open portal.azure.com in the active tab and try again.', 'error');
        return;
      }
      codesTriedThisPopup = true;
      codesStore = { ...codesStore, attemptDay: today };
      chrome.storage.local.set({ timeTrackingCodes: codesStore });
      const codes = normalizeMetrics(await postMetrics(email, today, true)).codes;
      saveCodes(codes, true); // an empty answer keeps the codes already stored
      if (manual) setStatus(codes.size ? `Codes refreshed: ${codes.size} found.` : 'No codes came back.', codes.size ? 'success' : 'error');
      render();
    } catch (e) {
      console.warn('[SentiBuddy] Couldn\'t load time-entry codes:', e?.message || e);
      if (manual) setStatus(`Couldn't refresh codes: ${e?.message || e}`, 'error');
    } finally {
      codesInFlight = false;
      if (btn) btn.disabled = false;
    }
  }

  // auto: the background run (results stay hidden until Compare); otherwise Compare / Refresh.
  const metricsInFlight = new Set(); // days
  async function runMetrics(day, auto) {
    if (!config.metricsEndpoint || !prefs.enabled || !prefs.experimental || metricsInFlight.has(day)) return;
    if (!auto) {
      const left = metricsCooldownLeft();
      if (left > 0) {
        setStatus(`Metrics can be refreshed again in ${Math.ceil(left / 60000)} min.`, 'error');
        return;
      }
    }
    metricsInFlight.add(day);
    try {
      await runMetricsNow(day, auto);
    } finally {
      metricsInFlight.delete(day);
    }
  }
  async function runMetricsNow(day, auto) {
    const previous = metrics[day]?.status === 'ok' ? metrics[day] : null;
    // A background refresh keeps the results already on screen until the new ones arrive.
    if (!(auto && previous)) metrics[day] = { status: 'loading', shown: !auto || !!metrics[day]?.shown };
    render();
    // Read when the run ends: Compare may have been pressed while a background run was going.
    const shownNow = () => !!metrics[day]?.shown;
    const email = await metricsEmail();
    if (!email) {
      const msg = 'Couldn\'t detect your email. Open portal.azure.com in the active tab and reopen this menu.';
      metrics[day] = previous ? { ...previous, shown: shownNow() } : { status: 'error', error: msg, shown: shownNow() };
      if (previous && shownNow()) setStatus(msg, 'error');
      render();
      return;
    }
    setLastRun({ at: Date.now(), ok: false });
    try {
      const payload = await postMetrics(email, day, false);
      const data = normalizeMetrics(payload);
      saveCodes(data.codes, false); // also when the hours query failed: the Logic App still returns codes
      const failed = pick(payload, 'error');
      if (failed) throw new Error(text(String(failed), 200));
      const at = Date.now();
      metrics[day] = { status: 'ok', data, at, shown: shownNow() };
      chrome.storage.session.set({ [`ttMetrics:${day}`]: { at, payload, debugEmail: text(DEBUG.metricsEmail, 254).trim(), shown: shownNow() } });
      setLastRun({ at: lastRun.at, ok: true });
    } catch (e) {
      const msg = `Couldn't load metrics: ${e?.message || e}`;
      metrics[day] = previous ? { ...previous, shown: shownNow() } : { status: 'error', error: msg, shown: shownNow() };
      if (previous && shownNow()) setStatus(msg, 'error');
    }
    render();
  }

  // Compare: show what the background run already fetched (no query), or wait for one in progress;
  // Refresh (results already shown) or no results yet: run the query, within the 30-minute limit.
  function compareMetrics(day) {
    const m = metrics[day];
    if (m && !m.shown) { // includes a failed background run: show its error rather than re-querying
      m.shown = true;
      if (m.status === 'ok') {
        const key = `ttMetrics:${day}`;
        chrome.storage.session.get(key).then((s) => {
          if (s[key]) chrome.storage.session.set({ [key]: { ...s[key], shown: true } });
        });
      }
      render();
      return;
    }
    runMetrics(day, false);
  }

  // While the Time page is open: today's codes (once a day) and the 4-hourly background metrics run.
  function autoFetch() {
    if (!stateLoaded || !config.metricsEndpoint || !prefs.enabled || !prefs.experimental || !timeTabOpen()) return;
    fetchCodes(false);
    const today = dayKey(new Date());
    if (Date.now() - (Number(lastRun.at) || 0) >= METRICS_AUTO_MS) runMetrics(today, true);
  }

  // ---------- Combined view
  const roundHours = (h) => Number(h.toFixed(config.hoursDecimals));
  const hoursText = (h) => String(roundHours(h));
  function hm(hours) {
    const m = Math.round(hours * 60);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  }

  // ---------- The user's per-day edits (timeTrackingEdits[day]), layered over tracked time:
  //   merges:  { FROM: { into: CLIENT, adjustMs } }  FROM's hours (both sources) are added to CLIENT
  //   adjustMs: { CLIENT: ms }  edited SentiBuddy hours, stored as a difference from the tracked time
  //            so time still being counted today keeps adding on top
  //   order:   [CLIENT, …]  row order after dragging (rows not in it follow, most time first)
  // Cleared by Reset (service worker), like the tracked time they adjust.
  let edits = {};
  function editsFor(day) {
    const e = edits[day] && typeof edits[day] === 'object' ? edits[day] : {};
    return {
      merges: e.merges && typeof e.merges === 'object' ? { ...e.merges } : {},
      adjustMs: e.adjustMs && typeof e.adjustMs === 'object' ? { ...e.adjustMs } : {},
      order: Array.isArray(e.order) ? e.order.filter(c => typeof c === 'string').slice(0, 500) : []
    };
  }
  function updateEdits(day, fn) {
    const ed = editsFor(day);
    fn(ed);
    edits = { ...edits, [day]: ed };
    chrome.storage.local.set({ timeTrackingEdits: edits });
    render();
  }
  // Follow merges to the row a client ends up in (guarding against cycles).
  function mergedInto(ed, client) {
    const seen = new Set();
    while (ed.merges[client]?.into && !seen.has(client)) {
      seen.add(client);
      client = ed.merges[client].into;
    }
    return client;
  }

  // [{ client, sb, trackedSb, adjusted, mx, hours (per export source), info, merged, workspaces, incidents }]
  function combinedRows(day) {
    const sbByClient = trackedByClient(day);
    const mx = shownMetrics(day);
    const ed = editsFor(day);
    const names = new Set([...sbByClient.keys(), ...(mx ? mx.clients.keys() : [])]);
    const groups = new Map(); // row client → [member clients]
    for (const name of names) {
      const into = mergedInto(ed, name);
      groups.set(into, [...(groups.get(into) || []), name]);
    }
    const rows = [...groups].map(([client, members]) => {
      let sbMs = null;
      let m = null;
      let mxRow = null;
      const workspaces = new Set();
      const incidents = new Map(); // from both sources, matched by incident number
      for (const member of members) {
        const s = sbByClient.get(member);
        if (s) {
          sbMs = (sbMs ?? 0) + s.ms;
          s.workspaces.forEach(w => workspaces.add(w));
          for (const [key, v] of s.incidents) {
            const cur = incidents.get(key) || { n: v.n, sb: null, mx: null };
            incidents.set(key, { ...cur, sb: (cur.sb ?? 0) + v.ms / 3600000 });
          }
        }
        const x = mx?.clients.get(member);
        if (x) {
          m = (m ?? 0) + x.hours;
          if (member === client) mxRow = x;
          for (const [key, v] of x.incidents) {
            const cur = incidents.get(key) || { n: v.n, sb: null, mx: null };
            incidents.set(key, { ...cur, mx: (cur.mx ?? 0) + v.hours });
          }
        }
      }
      const trackedSb = sbMs == null ? null : sbMs / 3600000;
      const adj = Number(ed.adjustMs[client]) || 0;
      const sb = trackedSb == null && !adj ? null : Math.max(0, (trackedSb ?? 0) + adj / 3600000);
      const source = mx ? exportSource : 'sentibuddy'; // metrics/average only once compared
      const hours = source === 'metrics' ? (m ?? 0)
        : source === 'average' ? (sb != null && m != null ? (sb + m) / 2 : sb ?? m ?? 0)
          : (sb ?? 0);
      const cfg = config.clients.get(client) || {};
      const info = Object.fromEntries(Object.entries({ ...config.defaults }).map(([k, v]) => [k, cfg[k] || v]));
      // A code the user set (click the Code cell) wins, then the endpoint's codes (daily lookup, overwritten
      // by the latest metrics run), then the config.
      const found = codeOverrides[client] || storedCode(client) || mxRow?.code || mx?.codes.get(client) ||
        cfg.code || config.defaults.code;
      info.code = found || config.missingCode;
      const codeMissing = !found;
      if (config.reviewAboveHours != null && hours > config.reviewAboveHours && !codeOverrides[client]) {
        info.code = config.reviewCode;
      }
      return { client, sb, trackedSb, adjusted: !!adj, mx: m, hours, info, codeMissing,
        codeOverridden: !!codeOverrides[client], merged: members.filter(c => c !== client), workspaces, incidents };
    });
    // Dragged order first, then everything else with the most time first.
    const pos = (c) => { const i = ed.order.indexOf(c); return i < 0 ? Infinity : i; };
    return rows.sort((a, b) => (pos(a.client) - pos(b.client)) || // NaN (both unordered) is falsy
      Math.max(b.sb ?? 0, b.mx ?? 0) - Math.max(a.sb ?? 0, a.mx ?? 0));
  }

  // ---------- Render
  function cell(textValue, cls, title) {
    const td = document.createElement('td');
    td.textContent = textValue;
    if (cls) td.className = cls;
    if (title) td.title = title;
    return td;
  }

  // Code cell: click to set this client's code (remembered for future days). A missing code shows
  // the placeholder, highlighted.
  function codeCell(r) {
    const td = cell(r.info.code, ['tt-code', r.codeMissing ? 'tt-code-missing' : '', r.codeOverridden ? 'tt-code-set' : '']
      .filter(Boolean).join(' '));
    const label = config.codeLabel;
    td.title = r.codeMissing
      ? `No ${label} found for this client. Click to set one.`
      : r.codeOverridden ? `${label} you set. Click to change or clear it.` : `Click to set a different ${label} for this client`;
    td.addEventListener('click', (e) => {
      e.stopPropagation(); // don't expand/collapse the row
      const current = codeOverrides[r.client] || (r.codeMissing ? '' : r.info.code);
      const input = prompt(`${label} for ${r.client} (leave empty to go back to the automatic one):`, current);
      if (input == null) return;
      const code = text(input, 80).trim();
      const next = { ...codeOverrides };
      if (code) next[r.client] = code; else delete next[r.client];
      chrome.storage.local.set({ timeTrackingCodeOverrides: next });
    });
    return td;
  }

  // Difference = metrics − SentiBuddy, in hours. Gaps of 15 minutes or more are highlighted.
  const DIFF_HIGHLIGHT_H = 0.25;
  function setDiff(el, d) {
    el.textContent = `${d > 0 ? '+' : d < 0 ? '−' : '±'}${hoursText(Math.abs(d))} h`;
    el.title = `Metrics ${d >= 0 ? 'higher' : 'lower'} than SentiBuddy by ${hm(Math.abs(d))}`;
    el.classList.toggle('tt-diff-big', Math.abs(d) >= DIFF_HIGHLIGHT_H);
  }
  function diffCell(sb, mx) {
    const td = cell('—', 'tt-num tt-diff');
    if (sb != null || mx != null) setDiff(td, (mx ?? 0) - (sb ?? 0));
    return td;
  }

  // ---------- Editing the table (saved per day in timeTrackingEdits; see editsFor)
  let dragClient = null; // row being dragged
  let editing = false; // an hours input is open: hold off re-renders until it closes

  const displayName = (client) => (client === config.generalClient
    ? `${client === 'GENERAL' ? 'General' : client} (portal)` : client);

  function clientCell(r, day, open) {
    const td = document.createElement('td');
    td.className = 'tt-client-cell';
    const name = document.createElement('span');
    name.className = 'tt-drag';
    name.textContent = `${showIncidents ? (open ? '▾ ' : '▸ ') : ''}${displayName(r.client)}`;
    name.title = 'Drag to reorder, or drop onto another row to merge into it';
    td.append(name);
    for (const from of r.merged) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tt-merged';
      chip.textContent = `+ ${displayName(from)} ✕`;
      chip.title = `${displayName(from)}'s hours are included in this row. Click to split it back out.`;
      chip.addEventListener('click', (e) => { e.stopPropagation(); unmerge(day, from); });
      td.append(chip);
    }
    return td;
  }

  // Drag a row: drop on the top/bottom edge of another row to move it there, on the middle to merge.
  function dropZone(tr, y) {
    const box = tr.getBoundingClientRect();
    const f = (y - box.top) / box.height;
    return f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'merge';
  }
  function clearDropMarks() {
    document.querySelectorAll('#ttRows tr').forEach(tr =>
      tr.classList.remove('tt-drop-before', 'tt-drop-after', 'tt-drop-merge', 'tt-dragging'));
  }
  function makeRowDraggable(tr, client, day, rows) {
    tr.draggable = true;
    tr.addEventListener('dragstart', (e) => {
      if (editing) { e.preventDefault(); return; }
      dragClient = client;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', client);
      tr.classList.add('tt-dragging');
    });
    tr.addEventListener('dragend', () => {
      dragClient = null;
      clearDropMarks();
      render();
    });
    tr.addEventListener('dragover', (e) => {
      if (!dragClient || dragClient === client) return;
      e.preventDefault();
      const zone = dropZone(tr, e.clientY);
      if (!tr.classList.contains(`tt-drop-${zone}`)) {
        clearDropMarks();
        tr.classList.add(`tt-drop-${zone}`);
      }
    });
    tr.addEventListener('dragleave', (e) => {
      if (!tr.contains(e.relatedTarget)) tr.classList.remove('tt-drop-before', 'tt-drop-after', 'tt-drop-merge');
    });
    tr.addEventListener('drop', (e) => {
      if (!dragClient || dragClient === client) return;
      e.preventDefault();
      const from = dragClient;
      const zone = dropZone(tr, e.clientY);
      dragClient = null;
      clearDropMarks();
      if (zone === 'merge') merge(day, from, client);
      else reorder(day, rows.map(x => x.client), from, client, zone === 'after');
    });
  }
  function reorder(day, order, from, target, after) {
    const list = order.filter(c => c !== from);
    const i = list.indexOf(target);
    list.splice(after ? i + 1 : i, 0, from);
    updateEdits(day, (ed) => { ed.order = list; });
  }
  // FROM's hours (and any hour edit on it) move into INTO; undone with the "+ FROM ✕" tag.
  function merge(day, from, into) {
    updateEdits(day, (ed) => {
      const moved = Number(ed.adjustMs[from]) || 0;
      delete ed.adjustMs[from];
      if (moved) ed.adjustMs[into] = (Number(ed.adjustMs[into]) || 0) + moved;
      ed.merges[from] = { into, adjustMs: moved };
      ed.order = ed.order.filter(c => c !== from);
    });
    setStatus(`Merged ${displayName(from)} into ${displayName(into)}. Click "+ ${displayName(from)} ✕" to undo.`, 'success');
  }
  function unmerge(day, from) {
    updateEdits(day, (ed) => {
      const m = ed.merges[from];
      if (!m) return;
      const into = mergedInto(ed, m.into);
      delete ed.merges[from];
      const moved = Number(m.adjustMs) || 0;
      if (moved) {
        ed.adjustMs[into] = (Number(ed.adjustMs[into]) || 0) - moved;
        if (!ed.adjustMs[into]) delete ed.adjustMs[into];
        ed.adjustMs[from] = moved;
      }
    });
  }

  // SentiBuddy hours edits are stored as the difference from the tracked time.
  function setAdjust(ed, r, hours) {
    const ms = Math.round((hours - (r.trackedSb ?? 0)) * 3600000);
    if (Math.abs(ms) < 1000) delete ed.adjustMs[r.client]; else ed.adjustMs[r.client] = ms;
  }
  // "1.5", "1:30" or "" (back to the tracked time); up to 24 hours.
  function parseHours(v) {
    const s = String(v).trim();
    const parts = /^(\d{1,2}):([0-5]?\d)$/.exec(s);
    const h = parts ? Number(parts[1]) + Number(parts[2]) / 60 : /^(\d{1,2}(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
    return Number.isFinite(h) && h >= 0 && h <= 24 ? h : null;
  }
  function hoursCell(r, day) {
    const td = cell(r.sb == null ? '—' : hoursText(r.sb), `tt-num tt-edit${r.adjusted ? ' tt-edited' : ''}`);
    td.title = `${r.adjusted ? `Edited (tracked: ${hm(r.trackedSb ?? 0)}). ` : ''}${r.sb != null ? `${hm(r.sb)} · ` : ''}Click to edit (e.g. 1.5 or 1:30)`;
    td.addEventListener('click', (e) => {
      e.stopPropagation();
      if (editing) return;
      editing = true;
      const input = document.createElement('input');
      input.className = 'tt-hours-input';
      input.value = r.sb == null ? '' : hoursText(r.sb);
      input.setAttribute('aria-label', `SentiBuddy hours for ${displayName(r.client)}`);
      td.replaceChildren(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        editing = false;
        if (!save) { render(); return; }
        const raw = input.value.trim();
        if (raw === '') { updateEdits(day, (ed) => { delete ed.adjustMs[r.client]; }); return; }
        const hours = parseHours(raw);
        if (hours == null) { setStatus('Enter hours like 1.5 or 1:30 (up to 24).', 'error'); render(); return; }
        updateEdits(day, (ed) => setAdjust(ed, r, hours));
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
    });
    return td;
  }

  function actionButton(label, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tt-row-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }
  const canAverage = (r) => r.sb != null && r.mx != null;
  function rowActions(r, day, mxOk) {
    const td = cell('', 'tt-row-actions');
    if (mxOk && canAverage(r)) {
      const avg = (r.sb + r.mx) / 2;
      td.append(actionButton('⌀', `Set SentiBuddy hours to the average of both (${hoursText(avg)} h)`,
        () => updateEdits(day, (ed) => setAdjust(ed, r, avg))));
    }
    if (r.adjusted) {
      td.append(actionButton('↺', `Undo hour edits: back to the tracked ${hm(r.trackedSb ?? 0)}`,
        () => updateEdits(day, (ed) => { delete ed.adjustMs[r.client]; })));
    }
    return td;
  }
  // Every row with both numbers: SentiBuddy hours := average of SentiBuddy and metrics.
  function averageAll() {
    const day = $('ttDay').value || dayKey(new Date());
    if (!shownMetrics(day)) { setStatus('Compare metrics for this day first.', 'error'); return; }
    const rows = combinedRows(day).filter(canAverage);
    if (!rows.length) { setStatus('No rows have both SentiBuddy and metrics hours.', 'error'); return; }
    updateEdits(day, (ed) => rows.forEach(r => setAdjust(ed, r, (r.sb + r.mx) / 2)));
    setStatus(`Set ${rows.length} row${rows.length === 1 ? '' : 's'} to the average of SentiBuddy and metrics. ↺ on a row undoes it.`, 'success');
  }

  // "Compare metrics" (shows results already fetched in the background, free) / "Refresh" (runs the
  // query again, at most once per 30 minutes), with a countdown while it can't run.
  function renderCompareButton(hasMetrics, m) {
    const btn = $('ttCompareMetrics');
    btn.hidden = !hasMetrics;
    if (!hasMetrics) return;
    const hiddenResult = m && !m.shown; // revealing it doesn't query
    const left = hiddenResult ? 0 : metricsCooldownLeft();
    const loading = m?.shown && m.status === 'loading';
    const label = m?.shown ? 'Refresh' : 'Compare metrics';
    btn.disabled = loading || left > 0;
    btn.textContent = loading ? 'Comparing…' : left > 0 ? `${label} (in ${Math.ceil(left / 60000)} min)` : label;
    btn.title = left > 0 && !loading
      ? 'The metrics query is expensive, so it can run once every 30 minutes.'
      : hiddenResult ? 'Show the metrics fetched in the background' : 'Run the metrics query for this day (once every 30 minutes)';
  }

  function render() {
    if (!$('timeTrackingCard')) return;
    if (editing || dragClient) return; // re-rendered when the edit / drag ends
    publishLabels();
    $('ttOff').hidden = prefs.enabled;
    $('ttBody').hidden = !prefs.enabled;
    if (!prefs.enabled) return;

    const day = $('ttDay').value || dayKey(new Date());
    const m = metrics[day];
    const hasMetrics = !!config.metricsEndpoint;
    const mxOk = hasMetrics && !!shownMetrics(day);
    const visible = !!m?.shown;
    const rows = combinedRows(day);
    const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
    const both = (h) => `${hm(h)} (${hoursText(h)} h)`;
    $('ttTotal').textContent = both(sum('sb'));
    $('ttState').textContent = prefs.paused ? 'Paused' : prefs.idle ? 'Away (not counting)' : current?.since ? 'Counting' : '';
    $('ttState').classList.toggle('is-counting', !prefs.paused && !prefs.idle && !!current?.since);

    // Comparison with the metrics endpoint: nothing metrics-related shows until "Compare metrics" has
    // been run for this day (or how to set it up, without an endpoint).
    $('ttMetricsSetup').hidden = hasMetrics;
    $('ttMetricsInfo').hidden = !hasMetrics;
    $('ttTotalMetricsWrap').hidden = !mxOk;
    $('ttTotalMetrics').textContent = mxOk ? both(sum('mx')) : '—';
    $('ttTotalDiffWrap').hidden = !mxOk;
    if (mxOk) setDiff($('ttTotalDiff'), sum('mx') - sum('sb'));
    $('ttMetricsCol').hidden = !mxOk;
    $('ttDiffCol').hidden = !mxOk;
    $('ttSourceWrap').hidden = !mxOk;
    const debugEmail = text(DEBUG.metricsEmail, 254).trim();
    const portal = ($('lookbackEmail')?.value || '').trim();
    $('ttMetricsUser').textContent = debugEmail ? `${debugEmail} (DEBUG override)` : portal || 'Detecting from Azure portal…';
    $('ttMetricsUser').classList.toggle('is-debug', !!debugEmail);
    const shift = (mxOk && m.data.shift ? ` · Shift: ${m.data.shift}` : '') +
      (debugEmail ? ` · DEBUG user: ${debugEmail}` : '') + (DEBUG.bypassMetricsCooldown ? ' · DEBUG: no limit' : '');
    const statusEl = $('ttMetricsStatus');
    const fetchedAt = m?.status === 'ok' ? new Date(m.at) : null;
    statusEl.textContent = !hasMetrics ? ''
      : !visible ? (fetchedAt ? `Metrics from ${fetchedAt.toLocaleTimeString()} are ready: press Compare metrics to see them.`
        : 'Compare your hours with the organisation\'s metrics for this day.')
        : m.status === 'loading' ? 'Running the metrics query… (can take up to a couple of minutes)'
          : m.status === 'error' ? m.error
            : `Metrics as of ${fetchedAt.toLocaleTimeString()}${shift}`;
    statusEl.classList.toggle('is-error', visible && m.status === 'error');
    statusEl.title = fetchedAt
      ? `Fetched ${fetchedAt.toLocaleString()}. Refreshed in the background every 4 hours while this page is open; Refresh runs it now (at most once every 30 minutes).`
      : '';
    renderCompareButton(hasMetrics, m);

    $('ttAverageAll').hidden = !mxOk;
    const cols = 4 + (mxOk ? 2 : 0);
    const body = $('ttRows');
    body.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = cell('No time tracked for this day.', 'tt-empty');
      td.colSpan = cols;
      tr.append(td);
      body.append(tr);
    }
    const val = (h) => (h == null ? '—' : hoursText(h));
    for (const r of rows) {
      const open = showIncidents && expandedClients.has(r.client);
      const tr = document.createElement('tr');
      tr.className = showIncidents ? 'tt-client tt-expandable' : 'tt-client';
      tr.title = [...r.workspaces].join(', ');
      if (showIncidents) {
        tr.addEventListener('click', (e) => {
          if (e.target.closest('button, input, .tt-code, .tt-edit')) return;
          open ? expandedClients.delete(r.client) : expandedClients.add(r.client);
          render();
        });
      }
      makeRowDraggable(tr, r.client, day, rows);
      tr.append(
        clientCell(r, day, open),
        codeCell(r),
        hoursCell(r, day)
      );
      if (mxOk) tr.append(cell(val(r.mx), 'tt-num', r.mx != null ? hm(r.mx) : ''));
      if (mxOk) tr.append(diffCell(r.sb, r.mx));
      tr.append(rowActions(r, day, mxOk));
      body.append(tr);
      if (!open) continue;
      const incidents = [...r.incidents.entries()].sort((a, b) =>
        (a[0] === WORKSPACE_ONLY) - (b[0] === WORKSPACE_ONLY) || Math.max(b[1].sb ?? 0, b[1].mx ?? 0) - Math.max(a[1].sb ?? 0, a[1].mx ?? 0));
      for (const [key, inc] of incidents) {
        const sub = document.createElement('tr');
        sub.className = 'tt-incident';
        const label = cell(key === WORKSPACE_ONLY ? 'Not in an incident' : key === GENERAL_ID ? 'Portal (no single workspace)'
          : inc.n ? `Incident #${inc.n}` : `Incident ${key.slice(0, 8)}…`);
        label.colSpan = 2;
        sub.append(label, cell(inc.sb == null ? '—' : hm(inc.sb), 'tt-num'));
        if (mxOk) sub.append(cell(inc.mx == null ? '—' : hm(inc.mx), 'tt-num'));
        if (mxOk) sub.append(diffCell(inc.sb, inc.mx));
        sub.append(cell(''));
        body.append(sub);
      }
    }

    $('ttSource').value = exportSource;
    $('ttShowIncidents').checked = showIncidents;
    const pause = $('ttPause');
    pause?.setText?.(prefs.paused ? 'Resume' : 'Pause');
    pause?.setColor?.(prefs.paused ? '#107C10' : '#D83B01');
    $('ttTimeEntry')?.setText?.(prefs.timeEntryTitle || 'Time entry');
    if ($('ttCodeCol')) $('ttCodeCol').textContent = config.codeLabel;
  }

  // ---------- Export
  const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  function formatDate(day, fmt) {
    const [y, m, d] = day.split('-');
    return fmt.replace(/YYYY|MM|DD|M|D/g, t => ({ YYYY: y, MM: m, DD: d, M: String(Number(m)), D: String(Number(d)) }[t]));
  }
  function fill(template, vars) {
    return template.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : m));
  }

  function exportCsv() {
    const day = $('ttDay').value || dayKey(new Date());
    if (exportSource !== 'sentibuddy' && !shownMetrics(day)) {
      setStatus('Compare metrics for this day first, or export SentiBuddy hours.', 'error');
      return;
    }
    const rows = combinedRows(day).filter(r => roundHours(r.hours) > 0);
    if (!rows.length) { setStatus('Nothing to export for this day.', 'error'); return; }
    const date = formatDate(day, config.dateFormat);
    const shift = shownMetrics(day)?.shift || '';
    const lines = [config.columns.map(c => csvCell(c.header)).join(',')];
    for (const r of rows) {
      const base = { date, isoDate: day, client: r.client, hours: hoursText(r.hours), shift, workspaces: [...r.workspaces].join(' ') };
      // Defaults/per-client values may themselves use placeholders, e.g. task "… ({shift})".
      const info = Object.fromEntries(Object.entries(r.info).map(([k, v]) => [k, fill(v, base)]));
      const vars = { ...base, ...info };
      lines.push(config.columns.map(c => csvCell(fill(c.value, vars))).join(','));
    }
    const [y, m, d] = day.split('-');
    const name = fill(config.fileName, { date: date.replace(/[\\/:*?"<>|]/g, '-'), isoDate: day,
      monthName: MONTHS[Number(m) - 1], dd: d, yyyy: y }).replace(/[\\/:*?"<>|]/g, '-');
    const url = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const source = { sentibuddy: 'SentiBuddy', metrics: 'metrics', average: 'averaged' }[exportSource];
    setStatus(`Exported ${rows.length} client${rows.length === 1 ? '' : 's'} (${source} hours) for ${date}.`, 'success');
  }

  function setStatus(message, kind) {
    const s = $('ttStatus');
    if (!s) return;
    s.textContent = message || '';
    s.className = `incident-status${kind ? ` is-${kind}` : ''}`;
  }

  // ---------- Wiring
  window.SentiBuddyTimeTracking = {
    // fallbackEndpoint: the central config's incidentLookbackEndpoint (the same Logic App, reworked to
    // return metrics), used when timeTracking.metricsEndpoint isn't set.
    setConfig(master, fallbackEndpoint) {
      config = normalizeConfig(master?.timeTracking);
      if (!config.metricsEndpoint) config.metricsEndpoint = httpsUrl(fallbackEndpoint);
      loadDevDataWorkspaces(master);
      render();
      const day = $('ttDay')?.value;
      if (day) restoreMetrics(day);
      autoFetch();
    }
  };

  function load() {
    chrome.storage.local.get({ timeTrackingEnabled: true, toggleExperiments: false, timeTrackingPaused: false,
      timeTrackingIdle: false, timeEntryTitle: 'Time entry', timeEntryLink: '', workspaceClientPattern: '',
      timeTracking: { days: {} }, timeTrackingCodeOverrides: {},
      timeTrackingCurrent: null, timeTrackingEdits: {}, timeTrackingMetricsLastRun: null,
      timeTrackingCodes: null }, (s) => {
      current = s.timeTrackingCurrent;
      edits = s.timeTrackingEdits && typeof s.timeTrackingEdits === 'object' ? s.timeTrackingEdits : {};
      codeOverrides = s.timeTrackingCodeOverrides && typeof s.timeTrackingCodeOverrides === 'object' ? s.timeTrackingCodeOverrides : {};
      prefs = { enabled: !!s.timeTrackingEnabled, experimental: s.toggleExperiments === true,
        paused: !!s.timeTrackingPaused, idle: !!s.timeTrackingIdle,
        timeEntryTitle: s.timeEntryTitle, timeEntryLink: s.timeEntryLink };
      const pattern = text(s.workspaceClientPattern, 300);
      workspacePattern = pattern && validRegex(pattern) ? new RegExp(pattern, 'i') : null;
      tracked = s.timeTracking || { days: {} };
      const run = s.timeTrackingMetricsLastRun;
      lastRun = run && Number.isFinite(run.at) ? { at: run.at, ok: run.ok !== false } : { at: 0, ok: true };
      const c = s.timeTrackingCodes;
      codesStore = {
        attemptDay: typeof c?.attemptDay === 'string' ? c.attemptDay : '',
        at: Number(c?.at) || 0,
        codes: c?.codes && typeof c.codes === 'object' ? c.codes : {}
      };
      stateLoaded = true;
      render();
      if (prefs.enabled) {
        restoreMetrics($('ttDay')?.value || dayKey(new Date())); // earlier results only; never queries
        autoFetch();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const dayInput = $('ttDay');
    if (!dayInput) return;
    dayInput.value = dayKey(new Date());
    dayInput.max = dayInput.value;
    dayInput.addEventListener('change', () => {
      expandedClients.clear();
      setStatus('');
      render();
      restoreMetrics(dayInput.value);
    });
    $('ttCompareMetrics').addEventListener('click', () => compareMetrics(dayInput.value));
    $('ttRefreshCodes').addEventListener('click', () => fetchCodes(true));
    $('lookbackEmail').addEventListener('change', render); // portal email detected (popup.js)
    $('ttSource').addEventListener('change', (e) => {
      exportSource = e.target.value;
      localStorage.setItem('ttExportSource', exportSource);
      render();
    });
    $('ttShowIncidents').addEventListener('change', (e) => {
      showIncidents = e.target.checked;
      localStorage.setItem('ttShowIncidents', showIncidents ? '1' : '0');
      render();
    });
    $('ttPause').addEventListener('click', () => chrome.storage.local.set({ timeTrackingPaused: !prefs.paused }));
    $('ttExport').addEventListener('click', exportCsv);
    $('ttAverageAll').addEventListener('click', averageAll);
    // Tracked time is kept (across browser restarts) until this, or the optional daily auto-reset.
    $('ttReset').addEventListener('click', () => {
      if (!confirm('Delete ALL tracked time (every day)? Export anything you still need first.')) return;
      chrome.runtime.sendMessage({ type: 'tt-reset' }, (res) => {
        void chrome.runtime.lastError;
        setStatus(res?.ok ? 'Tracked time reset.' : 'Couldn\'t reset tracked time.', res?.ok ? 'success' : 'error');
      });
    });
    $('ttTimeEntry').addEventListener('click', () => {
      const url = httpsUrl(prefs.timeEntryLink);
      if (!url) { setStatus(`${prefs.timeEntryTitle || 'Time entry'} URL isn't set. Add it in Settings › Time Tracking.`, 'error'); return; }
      chrome.tabs.create({ url });
    });
    $('ttOpenSettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    load();
    // The popup reopens on the last tab it showed (popup.js), so watch for the Time page appearing.
    const section = $('incidentsSection');
    if (section) new MutationObserver(autoFetch).observe(section, { attributes: true, attributeFilter: ['style'] });
    // Keep today's totals moving while time is being counted, and the Refresh countdown current.
    setInterval(() => { if (current?.since || metricsCooldownLeft() > 0) render(); }, 15000);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (['timeTracking', 'timeTrackingEnabled', 'toggleExperiments', 'timeTrackingPaused', 'timeTrackingIdle',
      'timeEntryTitle', 'timeEntryLink', 'workspaceClientPattern', 'timeTrackingCodeOverrides', 'timeTrackingCurrent',
      'timeTrackingEdits']
      .some(k => k in changes)) load();
    // Another open popup / options page ran a query: keep the limits and codes in step.
    if (changes.timeTrackingMetricsLastRun) {
      const run = changes.timeTrackingMetricsLastRun.newValue;
      if (run && Number.isFinite(run.at)) lastRun = { at: run.at, ok: run.ok !== false };
    }
    if (changes.timeTrackingCodes?.newValue) {
      const c = changes.timeTrackingCodes.newValue;
      codesStore = { attemptDay: String(c.attemptDay || ''), at: Number(c.at) || 0,
        codes: c.codes && typeof c.codes === 'object' ? c.codes : {} };
    }
    if (changes.timeTrackingMetricsLastRun || changes.timeTrackingCodes) render();
  });
})();
