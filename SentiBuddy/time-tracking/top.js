// Time tracking (top portal frame): tells the service worker what this tab is working on, and shows
// the small timer on the page. Replaces the old free-running page timer.
//
// The counting itself lives in the service worker (one tracker for the whole browser, so several
// portal tabs can never double-count): it tracks the portal context the user was most recently on
// and keeps counting while they work elsewhere (another site, notes in another app) unless
// "Auto-pause when I leave the portal tab" is on. This script only reports:
//   - this tab's context ({ ws, id, n }) whenever it changes, and
//   - that the user is on this tab ("active") whenever this tab gains focus,
// and renders live totals from the stored time plus the running stretch (timeTrackingCurrent).
(() => {
  if (window.top !== window) return;

  const WIDGET_ID = 'sb-tt';
  const WS_RE = /\/workspaces\/([^/]+)\/providers\/Microsoft\.SecurityInsights\/incidents\/([^/]+)$/i;
  // Time not on a specific incident still counts for the client: it's stored under this id.
  const WORKSPACE_ONLY = '_workspace';
  // Any other portal page (home, the multi-workspace queue, other services) counts as general portal time.
  const GENERAL = { ws: '_portal', id: '_general', n: null };

  // experimental: the timer widget is an experimental feature; time is reported (and counted) either way.
  let prefs = { enabled: false, experimental: false, paused: false, idle: false, visible: true };
  let stored = { days: {} };
  let current = null; // the service worker's running target: { tabId, ws, id, n, since }
  let awayNotice = null; // { ws, id, ms, at }: time counted while the user was away from this tab
  // From the popup (timeTrackingLabels): { codeLabel, byWorkspace: { ws: { client, code } } }. The page
  // can't map workspaces to clients or codes itself, so the timer shows what the popup worked out.
  let labels = { codeLabel: 'Code', byWorkspace: {} };
  const AWAY_NOTICE_MS = 7000; // how long the "+time" stays up after coming back
  let expanded = false;
  let lastSent = '';
  let wasFocused = false;

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // What this tab is working on: { ws, id, n }.
  //   - an incident page (old or new experience): workspace + incident id from the URL, number from
  //     the blade header ("Incident number N")
  //   - otherwise any page for a single workspace (Sentinel queue/hunting, Log Analytics Logs, …): the
  //     workspace from the URL or the blade header, with id WORKSPACE_ONLY, or the incident's id when
  //     Logs was opened from an incident
  //   - an Azure Data Explorer cluster page: ws "adx.<cluster>" (mapped to a client in the popup)
  //   - GENERAL when no single workspace can be told (e.g. a multi-workspace queue or query, other pages)
  function currentContext() {
    const inc = typeof globalThis.SentiBuddyCurrentIncident === 'function' ? globalThis.SentiBuddyCurrentIncident() : null;
    const m = inc && WS_RE.exec(inc.id);
    if (m) {
      let n = null;
      for (const el of document.querySelectorAll('.fxs-blade-title-subtitleText')) {
        const hit = /^Incident number (\d+)$/i.exec((el.textContent || '').trim());
        if (hit) n = hit[1];
      }
      return { ws: m[1].toLowerCase(), id: m[2].toLowerCase(), n };
    }
    const hash = decodedHash();
    const ws = currentWorkspace(hash);
    if (ws) {
      const fromIncident = /"incidentResourceName"\s*:\s*"([0-9a-f-]{36})"/i.exec(hash)?.[1];
      return { ws, id: fromIncident ? fromIncident.toLowerCase() : WORKSPACE_ONLY, n: null };
    }
    const cluster = /\/providers\/Microsoft\.Kusto\/clusters\/([a-z][a-z0-9-]{3,21})(?=[/?#&"]|$)/i.exec(hash)?.[1];
    return cluster ? { ws: `${ADX_PREFIX}${cluster.toLowerCase()}`, id: WORKSPACE_ONLY, n: null } : { ...GENERAL };
  }

  function decodedHash() {
    try { return decodeURIComponent(location.hash); } catch { return location.hash; }
  }

  const ADX_PREFIX = 'adx.';
  const WS_NAME_RE = /^[a-z0-9][a-z0-9\-_.()]{0,89}$/i;
  // Workspace resource ids in the URL: /workspaces/<name> (Log Analytics, also inside a Logs query's
  // JSON "scope") and /securityinsightsarg/sentinel/<name> (Sentinel menu). Several different
  // workspaces (a multi-workspace query) count as general time.
  const WS_URL_RE = /\/providers\/Microsoft\.(?:OperationalInsights\/workspaces|SecurityInsightsArg\/sentinel)\/([a-z0-9][a-z0-9\-_.()]{0,89})(?=[/?#&"'\]}\s]|$)/gi;
  function currentWorkspace(hash) {
    const fromUrl = new Set([...hash.matchAll(WS_URL_RE)].map(x => x[1].toLowerCase()));
    if (fromUrl.size === 1) return [...fromUrl][0];
    if (fromUrl.size > 1) return null;
    // The blade in front (last in the DOM): Sentinel's "Selected workspace: 'name'" subtitle, or the
    // Logs blade (title "Logs") whose subtitle is the workspace name.
    let found = null;
    for (const sub of document.querySelectorAll('.fxs-blade-title-subtitleText')) {
      const text = (sub.textContent || '').trim();
      const selected = /^Selected workspace:\s*'([^']+)'$/i.exec(text)?.[1];
      const title = sub.id ? document.querySelector(`[aria-describedby="${CSS.escape(sub.id)}"]`) : null;
      const name = selected || (/^Logs$/i.test((title?.textContent || '').trim()) ? text : null);
      if (name && WS_NAME_RE.test(name)) found = name.toLowerCase();
    }
    return found;
  }

  // After the extension is reloaded or updated, this copy keeps running in tabs that were already open
  // but can no longer reach the extension (chrome.runtime.id is gone; calls throw "Extension context
  // invalidated"). Stop and remove the widget instead; the new copy takes over when the tab reloads.
  let tickTimer = null;
  function alive() {
    if (chrome.runtime?.id) return true;
    clearInterval(tickTimer);
    document.getElementById(WIDGET_ID)?.remove();
    return false;
  }
  function send(msg) {
    if (!alive()) return;
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch {
      alive(); // invalidated between the check and the call
    }
  }

  // Report the context when it changes, and "active" when the user comes to this tab (focus within
  // this page, including its iframes).
  function report() {
    if (!prefs.enabled) return null;
    const ctx = currentContext();
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    const sig = JSON.stringify(ctx);
    const becameActive = focused && !wasFocused;
    if (sig !== lastSent || becameActive) {
      send({ type: 'tt-context', ctx, active: focused });
      lastSent = sig;
    }
    wasFocused = focused;
    return ctx;
  }

  // ---------- Totals (stored + the running stretch)
  const sameCtx = (a, b) => a && b && a.ws === b.ws && a.id === b.id;
  function totals(ctx) {
    const day = stored.days?.[today()] || {};
    let dayMs = 0;
    let wsMs = 0;
    let incMs = 0;
    for (const [ws, incidents] of Object.entries(day)) {
      for (const [id, rec] of Object.entries(incidents || {})) {
        const ms = rec?.ms || 0;
        dayMs += ms;
        if (ctx && ws === ctx.ws) wsMs += ms;
        if (ctx && ws === ctx.ws && id === ctx.id) incMs += ms;
      }
    }
    const live = current?.since ? Math.max(0, Date.now() - current.since) : 0;
    if (live) {
      dayMs += live;
      if (ctx && current.ws === ctx.ws) wsMs += live;
      if (sameCtx(current, ctx)) incMs += live;
    }
    return { dayMs, wsMs, incMs };
  }

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  // What the timer calls a workspace: its client's code when the popup has one, else the client, else the
  // workspace itself (a workspace the popup hasn't seen yet, e.g. the popup has never been opened).
  const entryOf = (ws) => (ws && labels.byWorkspace?.[ws]) || null;
  const plainWs = (ws) => (ws === GENERAL.ws ? 'General'
    : ws.startsWith(ADX_PREFIX) ? `ADX ${ws.slice(ADX_PREFIX.length)}` : ws);
  const wsLabel = (ws) => entryOf(ws)?.code || entryOf(ws)?.client || plainWs(ws);
  const wsTitle = (ws) => {
    const e = entryOf(ws);
    return e?.client && e?.code ? `${e.client} · ${e.code}` : e?.client || plainWs(ws);
  };

  // Why time is or isn't counting for this tab right now.
  function stateOf(ctx) {
    if (prefs.paused) return { key: 'paused', text: 'Paused' };
    if (prefs.idle) return { key: 'idle', text: 'Paused while you\'re away' };
    if (current && !sameCtx(current, ctx)) {
      return { key: current.since ? 'elsewhere' : 'stopped',
        text: `Tracking ${wsLabel(current.ws)} from another tab — click into this page to switch` };
    }
    if (current?.since) return { key: 'counting', text: 'Counting (keeps going while you work outside the portal)' };
    if (current) return { key: 'stopped', text: 'Auto-paused: you left this tab' };
    return { key: 'stopped', text: 'Click into this page to start counting' };
  }

  // ---------- Widget
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildWidget() {
    const w = el('div');
    w.id = WIDGET_ID;
    const main = el('button', 'sb-tt-main');
    main.type = 'button';
    main.title = 'Show workspace / today totals';
    main.append(el('span', 'sb-tt-dot'), el('span', 'sb-tt-time'));
    main.addEventListener('click', (e) => { if (e.isTrusted) { expanded = !expanded; tick(); } });
    const pause = el('button', 'sb-tt-pause');
    pause.type = 'button';
    pause.addEventListener('click', (e) => {
      if (e.isTrusted && alive()) chrome.storage.local.set({ timeTrackingPaused: !prefs.paused });
    });
    const details = el('div', 'sb-tt-details');
    // "+time": what was counted while the user was away, with a button to take it back.
    const away = el('div', 'sb-tt-away');
    away.hidden = true;
    const awayText = el('span', 'sb-tt-away-text');
    const awayRemove = el('button', 'sb-tt-away-remove', '✕ Remove');
    awayRemove.type = 'button';
    awayRemove.title = 'This time wasn\'t for this workspace: remove it';
    awayRemove.addEventListener('click', (e) => {
      if (!e.isTrusted || !awayNotice) return;
      send({ type: 'tt-remove-away', at: awayNotice.at });
      awayNotice = null;
      tick();
    });
    away.append(awayText, awayRemove);
    w.append(away, main, pause, details);
    document.documentElement.appendChild(w);
    return w;
  }

  function render(ctx) {
    let w = document.getElementById(WIDGET_ID);
    if (!prefs.enabled || !prefs.visible || !prefs.experimental) { w?.remove(); return; }
    if (!document.body) return;
    w = w || buildWidget();
    const t = totals(ctx);
    const state = stateOf(ctx);
    w.dataset.state = state.key;
    // Shown per workspace per day; per-incident time is collected too but only shown as a muted detail
    // line (being validated before it's surfaced more prominently).
    const time = w.querySelector('.sb-tt-time');
    time.textContent = ctx ? `${wsLabel(ctx.ws)} ${fmt(t.wsMs)}` : `Today ${fmt(t.dayMs)}`;
    time.title = ctx ? wsTitle(ctx.ws) : '';
    const away = w.querySelector('.sb-tt-away');
    const showAway = awayNotice && sameCtx(awayNotice, ctx) && Date.now() - awayNotice.at < AWAY_NOTICE_MS;
    away.hidden = !showAway;
    if (showAway) away.querySelector('.sb-tt-away-text').textContent = `+${fmt(awayNotice.ms)} while you were away`;
    const pause = w.querySelector('.sb-tt-pause');
    pause.textContent = prefs.paused ? '▶' : '⏸';
    pause.title = prefs.paused ? 'Resume time tracking (all tabs)' : 'Pause time tracking (all tabs)';
    const details = w.querySelector('.sb-tt-details');
    details.hidden = !expanded;
    if (expanded) {
      const row = (label, value) => {
        const r = el('div', 'sb-tt-row');
        r.append(el('span', null, label), el('strong', null, value));
        return r;
      };
      const onIncident = ctx && ctx.id !== WORKSPACE_ONLY && ctx.id !== GENERAL.id;
      details.replaceChildren(
        ...(ctx ? [row(entryOf(ctx.ws)?.client || plainWs(ctx.ws), fmt(t.wsMs))] : []),
        ...(ctx && entryOf(ctx.ws)?.code ? [el('div', 'sb-tt-sub', `${labels.codeLabel || 'Code'}: ${entryOf(ctx.ws).code}`)] : []),
        row('Today', fmt(t.dayMs)),
        ...(onIncident ? [el('div', 'sb-tt-sub', `This incident${ctx.n ? ` (#${ctx.n})` : ''}: ${fmt(t.incMs)}`)] : []),
        el('div', 'sb-tt-state', state.text)
      );
    }
  }

  function tick() {
    if (!alive()) return;
    const ctx = report();
    render(ctx);
  }

  // ---------- Settings / stored totals
  chrome.storage.local.get({ timeTrackingEnabled: true, toggleExperiments: false, timeTrackingPaused: false,
    timeTrackingIdle: false, timerCountVisible: true, timeTracking: { days: {} }, timeTrackingCurrent: null,
    timeTrackingAwayNotice: null, timeTrackingLabels: null }, (s) => {
    prefs = { enabled: !!s.timeTrackingEnabled, experimental: s.toggleExperiments === true,
      paused: !!s.timeTrackingPaused, idle: !!s.timeTrackingIdle, visible: s.timerCountVisible !== false };
    stored = s.timeTracking || { days: {} };
    current = s.timeTrackingCurrent;
    awayNotice = s.timeTrackingAwayNotice;
    if (s.timeTrackingLabels) labels = s.timeTrackingLabels;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.timeTrackingEnabled) {
      prefs.enabled = !!changes.timeTrackingEnabled.newValue;
      lastSent = ''; // re-report this tab's context when tracking is turned on
    }
    if (changes.toggleExperiments) prefs.experimental = changes.toggleExperiments.newValue === true;
    if (changes.timeTrackingPaused) prefs.paused = !!changes.timeTrackingPaused.newValue;
    if (changes.timeTrackingIdle) prefs.idle = !!changes.timeTrackingIdle.newValue;
    if (changes.timerCountVisible) prefs.visible = changes.timerCountVisible.newValue !== false;
    if (changes.timeTracking) stored = changes.timeTracking.newValue || { days: {} };
    if (changes.timeTrackingCurrent) current = changes.timeTrackingCurrent.newValue || null;
    if (changes.timeTrackingAwayNotice) awayNotice = changes.timeTrackingAwayNotice.newValue || null;
    if (changes.timeTrackingLabels) labels = changes.timeTrackingLabels.newValue || { codeLabel: 'Code', byWorkspace: {} };
  });

  tickTimer = setInterval(tick, 1000);
})();
