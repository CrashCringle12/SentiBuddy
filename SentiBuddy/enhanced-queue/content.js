// Enhanced Queue content script — capture logic mirrors NewFeedTest/content.js.
// The page hook is injected at document_start on every portal load so the ARM
// token, workspaces and current incidents query are always tracked; the panel
// and ARM fetching only run while the Enhanced Queue is switched on.
(() => {
  if (window.top !== window) return;

  const DEBUG = true;
  const DEBUG_TAG = 'SentiBuddy EQ/content';
  const PANEL_ID = 'sb-eq';
  const BATCH_REFETCH_MIN_MS = 10000;

  function dlog(...args) { if (DEBUG) console.log(`[${DEBUG_TAG}]`, ...args); }

  // 1) Inject page hook once per page load (avoid re-injecting on repeated navigations)
  // The injected script tracks the last emitted tokens and only re-emits when they change.
  (function inject() {
    if (window.__sentiBuddyInjected) {
      dlog('Page hook already injected, skipping');
      return;
    }
    window.__sentiBuddyInjected = true;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('enhanced-queue/injected.js');
    s.type = 'text/javascript';
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
    dlog('Injected page hook');
  })();

  // 2) Capture state (same fields as NewFeedTest)
  let armToken = null;
  let auxHeader = null;
  let auxTokens = [];
  let armQuery = null;
  let lastQuerySig = '';
  let fetchDebounceTimer = null;
  let lastSkipLog = '';
  const ctxMap = new Map(); // key -> { subId, rg, workspace, enabled, lastSeen }

  // ARM token freshness. Tokens arrive from the top page's hook (injected.js) and from the service
  // worker, which observes the portal's ARM requests in every frame (webRequest, read-only). The
  // portal renews its token before it expires; keeping whichever token expires last means
  // SentiBuddy follows those renewals instead of holding the old one until it fails.
  const TOKEN_MIN_LIFE_MS = 60 * 1000; // treat a token this close to expiry as already expired
  let armTokenExp = 0;
  const tokenWaiters = [];

  function tokenExpiry(bearer) {
    try {
      const payload = JSON.parse(atob(bearer.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    } catch {
      return 0;
    }
  }
  const tokenUsable = () => !!armToken && armTokenExp - Date.now() > TOKEN_MIN_LIFE_MS;

  // Keep the token that expires last; ignore anything older than what we have or already expired.
  function acceptToken(token, aux) {
    if (!BEARER_RE.test(token || '')) return false;
    const exp = tokenExpiry(token);
    if (exp <= Date.now() || (token !== armToken && armToken && exp < armTokenExp)) return false;
    const wasUsable = tokenUsable();
    armToken = token;
    armTokenExp = exp;
    if (aux !== undefined) acceptAux(aux);
    tokenWaiters.splice(0).forEach(fn => fn());
    if (!wasUsable) {
      dlog('Fresh ARM token, expires', new Date(exp).toLocaleTimeString());
      if (ctxMap.size) scheduleFetch('token refreshed', true);
    }
    return true;
  }
  function acceptAux(header) {
    if (header == null) return; // requests without aux tokens don't clear ours
    const tokens = String(header).split(',').map(t => t.trim()).filter(t => BEARER_RE.test(t));
    if (!tokens.length) return;
    auxTokens = tokens;
    auxHeader = tokens.join(', ');
  }

  // Resolves once a usable token is available (or after timeoutMs).
  function waitForUsableToken(timeoutMs) {
    if (tokenUsable()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(tokenUsable()); };
      const timer = setTimeout(() => {
        const i = tokenWaiters.indexOf(done);
        if (i >= 0) tokenWaiters.splice(i, 1);
        resolve(tokenUsable());
      }, timeoutMs);
      tokenWaiters.push(done);
    });
  }

  // Tokens relayed by the service worker from the portal's React iframes.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== 'arm-token') return;
    acceptToken(msg.token, msg.auxHeader ?? null);
  });

  // Shared with playbooks/top.js (same isolated world; never exposed to the page).
  globalThis.SentiBuddyArmAuth = () => ({ token: armToken, auxHeader, expired: !tokenUsable() });
  // Waits (up to timeoutMs) for the portal to renew an expired token before handing it out.
  globalThis.SentiBuddyArmAuthFresh = async (timeoutMs = 10000) => {
    await waitForUsableToken(timeoutMs);
    return { token: armToken, auxHeader, expired: !tokenUsable() };
  };

  // 3) Enhanced Queue state
  let active = false;
  let filters = { title: [], tags: [], owner: [], removeMatches: true };
  let items = [];
  let lastFetchAt = 0;
  let inFlight = false;
  let pending = false;
  let lastError = '';
  let truncated = false;
  let selectedKey = null;
  let navToken = 0;
  let pinned = false;
  let geometry = null; // { left, top, width, height } persisted across reloads
  let miniPos = null; // minimized bar position { cx, bottom } persisted across reloads (null = bottom centre)
  let columnOrder = null; // user's drag-and-drop column order (keys), persisted across reloads
  let dragCol = null; // column key being dragged; renders are held off until the drag ends
  let ownerQuery = '';
  const view = {
    // Defaults: open work only, Informational hidden. Chips still let the user add them back.
    search: '',
    severities: new Set(['High', 'Medium', 'Low']),
    statuses: new Set(['New', 'Active']),
    owners: null, // null = every owner; a Set = only those (may be empty)
    showFiltered: false,
    sortKey: null,
    sortDir: -1
  };

  function signatureOfQuery(q) {
    if (!q) return '';
    return JSON.stringify({ apiVersion: q.apiVersion || '', filter: q.filter || '', orderby: q.orderby || '' });
  }

  function scheduleFetch(reason, force) {
    if (!active) return;
    if (!force && reason === 'batch seen' && Date.now() - lastFetchAt < BATCH_REFETCH_MIN_MS) return;
    clearTimeout(fetchDebounceTimer);
    fetchDebounceTimer = setTimeout(() => {
      dlog('Refetch scheduled because:', reason);
      fetchAllEnabled();
    }, 60);
  }

  const ctxKey = (c) => `${c.subId}/${c.rg}/${c.workspace}`;
  function addOrUpdateCtx(c) {
    const key = ctxKey(c);
    const prev = ctxMap.get(key);
    ctxMap.set(key, { ...c, enabled: prev?.enabled ?? true, lastSeen: Date.now() });
    // Fetches are skipped until a workspace is known, so load as soon as the first ones appear.
    if (!prev) scheduleFetch('workspace discovered', true);
  }
  // Nothing to fetch until the portal has shown us a usable token and at least one workspace.
  const canFetch = () => tokenUsable() && ctxMap.size > 0;
  function getEnabledCtxs() { return [...ctxMap.values()].filter(x => x.enabled); }
  function parseWorkspaceFromId(resourceId) {
    const m = /\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.OperationalInsights\/workspaces\/([^/]+)/.exec(resourceId || '');
    if (!m) return null;
    return { subId: m[1], rg: m[2], workspace: m[3] };
  }

  // 4) Messages from injected.js. Any script in the portal page can post these too, so treat
  //    them as untrusted input and only accept well-formed values.
  const BEARER_RE = /^Bearer [A-Za-z0-9\-_.]+$/;
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const NAME_RE = /^[A-Za-z0-9\-_.()]{1,90}$/;
  const isCtx = (c) => c && GUID_RE.test(c.subId) && NAME_RE.test(c.rg) && NAME_RE.test(c.workspace);
  const optStr = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
  const isQuery = (q) => q && optStr(q.apiVersion, 40) && /^[0-9a-z-]*$/i.test(q.apiVersion || '')
    && optStr(q.filter, 4000) && optStr(q.orderby, 200) && (q.top == null || /^\d{1,4}$/.test(String(q.top)));

  addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.__armAuth === true) acceptToken(msg.token);

    if (msg.__armAux === true && Array.isArray(msg.tokens)) acceptAux(msg.tokens.join(', '));
    if (msg.__armCtx === true && isCtx(msg.ctx)) addOrUpdateCtx(msg.ctx);
    if (msg.__armCtxAdd === true && Array.isArray(msg.ctxs)) msg.ctxs.filter(isCtx).forEach(addOrUpdateCtx);

    if (msg.__armQuery === true && isQuery(msg.query)) {
      const newSig = signatureOfQuery(msg.query);
      const changed = newSig !== lastQuerySig;
      armQuery = { apiVersion: msg.query.apiVersion, filter: msg.query.filter, orderby: msg.query.orderby, top: msg.query.top };
      if (changed) {
        lastQuerySig = newSig;
        scheduleFetch('portal query changed', true);
      }
    }

    if (msg.__armBatchSeen === true) scheduleFetch('batch seen');
  });

  // 5) Aggregate fetch across enabled workspaces (NewFeedTest flow, paged via worker)
  async function fetchAllEnabled() {
    if (!active) return;
    if (inFlight) { pending = true; return; }
    // Fetch even without a captured portal query; the worker will apply defaults
    // (most recent 100 incidents, ordered by lastModifiedTimeUtc desc).
    if (!canFetch()) {
      const why = `token? ${!!armToken} expired? ${!!armToken && !tokenUsable()} workspaces= ${ctxMap.size}`;
      if (why !== lastSkipLog) dlog('Fetch skipped:', why); // log once per state, not every attempt
      lastSkipLog = why;
      // An expired token gets replaced as soon as the portal renews it (acceptToken refetches then).
      if (armToken && !tokenUsable()) {
        lastError = 'Azure sign-in expired. Waiting for the portal to renew it; any portal activity (opening an incident, refreshing the queue) will do.';
      }
      render();
      return;
    }
    lastSkipLog = '';

    const ctxs = getEnabledCtxs();
    if (ctxs.length === 0) { items = []; render(); return; }

    inFlight = true;
    lastFetchAt = Date.now();
    setBusy(true);

    try {
      const promises = ctxs.map((c, i) => delay(i * 150).then(() => callWorkerList(c)));
      const results = await Promise.allSettled(promises);

      const allItems = [];
      const errors = [];
      truncated = false;
      results.forEach((r, idx) => {
        const ctx = ctxs[idx];
        if (r.status === 'fulfilled' && r.value && Array.isArray(r.value.value)) {
          r.value.value.forEach(it => {
            if (!it.properties) it.properties = {};
            it.properties.__ws = ctx.workspace;
            it.properties.__subId = ctx.subId;
            it.properties.__rg = ctx.rg;
          });
          allItems.push(...r.value.value);
          if (r.value.truncated) truncated = true;
        } else {
          // Workspaces discovered from unrelated blades may not have Sentinel; ignore those quietly.
          dlog('Workspace fetch failed:', ctx, r.reason || r.value);
          errors.push(ctx.workspace);
        }
      });

      const { deduped } = dedupeIncidents(allItems);
      deduped.sort((a, b) => getIncidentTime(b) - getIncidentTime(a));
      items = deduped;
      lastError = allItems.length === 0 && errors.length ? `Could not load incidents (${errors.join(', ')})` : '';
      sendNotificationCandidates(deduped);
    } catch (e) {
      lastError = String(e?.message || e);
    } finally {
      inFlight = false;
      setBusy(false);
      render();
      if (pending) { pending = false; scheduleFetch('pending', true); }
    }
  }
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function callWorkerList(ctx) {
    const res = await chrome.runtime.sendMessage({
      type: 'listIncidentsAll',
      token: armToken,
      auxHeader,
      auxTokens,
      ctx,
      top: 100,
      queryOverride: armQuery || null
    });
    if (res?.error) throw new Error(res.error);
    return res;
  }

  // 6) Dedupe helpers (NewFeedTest)
  function getWorkspaceTuple(it) {
    const p = it.properties || {};
    const fromId = parseWorkspaceFromId(it.id || '') || {};
    return { subId: p.__subId || fromId.subId || '', rg: p.__rg || fromId.rg || '', ws: p.__ws || fromId.workspace || '' };
  }
  function getIncidentNumber(it) {
    const p = it.properties || {};
    return p.incidentNumber ?? p.IncidentNumber ?? p.incidentnumber ?? p.additionalData?.incidentNumber ?? null;
  }
  function getIncidentTime(it) {
    const p = it.properties || {};
    return new Date(p.lastModifiedTimeUtc || p.lastUpdateTimeUtc || 0).getTime();
  }
  function incidentKey(it) {
    const { subId, rg, ws } = getWorkspaceTuple(it);
    return `${subId}/${rg}/${ws}::${String(getIncidentNumber(it) ?? (it.name || it.id))}`;
  }
  function dedupeIncidents(list) {
    const map = new Map();
    for (const it of list) {
      const key = incidentKey(it);
      const cur = map.get(key);
      if (!cur || getIncidentTime(it) >= getIncidentTime(cur)) map.set(key, it);
    }
    return { deduped: [...map.values()], preCount: list.length, postCount: map.size };
  }

  // 7) Field accessors + Sentinel column definitions
  const props = (it) => it.properties || {};
  const severityOf = (it) => String(props(it).severity || '');
  const statusOf = (it) => String(props(it).status || '');
  const ownerOf = (it) => {
    const o = props(it).owner || {};
    return o.assignedTo || o.email || o.userPrincipalName || 'Unassigned';
  };
  const tagsOf = (it) => (props(it).labels || []).map(l => l?.labelName).filter(Boolean);
  const alertsOf = (it) => props(it).additionalData?.alertsCount ?? '';
  const productsOf = (it) => (props(it).additionalData?.alertProductNames || []).join(', ');
  const tacticsOf = (it) => (props(it).additionalData?.tactics || []).join(', ');
  const techniquesOf = (it) => (props(it).additionalData?.techniques || []).join(', ');
  const workspaceOf = (it) => getWorkspaceTuple(it).ws;

  function formatDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' });
  }

  const SEVERITY_ORDER = { High: 4, Medium: 3, Low: 2, Informational: 1 };

  // SLA highlighting. slaSettings comes from the options page or the central config, so
  // validate everything. SLA time runs from the created time and only matters while the
  // incident is open and unassigned.
  const SEVERITIES = ['High', 'Medium', 'Low', 'Informational'];
  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
  function clampNum(v, min, max, fallback) {
    const n = v == null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  function normalizeSla(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const m = s.minutes && typeof s.minutes === 'object' ? s.minutes : {};
    const minutes = {};
    for (const sev of SEVERITIES) {
      const key = Object.keys(m).find(k => k.toLowerCase() === sev.toLowerCase());
      minutes[sev] = clampNum(key ? m[key] : 0, 0, 525600, 0);
    }
    // Nothing is assumed: no SLAs, no "approaching" stage and no row tint unless configured.
    return {
      enabled: s.enabled !== false && Object.values(minutes).some(v => v > 0),
      minutes,
      warnPercent: clampNum(s.warnPercent, 0, 100, null),
      warnColor: HEX_COLOR_RE.test(s.warnColor) ? s.warnColor : '#ffaa44',
      breachColor: HEX_COLOR_RE.test(s.breachColor) ? s.breachColor : '#e81123',
      warnIntensity: clampNum(s.warnIntensity, 0, 100, 0),
      breachIntensity: clampNum(s.breachIntensity, 0, 100, 0)
    };
  }
  let sla = normalizeSla(null);

  // null when the incident isn't on an SLA clock; otherwise ms remaining and 'ok' | 'warn' | 'breach'.
  function slaInfo(it) {
    if (!sla.enabled || statusOf(it) === 'Closed' || ownerOf(it) !== 'Unassigned') return null;
    const total = sla.minutes[severityOf(it)] * 60000;
    const created = new Date(props(it).createdTimeUtc || 0).getTime();
    if (!total || !created) return null;
    const remaining = created + total - Date.now();
    const state = remaining <= 0 ? 'breach'
      : sla.warnPercent != null && total - remaining >= total * sla.warnPercent / 100 ? 'warn' : 'ok';
    return { remaining, state };
  }
  function formatDuration(ms) {
    const mins = Math.floor(Math.abs(ms) / 60000);
    if (mins < 1) return '<1m';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }
  function applySlaStyle() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.style.setProperty('--eq-sla-warn', sla.warnColor);
    panel.style.setProperty('--eq-sla-warn-mix', `${sla.warnIntensity}%`);
    panel.style.setProperty('--eq-sla-breach', sla.breachColor);
    panel.style.setProperty('--eq-sla-breach-mix', `${sla.breachIntensity}%`);
  }

  const COLUMN_DEFS = {
    sla:                  { label: 'SLA', defaultDir: 1, sort: it => slaInfo(it)?.remaining ?? Infinity, cell: renderSlaCell },
    severity:            { label: 'Severity', sort: it => SEVERITY_ORDER[severityOf(it)] || 0, cell: renderSeverityCell },
    incidentnumber:       { label: 'Incident number', sort: it => Number(getIncidentNumber(it)) || 0, text: it => String(getIncidentNumber(it) ?? '') },
    title:                { label: 'Title', sort: it => String(props(it).title || '').toLowerCase(), text: it => String(props(it).title || it.name || '') },
    alerts:               { label: 'Alerts', sort: it => Number(alertsOf(it)) || 0, text: it => String(alertsOf(it)) },
    incidentprovidername: { label: 'Incident provider name', sort: it => String(props(it).providerName || ''), text: it => String(props(it).providerName || '') },
    alertproductname:     { label: 'Alert product name', sort: productsOf, text: productsOf },
    createdtime:          { label: 'Created time', sort: it => new Date(props(it).createdTimeUtc || 0).getTime(), text: it => formatDate(props(it).createdTimeUtc) },
    lastupdatetime:       { label: 'Last update time', sort: getIncidentTime, text: it => formatDate(props(it).lastModifiedTimeUtc || props(it).lastUpdateTimeUtc) },
    firstactivitytime:    { label: 'First activity time', sort: it => new Date(props(it).firstActivityTimeUtc || 0).getTime(), text: it => formatDate(props(it).firstActivityTimeUtc) },
    lastactivitytime:     { label: 'Last activity time', sort: it => new Date(props(it).lastActivityTimeUtc || 0).getTime(), text: it => formatDate(props(it).lastActivityTimeUtc) },
    owner:                { label: 'Owner', sort: it => ownerOf(it).toLowerCase(), text: ownerOf },
    status:               { label: 'Status', sort: statusOf, cell: renderStatusCell },
    tags:                 { label: 'Tags', sort: it => tagsOf(it).join(','), cell: renderTagsCell },
    tactics:              { label: 'Tactics', sort: tacticsOf, text: tacticsOf },
    techniques:           { label: 'Techniques', sort: techniquesOf, text: techniquesOf },
    reasonforclosing:     { label: 'Reason for closing', sort: it => String(props(it).classification || ''), text: it => String(props(it).classification || '') },
    workspace:            { label: 'Client', sort: clientOf, text: clientOf }
  };
  const DEFAULT_COLUMNS = ['createdtime', 'severity', 'incidentnumber', 'title', 'alerts', 'incidentprovidername',
    'alertproductname', 'lastupdatetime', 'owner', 'status', 'tags'];

  const normalizeHeader = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function readNativeHeaders() {
    return [...document.querySelectorAll('.fxc-gc-columnheader-content.fxc-gc-text')].map(h => h.textContent.trim());
  }

  // Use the live Sentinel grid's columns when it's on screen, with Created time leading, then
  // apply the user's drag-and-drop order on top.
  function resolveColumns() {
    const live = readNativeHeaders().map(normalizeHeader).filter(k => COLUMN_DEFS[k] && k !== 'sla');
    const cols = live.length ? [...new Set(live)] : [...DEFAULT_COLUMNS];
    const ci = cols.indexOf('createdtime');
    if (ci > 0) cols.unshift(...cols.splice(ci, 1));
    if (sla.enabled) cols.splice(cols.indexOf('createdtime') + 1, 0, 'sla');
    const multiWorkspace = new Set(items.map(workspaceOf)).size > 1;
    if (multiWorkspace && !cols.includes('workspace')) cols.splice(Math.min(4, cols.length), 0, 'workspace');
    return columnOrder ? applyColumnOrder(cols, columnOrder) : cols;
  }
  // Columns the saved order doesn't mention (e.g. SLA once configured) slot in after their natural neighbour.
  function applyColumnOrder(cols, order) {
    const out = order.filter(k => cols.includes(k));
    cols.forEach((k, i) => {
      if (out.includes(k)) return;
      const prev = cols.slice(0, i).reverse().find(p => out.includes(p));
      out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, k);
    });
    return out;
  }
  function moveColumn(from, to, after) {
    const cols = resolveColumns().filter(k => k !== from);
    const idx = cols.indexOf(to);
    if (idx < 0) return;
    cols.splice(after ? idx + 1 : idx, 0, from);
    columnOrder = cols;
    chrome.storage.local.set({ enhancedQueueColumnOrder: cols });
    render();
  }
  function normalizeColumnOrder(v) {
    if (!Array.isArray(v)) return null;
    const keys = [...new Set(v.filter(k => typeof k === 'string' && Object.hasOwn(COLUMN_DEFS, k)))];
    return keys.length ? keys : null;
  }
  function resetColumnOrder() {
    columnOrder = null;
    chrome.storage.local.remove('enhancedQueueColumnOrder');
    render();
  }

  // 8) SentiBuddy regex filters (same semantics as core.js)
  function regexHit(text, patterns) {
    for (const p of patterns) {
      try { if (new RegExp(p).test(text)) return true; } catch { /* invalid pattern */ }
    }
    return false;
  }
  function matchesSentiBuddyFilters(it) {
    return regexHit(String(props(it).title || ''), filters.title)
      || regexHit(ownerOf(it), filters.owner)
      || tagsOf(it).some(t => regexHit(t, filters.tags));
  }

  function loadFilters(cb) {
    chrome.storage.local.get({
      filterTitleRegexPatterns: [],
      filterTagsRegexPatterns: [],
      filterOwnerRegexPatterns: [],
      doRemoveFromFilteredFromQueue: true,
      desktopNotifications: true,
      notifyOnMatchesOnly: false,
      notificationRules: [],
      workspaceClientPattern: ''
    }, (s) => {
      try { clientPattern = s.workspaceClientPattern ? new RegExp(String(s.workspaceClientPattern).slice(0, 300), 'i') : null; }
      catch { clientPattern = null; }
      filters = {
        title: s.filterTitleRegexPatterns || [],
        tags: s.filterTagsRegexPatterns || [],
        owner: s.filterOwnerRegexPatterns || [],
        removeMatches: s.doRemoveFromFilteredFromQueue
      };
      notifyPrefs = {
        enabled: s.desktopNotifications !== false,
        onlyMatches: s.notifyOnMatchesOnly === true,
        rules: Array.isArray(s.notificationRules) ? s.notificationRules : []
      };
      cb?.();
    });
  }

  // 8b) Desktop notifications. While the Enhanced Queue is on it drives them (core.js stops watching
  //     the native grid): it sees every incident across workspaces without the native queue being
  //     open, on the right page, or auto-refreshing. Same criteria as before: incidents hidden by the
  //     Regex Filters never notify, and with "only notify for incidents matching the rules" the
  //     title or a tag must match a notification rule. This sends the candidates; the service worker
  //     decides what's new/changed (shared across tabs, so several portal tabs never double-notify).
  let notifyPrefs = { enabled: true, onlyMatches: false, rules: [] };

  function matchesNotificationRule(it) {
    const title = String(props(it).title || '');
    const tags = tagsOf(it);
    return notifyPrefs.rules.some(rule => {
      if (!rule || typeof rule.pattern !== 'string' || !rule.pattern) return false;
      const field = String(rule.field || '').toLowerCase();
      if (field === 'title') return regexHit(title, [rule.pattern]);
      if (field === 'tags' || field === 'tag') return tags.some(t => regexHit(t, [rule.pattern]));
      return false;
    });
  }

  // Client code via the workspaceClientPattern setting, same as the native-grid notifications;
  // without one (or no match), the workspace name.
  let clientPattern = null;
  function clientOf(it) {
    const ws = workspaceOf(it);
    const m = clientPattern?.exec(ws);
    const code = m?.groups?.client ?? m?.[1];
    return code ? code.toUpperCase() : ws;
  }

  function sendNotificationCandidates(list) {
    if (!notifyPrefs.enabled) return;
    const records = list
      .filter(it => !matchesSentiBuddyFilters(it) && (!notifyPrefs.onlyMatches || matchesNotificationRule(it)))
      .map(it => ({
        key: incidentKey(it),
        ws: workspaceOf(it).toLowerCase(),
        created: new Date(props(it).createdTimeUtc || 0).getTime() || 0,
        modified: getIncidentTime(it) || 0,
        number: String(getIncidentNumber(it) ?? ''),
        title: String(props(it).title || ''),
        severity: severityOf(it),
        status: statusOf(it),
        owner: ownerOf(it),
        alerts: String(alertsOf(it)),
        client: clientOf(it)
      }));
    chrome.runtime.sendMessage({ type: 'eq-notify', records }, () => void chrome.runtime.lastError);
  }

  // 9) Panel
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }
  const $ = (sel) => document.getElementById(PANEL_ID)?.querySelector(sel);

  function createPanel(startMinimized) {
    if (document.getElementById(PANEL_ID)) return;

    const panel = el('div', { id: PANEL_ID },
      el('div', { class: 'sb-eq-header' },
        el('div', { class: 'sb-eq-logo', text: '\u{1F6E1}' }),
        el('div', null,
          el('div', { class: 'sb-eq-title', text: 'Enhanced Queue' }),
          el('div', { class: 'sb-eq-subtitle', 'data-role': 'subtitle', text: 'Waiting for incidents…' })
        ),
        el('div', { class: 'sb-eq-header-actions' },
          el('button', { class: 'sb-eq-iconbtn sb-eq-back', 'data-role': 'back', hidden: '', title: 'Go back to the page you opened the incident from',
            onclick: backToQueue }, '↩ Back to queue'),
          el('button', { class: 'sb-eq-iconbtn sb-eq-auto', 'data-role': 'auto', onclick: toggleAutoRefresh }, 'Auto'),
          el('button', { class: 'sb-eq-iconbtn', 'data-role': 'refresh', title: 'Refresh now', onclick: () => scheduleFetch('manual', true) }, '⟳'),
          el('button', { class: 'sb-eq-iconbtn', 'data-role': 'pin', onclick: togglePin }, '\u{1F4CC}'),
          el('button', { class: 'sb-eq-iconbtn', 'data-role': 'minimize', title: 'Minimize', onclick: toggleMinimize }, '–'),
          el('button', { class: 'sb-eq-iconbtn sb-eq-close', title: 'Turn off Enhanced Queue', onclick: () => chrome.storage.local.set({ enhancedQueueEnabled: false }) }, '✕')
        )
      ),
      el('div', { class: 'sb-eq-toolbar' },
        el('div', { class: 'sb-eq-search' },
          el('input', { type: 'text', placeholder: 'Search by title, ID, owner, tag, workspace…', 'data-role': 'search',
            oninput: (e) => { view.search = e.target.value.trim().toLowerCase(); render(); } })
        ),
        el('div', { class: 'sb-eq-group', 'data-role': 'severity-chips' }),
        el('div', { class: 'sb-eq-group', 'data-role': 'status-chips' }),
        el('div', { class: 'sb-eq-dd', 'data-role': 'owner-dd' },
          el('button', { class: 'sb-eq-chip sb-eq-dd-btn', 'data-role': 'owner-btn', onclick: toggleOwnerMenu }),
          el('div', { class: 'sb-eq-dd-menu', 'data-role': 'owner-menu', hidden: '',
            onkeydown: (e) => { if (e.key === 'Escape') closeOwnerMenu(); } },
            el('input', { type: 'text', placeholder: 'Search owners', 'data-role': 'owner-search',
              oninput: (e) => { ownerQuery = e.target.value.trim().toLowerCase(); render(); } }),
            el('div', { class: 'sb-eq-dd-actions' },
              el('button', { class: 'sb-eq-linkbtn', text: 'Select all', onclick: () => { view.owners = null; render(); } }),
              el('button', { class: 'sb-eq-linkbtn', text: 'Clear', onclick: () => { view.owners = new Set(); render(); } })
            ),
            el('div', { class: 'sb-eq-dd-list', 'data-role': 'owner-list' })
          )
        )
      ),
      el('div', { class: 'sb-eq-body' },
        el('table', null, el('thead', null, el('tr', { 'data-role': 'head' })), el('tbody', { 'data-role': 'rows' }))
      ),
      el('div', { class: 'sb-eq-footer' },
        el('span', { 'data-role': 'counts' }),
        el('span', { 'data-role': 'error', class: 'sb-eq-error' }),
        el('span', { class: 'sb-eq-right', 'data-role': 'updated' })
      )
    );

    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      panel.append(el('div', { class: `sb-eq-resize sb-eq-resize-${dir}`, 'data-dir': dir }));
    }

    document.documentElement.appendChild(panel);
    // Start in the right state immediately so the panel never flashes open before minimizing.
    if (startMinimized) setMinimized(true); else applyGeometry(panel, geometry || defaultGeometry());
    makeDraggable(panel, panel.querySelector('.sb-eq-header'));
    makeResizable(panel);
    updatePinButton();
    updateAutoButton();
    applyTheme();
    applySlaStyle();
  }

  // Owner filter dropdown (mirrors the native queue's "Owner : All" filter pill).
  function toggleOwnerMenu() {
    const menu = $('[data-role="owner-menu"]');
    if (!menu.hidden) { closeOwnerMenu(); return; }
    menu.hidden = false;
    ownerQuery = '';
    const search = $('[data-role="owner-search"]');
    search.value = '';
    render();
    search.focus();
  }
  function closeOwnerMenu() {
    const menu = $('[data-role="owner-menu"]');
    if (menu) menu.hidden = true;
  }
  addEventListener('mousedown', (e) => {
    const dd = $('[data-role="owner-dd"]');
    if (dd && !dd.contains(e.target)) closeOwnerMenu();
  }, true);

  function toggleOwner(owner, allOwners) {
    if (!view.owners) view.owners = new Set(allOwners);
    view.owners.has(owner) ? view.owners.delete(owner) : view.owners.add(owner);
    if (allOwners.every(o => view.owners.has(o))) view.owners = null;
    render();
  }

  function renderOwnerFilter(allOwners, counts) {
    const btn = $('[data-role="owner-btn"]');
    const sel = view.owners;
    btn.classList.toggle('sb-eq-on', !!sel);
    btn.textContent = `Owner : ${!sel ? 'All' : sel.size === 1 ? [...sel][0] : `${sel.size} selected`}`;
    btn.append(el('span', { class: 'sb-eq-dd-caret', text: '▾' }));

    if ($('[data-role="owner-menu"]').hidden) return;
    const list = $('[data-role="owner-list"]');
    const scroll = list.scrollTop;
    const shown = allOwners.filter(o => !ownerQuery || o.toLowerCase().includes(ownerQuery));
    list.replaceChildren(...shown.map(o => {
      const box = el('input', { type: 'checkbox', onchange: () => toggleOwner(o, allOwners) });
      box.checked = !sel || sel.has(o);
      return el('label', { class: 'sb-eq-dd-item', title: o },
        box, el('span', { class: 'sb-eq-dd-name', text: o }), el('span', { class: 'sb-eq-count', text: String(counts[o] || 0) }));
    }));
    if (!shown.length) list.append(el('div', { class: 'sb-eq-dd-none', text: 'No owners match' }));
    list.scrollTop = scroll;
  }

  // Follow the portal's light/dark theme by measuring its page background (the portal shell
  // doesn't expose Fluent tokens in this frame). Re-checked periodically for theme switches.
  function portalIsDark() {
    for (const node of [document.body, document.documentElement]) {
      if (!node) continue;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(node).backgroundColor);
      if (!m || m[4] === '0') continue;
      const [r, g, b] = [m[1], m[2], m[3]].map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
    }
    return false;
  }
  function applyTheme() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const dark = portalIsDark();
    if (panel.classList.contains('sb-eq-dark') !== dark) panel.classList.toggle('sb-eq-dark', dark);
  }
  setInterval(applyTheme, 2000);

  // Auto-refresh every 30s, like Sentinel. While the native queue is on screen its
  // "Auto-refresh incidents" toggle is the source of truth; elsewhere our own preference is used.
  const AUTO_REFRESH_MS = 30000;
  let autoRefreshPref = true;
  const nativeAutoToggle = () => document.querySelector('button[aria-label="Auto-refresh incidents"]');
  function autoRefreshOn() {
    const t = nativeAutoToggle();
    return t ? t.getAttribute('aria-pressed') === 'true' : autoRefreshPref;
  }
  function toggleAutoRefresh() {
    const t = nativeAutoToggle();
    if (t) {
      t.click(); // keep Sentinel's toggle and ours in sync
      setTimeout(updateAutoButton, 250);
    } else {
      autoRefreshPref = !autoRefreshPref;
      chrome.storage.local.set({ enhancedQueueAutoRefresh: autoRefreshPref });
      updateAutoButton();
    }
  }
  function updateAutoButton() {
    const btn = $('[data-role="auto"]');
    if (!btn) return;
    const on = autoRefreshOn();
    btn.classList.toggle('sb-eq-auto-on', on);
    btn.textContent = on ? 'Auto 30s' : 'Auto off';
    btn.title = (on ? 'Auto-refreshing every 30 seconds' : 'Auto-refresh is off') +
      (nativeAutoToggle() ? ' (follows Sentinel\'s "Auto-refresh incidents" toggle)' : '') + ' — click to toggle';
  }
  const autoTimer = setInterval(async () => {
    // Extension reloaded/updated: this copy can't reach it any more ("Extension context invalidated").
    if (!chrome.runtime?.id) { clearInterval(autoTimer); return; }
    if (!active) return;
    updateAutoButton();
    if (!autoRefreshOn() || !canFetch()) return;
    // Hidden tabs normally don't refresh. With notifications on, exactly one portal tab (picked by
    // the service worker) keeps refreshing in the background so alerts still arrive while you're
    // elsewhere, without every open portal tab polling.
    if (document.hidden && !(notifyPrefs.enabled && await isNotifierTab())) return;
    // Sentinel's own refresh also triggers a fetch via "batch seen"; don't double up.
    if (!inFlight && Date.now() - lastFetchAt >= AUTO_REFRESH_MS - 1000) scheduleFetch('auto-refresh', true);
  }, 5000);

  function isNotifierTab() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'eq-notifier' }, (res) => {
        void chrome.runtime.lastError;
        resolve(!!res?.notifier);
      });
    });
  }

  function removePanel() { document.getElementById(PANEL_ID)?.remove(); }

  function setMinimized(minimized) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.toggle('sb-eq-minimized', minimized);
    const btn = $('[data-role="minimize"]');
    btn.textContent = minimized ? '▢' : '–';
    btn.title = minimized ? 'Restore' : 'Minimize';
    if (minimized) {
      placeMinimized(panel);
    } else {
      applyGeometry(panel, geometry || defaultGeometry());
    }
  }
  const isMinimized = () => !!document.getElementById(PANEL_ID)?.classList.contains('sb-eq-minimized');
  // A user's own minimize/restore is remembered; pinned panels reopen that way in new tabs/page loads.
  function toggleMinimize() {
    const minimized = !isMinimized();
    setMinimized(minimized);
    chrome.storage.local.set({ enhancedQueueMinimized: minimized });
  }
  // Unpinned panels get out of the way (minimize) when the portal navigates or an incident opens.
  function autoMinimize() { if (!pinned) setMinimized(true); }

  function togglePin() {
    pinned = !pinned;
    chrome.storage.local.set({ enhancedQueuePinned: pinned });
    updatePinButton();
  }
  function updatePinButton() {
    const btn = $('[data-role="pin"]');
    if (!btn) return;
    btn.classList.toggle('sb-eq-pin-on', pinned);
    btn.title = pinned
      ? 'Pinned: stays open while you navigate (click to unpin)'
      : 'Unpinned: minimizes when you navigate or open an incident (click to pin)';
  }

  // Geometry is kept in left/top/width/height so drag and resize from any edge behave predictably.
  const MIN_W = 520, MIN_H = 240;
  function defaultGeometry() {
    const width = Math.min(1240, innerWidth - 32);
    const height = Math.round(innerHeight * 0.7);
    return { left: Math.round((innerWidth - width) / 2), top: innerHeight - height - 16, width, height };
  }
  function clampGeometry(g) {
    const width = Math.max(MIN_W, Math.min(g.width, innerWidth));
    const height = Math.max(MIN_H, Math.min(g.height, innerHeight));
    const left = Math.max(0, Math.min(g.left, innerWidth - width));
    const top = Math.max(0, Math.min(g.top, innerHeight - height));
    return { left, top, width, height };
  }
  function applyGeometry(panel, g) {
    const c = clampGeometry(g);
    Object.assign(panel.style, { left: `${c.left}px`, top: `${c.top}px`, width: `${c.width}px`, height: `${c.height}px` });
    return c;
  }
  function currentGeometry(panel) {
    const r = panel.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: geometry?.height ?? r.height };
  }
  function saveGeometry(g) {
    geometry = g;
    chrome.storage.local.set({ enhancedQueueGeometry: g });
  }

  // The minimized bar's spot: bottom centre by default; once dragged, remembered as its centre (fraction
  // of the window width) and distance from the bottom, so it stays put sensibly when the window resizes.
  function placeMinimized(panel) {
    const r = panel.getBoundingClientRect(); // minimized size (class already applied)
    const cx = miniPos ? miniPos.cx : 0.5;
    const bottom = miniPos ? miniPos.bottom : 16;
    const left = Math.max(0, Math.min(cx * innerWidth - r.width / 2, innerWidth - r.width));
    const top = Math.max(0, Math.min(innerHeight - bottom - r.height, innerHeight - r.height));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }
  function saveMiniPos(panel) {
    const r = panel.getBoundingClientRect();
    miniPos = { cx: (r.left + r.width / 2) / innerWidth, bottom: Math.max(0, innerHeight - r.bottom) };
    chrome.storage.local.set({ enhancedQueueMiniPos: miniPos });
  }
  function normalizeMiniPos(p) {
    return p && Number.isFinite(p.cx) && Number.isFinite(p.bottom)
      ? { cx: Math.min(1, Math.max(0, p.cx)), bottom: Math.max(0, p.bottom) } : null;
  }

  // Track a mouse gesture with listeners that only exist while the button is held.
  function trackPointer(e, onMove, onEnd) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const move = (ev) => onMove(ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      removeEventListener('mousemove', move, true);
      removeEventListener('mouseup', up, true);
      document.documentElement.classList.remove('sb-eq-dragging');
      onEnd();
    };
    document.documentElement.classList.add('sb-eq-dragging');
    addEventListener('mousemove', move, true);
    addEventListener('mouseup', up, true);
  }

  function makeDraggable(panel, handle) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const start = currentGeometry(panel);
      let g = start;
      trackPointer(e, (dx, dy) => {
        const r = panel.getBoundingClientRect();
        g = { ...start, left: start.left + dx, top: start.top + dy };
        // Clamp against the rendered height so a minimized bar can still reach the bottom edge.
        g.left = Math.max(0, Math.min(g.left, innerWidth - r.width));
        g.top = Math.max(0, Math.min(g.top, innerHeight - r.height));
        panel.style.left = `${g.left}px`;
        panel.style.top = `${g.top}px`;
      }, () => { if (isMinimized()) saveMiniPos(panel); else saveGeometry(g); });
    });
  }

  function makeResizable(panel) {
    panel.querySelectorAll('.sb-eq-resize').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const dir = handle.dataset.dir;
        const start = currentGeometry(panel);
        let g = start;
        trackPointer(e, (dx, dy) => {
          g = { ...start };
          if (dir.includes('e')) g.width = Math.max(MIN_W, start.width + dx);
          if (dir.includes('s')) g.height = Math.max(MIN_H, start.height + dy);
          if (dir.includes('w')) {
            g.width = Math.max(MIN_W, start.width - dx);
            g.left = start.left + (start.width - g.width);
          }
          if (dir.includes('n')) {
            g.height = Math.max(MIN_H, start.height - dy);
            g.top = start.top + (start.height - g.height);
          }
          g = applyGeometry(panel, g);
        }, () => saveGeometry(g));
      });
    });
  }

  addEventListener('resize', () => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (isMinimized()) setMinimized(true);
    else applyGeometry(panel, geometry || defaultGeometry());
  });

  function setBusy(busy) {
    const btn = $('[data-role="refresh"]');
    if (!btn) return;
    btn.replaceChildren(busy ? el('span', { class: 'sb-eq-spin', text: '⟳' }) : '⟳');
  }

  function renderSeverityCell(it) {
    const sev = severityOf(it);
    return el('span', { class: 'sb-eq-sev' },
      el('span', { class: `sb-eq-sev-bar sb-eq-sev-${sev.toLowerCase()}` }),
      el('span', { text: sev })
    );
  }
  function renderStatusCell(it) {
    const st = statusOf(it);
    return el('span', { class: `sb-eq-status sb-eq-status-${st.toLowerCase()}`, text: st });
  }
  function renderSlaCell(it) {
    const info = slaInfo(it);
    if (!info) return '';
    return el('span', { class: `sb-eq-sla-text sb-eq-sla-text-${info.state}`,
      text: info.remaining > 0 ? `${formatDuration(info.remaining)} left` : `Breached ${formatDuration(info.remaining)} ago` });
  }
  function renderTagsCell(it) {
    const frag = document.createDocumentFragment();
    tagsOf(it).forEach(t => frag.append(el('span', { class: 'sb-eq-tag', text: t })));
    return frag;
  }

  function renderChips(container, values, selected, counts, colorFor) {
    container.replaceChildren();
    values.forEach(v => {
      const chip = el('button', { class: `sb-eq-chip${selected.has(v) ? ' sb-eq-on' : ''}`,
        onclick: () => { selected.has(v) ? selected.delete(v) : selected.add(v); render(); } },
        colorFor ? el('span', { class: 'sb-eq-dot', style: `background:${colorFor(v)}` }) : null,
        v,
        el('span', { class: 'sb-eq-count', text: String(counts[v] || 0) })
      );
      container.append(chip);
    });
  }

  const SEV_COLORS = { High: 'rgb(197,15,31)', Medium: 'rgb(255,170,68)', Low: 'rgb(252,224,0)', Informational: 'rgb(194,194,194)' };

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || dragCol) return; // rebuilding the header mid-drag would cancel the drag

    const visibleBase = items.filter(it => view.showFiltered || !(filters.removeMatches && matchesSentiBuddyFilters(it)));
    const filteredCount = items.length - items.filter(it => !(filters.removeMatches && matchesSentiBuddyFilters(it))).length;

    const sevOk = (it) => !view.severities.size || view.severities.has(severityOf(it));
    const statusOk = (it) => !view.statuses.size || view.statuses.has(statusOf(it));
    const ownerOk = (it) => !view.owners || view.owners.has(ownerOf(it));
    const searchOk = (it) => !view.search || [props(it).title, getIncidentNumber(it), ownerOf(it), statusOf(it), severityOf(it),
      tagsOf(it).join(' '), workspaceOf(it), productsOf(it)].join(' ').toLowerCase().includes(view.search);

    // Faceted counts: each filter counts what the *other* active filters (and search) leave,
    // so "High 12" means 12 Highs would show with the current status/owner filters and search.
    const sevCounts = {}, statusCounts = {}, ownerCounts = {};
    const bump = (counts, k) => { counts[k] = (counts[k] || 0) + 1; };
    visibleBase.forEach(it => {
      if (!searchOk(it)) return;
      const sev = sevOk(it), st = statusOk(it), own = ownerOk(it);
      if (st && own) bump(sevCounts, severityOf(it));
      if (sev && own) bump(statusCounts, statusOf(it));
      if (sev && st) bump(ownerCounts, ownerOf(it));
    });
    const statusValues = ['New', 'Active', 'Closed'];
    renderChips($('[data-role="severity-chips"]'), SEVERITIES, view.severities, sevCounts, s => SEV_COLORS[s]);
    renderChips($('[data-role="status-chips"]'), statusValues, view.statuses, statusCounts);

    // Unassigned first, then alphabetical; keep selected owners listed even if they've left the data.
    const owners = new Set([...visibleBase.map(ownerOf), ...(view.owners || [])]);
    const allOwners = [...owners].sort((a, b) =>
      (b === 'Unassigned') - (a === 'Unassigned') || a.localeCompare(b, undefined, { sensitivity: 'base' }));
    renderOwnerFilter(allOwners, ownerCounts);

    const rows = visibleBase.filter(it => sevOk(it) && statusOk(it) && ownerOk(it) && searchOk(it));

    const columns = resolveColumns();
    if (view.sortKey && columns.includes(view.sortKey)) {
      const sortFn = COLUMN_DEFS[view.sortKey].sort;
      rows.sort((a, b) => {
        const va = sortFn(a), vb = sortFn(b);
        return (va > vb ? 1 : va < vb ? -1 : 0) * view.sortDir;
      });
    }

    const head = $('[data-role="head"]');
    head.replaceChildren(...columns.map(key => renderHeaderCell(key)));

    const tbody = $('[data-role="rows"]');
    const slaCounts = { warn: 0, breach: 0 };
    if (!rows.length) {
      tbody.replaceChildren(el('tr', null, el('td', { colspan: String(columns.length) }, emptyState())));
    } else {
      const frag = document.createDocumentFragment();
      rows.forEach(it => {
        const key = incidentKey(it);
        const slaState = slaInfo(it)?.state;
        if (slaState in slaCounts) slaCounts[slaState]++;
        const tr = el('tr', {
          class: [key === selectedKey ? 'sb-eq-selected' : '', filters.removeMatches && matchesSentiBuddyFilters(it) ? 'sb-eq-filtered' : '',
            slaState in slaCounts ? `sb-eq-sla-${slaState}` : ''].join(' ').trim(),
          title: 'Click to open in the Sentinel queue • Ctrl+click to open in a new tab',
          onclick: (e) => onRowClick(e, it)
        });
        columns.forEach(colKey => {
          const def = COLUMN_DEFS[colKey];
          const td = el('td', { class: `sb-eq-col-${colKey}` });
          if (def.cell) td.append(def.cell(it));
          else {
            const txt = def.text(it);
            td.textContent = txt;
            td.title = txt;
          }
          tr.append(td);
        });
        frag.append(tr);
      });
      tbody.replaceChildren(frag);
    }

    const counts = $('[data-role="counts"]');
    counts.replaceChildren(
      el('span', { class: 'sb-eq-total', text: `Showing ${rows.length} of ${items.length} incidents` }),
      filteredCount ? ' • ' : '',
      filteredCount ? el('button', { class: 'sb-eq-linkbtn', onclick: () => { view.showFiltered = !view.showFiltered; render(); },
        text: view.showFiltered ? `Hide ${filteredCount} filtered by SentiBuddy` : `${filteredCount} hidden by SentiBuddy filters` }) : '',
      slaCounts.breach ? ' • ' : '',
      slaCounts.breach ? el('span', { class: 'sb-eq-sla-text-breach', text: `${slaCounts.breach} past SLA` }) : '',
      slaCounts.warn ? ' • ' : '',
      slaCounts.warn ? el('span', { class: 'sb-eq-sla-text-warn', text: `${slaCounts.warn} approaching SLA` }) : '',
      columnOrder ? ' • ' : '',
      columnOrder ? el('button', { class: 'sb-eq-linkbtn', text: 'Reset column order', onclick: resetColumnOrder }) : '',
      truncated ? ' • list capped, narrow the portal time range' : ''
    );
    $('[data-role="error"]').textContent = lastError;
    $('[data-role="updated"]').textContent = lastFetchAt ? `Updated ${new Date(lastFetchAt).toLocaleTimeString()}` : '';

    const wsCount = getEnabledCtxs().length;
    $('[data-role="subtitle"]').textContent = items.length
      ? `${rows.length} incidents across ${wsCount} workspace${wsCount === 1 ? '' : 's'}, ${items.length} filtered`
      : (armToken ? 'Loading incidents…' : 'Waiting for the portal…');
  }

  // Header cells sort on click and reorder by drag and drop (HTML5 DnD; no click fires after a drag).
  function renderHeaderCell(key) {
    const def = COLUMN_DEFS[key];
    const dropAfter = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      return e.clientX > r.left + r.width / 2;
    };
    const clearMarks = (th) => th.classList.remove('sb-eq-drop-before', 'sb-eq-drop-after');
    return el('th', {
      draggable: 'true',
      title: 'Click to sort • Drag to reorder columns',
      onclick: () => {
        if (view.sortKey === key) view.sortDir = -view.sortDir;
        else { view.sortKey = key; view.sortDir = def.defaultDir || -1; }
        render();
      },
      ondragstart: (e) => {
        dragCol = key;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
        e.currentTarget.classList.add('sb-eq-th-dragging');
      },
      ondragover: (e) => {
        if (!dragCol || dragCol === key) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const after = dropAfter(e);
        e.currentTarget.classList.toggle('sb-eq-drop-after', after);
        e.currentTarget.classList.toggle('sb-eq-drop-before', !after);
      },
      ondragleave: (e) => clearMarks(e.currentTarget),
      ondrop: (e) => {
        e.preventDefault();
        clearMarks(e.currentTarget);
        const from = dragCol;
        dragCol = null;
        if (from && from !== key) moveColumn(from, key, dropAfter(e));
      },
      ondragend: () => { dragCol = null; render(); }
    }, def.label, view.sortKey === key ? el('span', { class: 'sb-eq-sort', text: view.sortDir < 0 ? '▼' : '▲' }) : null);
  }

  function emptyState() {
    if (!armToken || ctxMap.size === 0) {
      return el('div', { class: 'sb-eq-empty' },
        el('strong', { text: 'Waiting for the Sentinel incident queue' }),
        'Open (or refresh) the Sentinel Incidents page and the full list will load here automatically.');
    }
    if (inFlight && !items.length) return el('div', { class: 'sb-eq-empty' }, el('strong', { text: 'Loading incidents…' }));
    return el('div', { class: 'sb-eq-empty' }, el('strong', { text: 'No incidents match' }), 'Try clearing the search or filter chips.');
  }

  // 10) Open an incident: its row on the native queue's current page if visible (side pane),
  //     otherwise the full incident details page. No paging: walking the portal's pager is slow
  //     and the incident may not be in the native view at all.
  // Opens the incident in whichever experience the user last opened one in (playbooks/top.js records
  // it from the URL): the new React page, or the old CaseBlade.
  let incidentView = 'new';
  chrome.storage.local.get({ incidentViewPreference: 'new' }, (s) => { incidentView = s.incidentViewPreference; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.incidentViewPreference) incidentView = changes.incidentViewPreference.newValue;
  });
  function incidentDeepLink(it) {
    if (!it.id) return '';
    const id = encodeURIComponent(it.id);
    return incidentView === 'old'
      ? `https://portal.azure.com/#view/Microsoft_Azure_Security_Insights/CaseBlade/id/${id}`
      : `https://portal.azure.com/#view/Microsoft_Azure_Security_Insights/IncidentPage.ReactView/incidentArmId/${id}`;
  }

  function onRowClick(e, it) {
    if (e.ctrlKey || e.metaKey) {
      const link = incidentDeepLink(it);
      if (link) window.open(link, '_blank', 'noopener');
      return;
    }
    selectedKey = incidentKey(it);
    render();
    openInNativeQueue(it);
  }

  function nativeHeaderIndex() {
    const idx = {};
    readNativeHeaders().forEach((h, i) => { idx[normalizeHeader(h)] = i; });
    return idx;
  }

  function findNativeRow(it) {
    const idx = nativeHeaderIndex();
    if (idx.incidentnumber == null) return null;
    const num = String(getIncidentNumber(it) ?? '');
    const ws = workspaceOf(it).toLowerCase();
    for (const row of document.querySelectorAll('.fxc-gc-row-content.fxc-gc-row-content_0')) {
      const cells = row.querySelectorAll('[id^="fxc-gc-cell-content"]');
      if (cells[idx.incidentnumber]?.textContent.trim() !== num) continue;
      if (idx.workspace != null && cells[idx.workspace] && ws &&
          !cells[idx.workspace].textContent.trim().toLowerCase().includes(ws)) continue;
      return { row, cell: cells[idx.title] || cells[idx.incidentnumber] };
    }
    return null;
  }

  // The grid may only render rows near the viewport, so scroll through the page too (bounded).
  async function findOnCurrentPage(it, token) {
    let hit = findNativeRow(it);
    if (hit) return hit;
    const root = document.querySelector('.ext-gridControl-container');
    const scroller = root && [root, ...root.querySelectorAll('*')].find(n => n.scrollHeight > n.clientHeight + 20 &&
      /(auto|scroll)/.test(getComputedStyle(n).overflowY));
    if (!scroller) return null;
    const start = scroller.scrollTop;
    const step = Math.max(200, scroller.clientHeight * 0.8);
    for (let i = 0, y = 0; i < 25 && y <= scroller.scrollHeight; i++, y += step) {
      if (token !== navToken) return null;
      scroller.scrollTop = y;
      await delay(80);
      hit = findNativeRow(it);
      if (hit) return hit;
    }
    scroller.scrollTop = start;
    return null;
  }

  function clickNative(hit) {
    hit.row.scrollIntoView({ block: 'center' });
    const target = hit.cell || hit.row;
    for (const type of ['mousedown', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function openInNativeQueue(it) {
    const token = ++navToken;
    const num = getIncidentNumber(it);
    setNavStatus(`Locating incident ${num} in the queue…`);

    const hit = await findOnCurrentPage(it, token);
    if (token !== navToken) return;

    if (hit) {
      clickNative(hit);
      setNavStatus('');
      autoMinimize();
      return;
    }
    const link = incidentDeepLink(it);
    if (!link) {
      setNavStatus(`Couldn't open incident ${num}: no resource ID.`);
      return;
    }
    setNavStatus('');
    // Leaving the queue page for the incident's own page: remember where we were so the panel can
    // offer a way back.
    if (!returnHash) returnHash = location.hash;
    location.hash = new URL(link).hash; // hash-only: the portal routes without reloading
    updateBackButton();
  }

  // "↩ Back to queue": shown after opening an incident page from the panel, until the user is back.
  let returnHash = null;
  function backToQueue() {
    if (!returnHash) return;
    const target = returnHash;
    returnHash = null;
    location.hash = target;
    updateBackButton();
  }
  function updateBackButton() {
    if (returnHash && location.hash === returnHash) returnHash = null;
    const btn = $('[data-role="back"]');
    if (btn) btn.hidden = !returnHash;
  }

  function setNavStatus(message, link) {
    const errEl = $('[data-role="error"]');
    if (!errEl) return;
    errEl.replaceChildren(message || lastError);
    if (link) {
      errEl.append(' ', el('button', { class: 'sb-eq-linkbtn', text: 'Open in new tab',
        onclick: () => window.open(link, '_blank', 'noopener') }));
    }
  }

  // 11) Activation
  function activate() {
    if (active) return;
    active = true;
    chrome.storage.local.get({ enhancedQueuePinned: false, enhancedQueueMinimized: false, enhancedQueueGeometry: null,
      enhancedQueueMiniPos: null, enhancedQueueAutoRefresh: true, enhancedQueueColumnOrder: null, slaSettings: null }, (s) => {
      pinned = !!s.enhancedQueuePinned;
      miniPos = normalizeMiniPos(s.enhancedQueueMiniPos);
      // Each page load (new tab, ADX, a past incident…) is like navigating: unpinned panels start
      // minimized to the floating widget; pinned ones restore the user's last minimize/restore.
      const startMinimized = !pinned || !!s.enhancedQueueMinimized;
      geometry = s.enhancedQueueGeometry;
      autoRefreshPref = s.enhancedQueueAutoRefresh !== false;
      columnOrder = normalizeColumnOrder(s.enhancedQueueColumnOrder);
      sla = normalizeSla(s.slaSettings);
      loadFilters(() => {
        if (!active) return;
        createPanel(startMinimized);
        render();
        scheduleFetch('activated', true);
      });
    });
  }

  // The portal routes via the URL hash (e.g. opening an incident's full details page), often
  // through history.pushState which doesn't fire hashchange, so also poll.
  let lastHash = location.hash;
  function checkRoute() {
    if (location.hash === lastHash) return;
    lastHash = location.hash;
    if (active) {
      autoMinimize();
      updateBackButton();
    }
  }
  addEventListener('hashchange', checkRoute);
  setInterval(checkRoute, 500);
  function deactivate() {
    active = false;
    navToken++;
    clearTimeout(fetchDebounceTimer);
    removePanel();
  }

  function whenBodyReady(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  chrome.storage.local.get({ enhancedQueueEnabled: true }, (s) => {
    if (s.enhancedQueueEnabled) whenBodyReady(activate);
  });

  // Alt+Q toggles the Enhanced Queue (React iframes forward the same key via playbooks/frame.js).
  addEventListener('keydown', (e) => {
    if (!e.isTrusted || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyQ') return;
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'toggle-enhanced-queue' }, () => void chrome.runtime.lastError);
  }, true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enhancedQueueEnabled) {
      if (changes.enhancedQueueEnabled.newValue) whenBodyReady(activate);
      else deactivate();
    }
    if (active && (changes.filterTitleRegexPatterns || changes.filterTagsRegexPatterns ||
        changes.filterOwnerRegexPatterns || changes.doRemoveFromFilteredFromQueue ||
        changes.desktopNotifications || changes.notifyOnMatchesOnly || changes.notificationRules ||
        changes.workspaceClientPattern)) {
      loadFilters(render);
    }
    if (changes.slaSettings) {
      sla = normalizeSla(changes.slaSettings.newValue);
      applySlaStyle();
      render();
    }
    // Pin is a shared preference: keep every open portal tab in step with the one it was changed in.
    if (changes.enhancedQueuePinned) {
      pinned = !!changes.enhancedQueuePinned.newValue;
      updatePinButton();
    }
  });

  // SLA states change with the clock, not just with data, so re-render while SLAs are configured.
  setInterval(() => {
    if (active && sla.enabled && !document.hidden && !isMinimized()) render();
  }, 30000);
})();
