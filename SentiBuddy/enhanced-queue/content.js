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

  // 1) Inject page hook immediately (same as NewFeedTest)
  (function inject() {
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
  const ctxMap = new Map(); // key -> { subId, rg, workspace, enabled, lastSeen }

  // Shared with escalate/top.js (same isolated world; never exposed to the page).
  globalThis.SentiBuddyArmAuth = () => ({ token: armToken, auxHeader });

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
  const view = {
    // Defaults: open work only, Informational hidden. Chips still let the user add them back.
    search: '',
    severities: new Set(['High', 'Medium', 'Low']),
    statuses: new Set(['New', 'Active']),
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
  }
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

    if (msg.__armAuth === true && BEARER_RE.test(msg.token || '')) armToken = msg.token;
    if (msg.__armAux === true) {
      const tokens = Array.isArray(msg.tokens) ? msg.tokens.filter(t => BEARER_RE.test(t)) : [];
      auxTokens = tokens;
      auxHeader = tokens.length ? tokens.join(', ') : null;
    }
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
    if (!armToken || ctxMap.size === 0) {
      dlog('Fetch skipped: token?', !!armToken, 'workspaces=', ctxMap.size);
      render();
      return;
    }

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

  const COLUMN_DEFS = {
    severity:             { label: 'Severity', sort: it => SEVERITY_ORDER[severityOf(it)] || 0, cell: renderSeverityCell },
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
    workspace:            { label: 'Workspace', sort: workspaceOf, text: workspaceOf }
  };
  const DEFAULT_COLUMNS = ['severity', 'incidentnumber', 'title', 'alerts', 'incidentprovidername', 'alertproductname',
    'createdtime', 'lastupdatetime', 'owner', 'status', 'tags'];

  const normalizeHeader = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function readNativeHeaders() {
    return [...document.querySelectorAll('.fxc-gc-columnheader-content.fxc-gc-text')].map(h => h.textContent.trim());
  }

  // Use the live Sentinel grid's column order when it's on screen.
  function resolveColumns() {
    const live = readNativeHeaders().map(normalizeHeader).filter(k => COLUMN_DEFS[k]);
    const cols = live.length ? [...new Set(live)] : [...DEFAULT_COLUMNS];
    const multiWorkspace = new Set(items.map(workspaceOf)).size > 1;
    if (multiWorkspace && !cols.includes('workspace')) cols.splice(Math.min(3, cols.length), 0, 'workspace');
    return cols;
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
      doRemoveFromFilteredFromQueue: true
    }, (s) => {
      filters = {
        title: s.filterTitleRegexPatterns || [],
        tags: s.filterTagsRegexPatterns || [],
        owner: s.filterOwnerRegexPatterns || [],
        removeMatches: s.doRemoveFromFilteredFromQueue
      };
      cb?.();
    });
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

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = el('div', { id: PANEL_ID },
      el('div', { class: 'sb-eq-header' },
        el('div', { class: 'sb-eq-logo', text: '\u{1F6E1}' }),
        el('div', null,
          el('div', { class: 'sb-eq-title', text: 'Enhanced Queue' }),
          el('div', { class: 'sb-eq-subtitle', 'data-role': 'subtitle', text: 'Waiting for incidents…' })
        ),
        el('div', { class: 'sb-eq-header-actions' },
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
        el('div', { class: 'sb-eq-group', 'data-role': 'status-chips' })
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
    applyGeometry(panel, geometry || defaultGeometry());
    makeDraggable(panel, panel.querySelector('.sb-eq-header'));
    makeResizable(panel);
    updatePinButton();
    updateAutoButton();
    applyTheme();
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
  setInterval(() => {
    if (!active) return;
    updateAutoButton();
    if (document.hidden || !autoRefreshOn()) return;
    // Sentinel's own refresh also triggers a fetch via "batch seen"; don't double up.
    if (!inFlight && Date.now() - lastFetchAt >= AUTO_REFRESH_MS - 1000) scheduleFetch('auto-refresh', true);
  }, 5000);

  function removePanel() { document.getElementById(PANEL_ID)?.remove(); }

  function setMinimized(minimized) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.toggle('sb-eq-minimized', minimized);
    const btn = $('[data-role="minimize"]');
    btn.textContent = minimized ? '▢' : '–';
    btn.title = minimized ? 'Restore' : 'Minimize';
    if (minimized) {
      panel.style.left = `16px`;
      panel.style.top = `${Math.max(0, innerHeight - 50)}px`;
    } else {
      applyGeometry(panel, geometry || defaultGeometry());
    }
  }
  const isMinimized = () => !!document.getElementById(PANEL_ID)?.classList.contains('sb-eq-minimized');
  function toggleMinimize() {
    setMinimized(!document.getElementById(PANEL_ID)?.classList.contains('sb-eq-minimized'));
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
    return { left: innerWidth - width - 16, top: innerHeight - height - 16, width, height };
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
      }, () => { if (!isMinimized()) saveGeometry(g); });
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
    if (!panel) return;

    const visibleBase = items.filter(it => view.showFiltered || !(filters.removeMatches && matchesSentiBuddyFilters(it)));
    const filteredCount = items.length - items.filter(it => !(filters.removeMatches && matchesSentiBuddyFilters(it))).length;

    const sevOk = (it) => !view.severities.size || view.severities.has(severityOf(it));
    const statusOk = (it) => !view.statuses.size || view.statuses.has(statusOf(it));
    const searchOk = (it) => !view.search || [props(it).title, getIncidentNumber(it), ownerOf(it), statusOf(it), severityOf(it),
      tagsOf(it).join(' '), workspaceOf(it), productsOf(it)].join(' ').toLowerCase().includes(view.search);

    // Faceted counts: each chip group counts what the *other* active filters (and search) leave,
    // so "High 12" means 12 Highs would show with the current status chips and search.
    const sevCounts = {}, statusCounts = {};
    visibleBase.forEach(it => {
      if (!searchOk(it)) return;
      if (statusOk(it)) sevCounts[severityOf(it)] = (sevCounts[severityOf(it)] || 0) + 1;
      if (sevOk(it)) statusCounts[statusOf(it)] = (statusCounts[statusOf(it)] || 0) + 1;
    });
    const sevValues = ['High', 'Medium', 'Low', 'Informational'];
    const statusValues = ['New', 'Active', 'Closed'];
    renderChips($('[data-role="severity-chips"]'), sevValues, view.severities, sevCounts, s => SEV_COLORS[s]);
    renderChips($('[data-role="status-chips"]'), statusValues, view.statuses, statusCounts);

    const rows = visibleBase.filter(it => sevOk(it) && statusOk(it) && searchOk(it));

    const columns = resolveColumns();
    if (view.sortKey && COLUMN_DEFS[view.sortKey]) {
      const sortFn = COLUMN_DEFS[view.sortKey].sort;
      rows.sort((a, b) => {
        const va = sortFn(a), vb = sortFn(b);
        return (va > vb ? 1 : va < vb ? -1 : 0) * view.sortDir;
      });
    }

    const head = $('[data-role="head"]');
    head.replaceChildren(...columns.map(key => el('th', {
      onclick: () => {
        if (view.sortKey === key) view.sortDir = -view.sortDir;
        else { view.sortKey = key; view.sortDir = -1; }
        render();
      }
    }, COLUMN_DEFS[key].label, view.sortKey === key ? el('span', { class: 'sb-eq-sort', text: view.sortDir < 0 ? '▼' : '▲' }) : null)));

    const tbody = $('[data-role="rows"]');
    if (!rows.length) {
      tbody.replaceChildren(el('tr', null, el('td', { colspan: String(columns.length) }, emptyState())));
    } else {
      const frag = document.createDocumentFragment();
      rows.forEach(it => {
        const key = incidentKey(it);
        const tr = el('tr', {
          class: [key === selectedKey ? 'sb-eq-selected' : '', filters.removeMatches && matchesSentiBuddyFilters(it) ? 'sb-eq-filtered' : ''].join(' ').trim(),
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
      truncated ? ' • list capped, narrow the portal time range' : ''
    );
    $('[data-role="error"]').textContent = lastError;
    $('[data-role="updated"]').textContent = lastFetchAt ? `Updated ${new Date(lastFetchAt).toLocaleTimeString()}` : '';

    const wsCount = getEnabledCtxs().length;
    $('[data-role="subtitle"]').textContent = items.length
      ? `${rows.length} incidents across ${wsCount} workspace${wsCount === 1 ? '' : 's'}, ${items.length} filtered`
      : (armToken ? 'Loading incidents…' : 'Waiting for the portal…');
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
  function incidentDeepLink(it) {
    return it.id ? `https://portal.azure.com/#view/Microsoft_Azure_Security_Insights/IncidentPage.ReactView/incidentArmId/${encodeURIComponent(it.id)}` : '';
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
    location.hash = new URL(link).hash; // hash-only: the portal routes without reloading
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
    chrome.storage.local.get({ enhancedQueuePinned: false, enhancedQueueGeometry: null, enhancedQueueAutoRefresh: true }, (s) => {
      pinned = !!s.enhancedQueuePinned;
      geometry = s.enhancedQueueGeometry;
      autoRefreshPref = s.enhancedQueueAutoRefresh !== false;
      loadFilters(() => {
        if (!active) return;
        createPanel();
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
    if (active) autoMinimize();
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

  chrome.storage.local.get({ enhancedQueueEnabled: false }, (s) => {
    if (s.enhancedQueueEnabled) whenBodyReady(activate);
  });

  // Alt+Q toggles the Enhanced Queue (React iframes forward the same key via escalate/frame.js).
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
        changes.filterOwnerRegexPatterns || changes.doRemoveFromFilteredFromQueue)) {
      loadFilters(render);
    }
  });
})();
