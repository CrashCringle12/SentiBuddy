// Playbook buttons (top portal frame). The incident details page renders in a React iframe where
// playbooks/frame.js draws the buttons; clicks are relayed here because this frame holds the
// ARM token captured by enhanced-queue/content.js. The confirmation dialog runs here too.
(() => {
  if (window.top !== window) return;

  const DIALOG_ID = 'sb-pbd-dialog';
  // The full incident details page comes in two experiences, told apart by the URL:
  //   new: #view/Microsoft_Azure_Security_Insights/IncidentPage.ReactView/incidentArmId/<id>  (React iframe)
  //   old: #view/Microsoft_Azure_Security_Insights/CaseBlade/id/<id>                          (this frame)
  const INCIDENT_PAGE_RE = /\/(IncidentPage\.ReactView\/incidentArmId|CaseBlade\/id)\/([^/?#]+)/i;
  // Kept in sync with PB_INCIDENT_ID_RE in service_worker.js (no ? # % or whitespace in segments).
  const INCIDENT_ID_RE = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/?#%\s]+\/providers\/Microsoft\.OperationalInsights\/workspaces\/[^/?#%\s]+\/providers\/Microsoft\.SecurityInsights\/incidents\/[^/?#%\s]+$/i;

  // { id, view: 'new' | 'old' } on an incident details page, otherwise null.
  function currentIncident() {
    const m = INCIDENT_PAGE_RE.exec(location.hash);
    if (!m) return null;
    let id;
    try { id = decodeURIComponent(m[2]); } catch { return null; }
    if (!INCIDENT_ID_RE.test(id)) return null;
    return { id, view: /^CaseBlade/i.test(m[1]) ? 'old' : 'new' };
  }
  const currentIncidentArmId = () => currentIncident()?.id || null;
  const currentView = () => currentIncident()?.view || null;
  // Shared with time-tracking/top.js (same isolated world; never exposed to the page).
  globalThis.SentiBuddyCurrentIncident = currentIncident;

  // The ARM token captured by enhanced-queue/content.js. If it has expired, wait briefly for the
  // portal to renew it (renewed tokens are picked up from any portal frame) rather than sending a
  // request that would fail with "token expired".
  async function armAuth(timeoutMs = 10000) {
    if (typeof globalThis.SentiBuddyArmAuthFresh === 'function') return globalThis.SentiBuddyArmAuthFresh(timeoutMs);
    return typeof globalThis.SentiBuddyArmAuth === 'function' ? globalThis.SentiBuddyArmAuth() : {};
  }
  const EXPIRED_MSG = 'Your Azure sign-in token expired and the portal hasn\'t renewed it yet. Click around the portal (e.g. refresh the incident) and try again.';

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res || { error: 'No response from SentiBuddy service worker' });
      });
    });
  }

  // Tell the frames when the route changes so buttons / the Comments tab show and hide with the
  // page, and remember which experience the user last opened an incident in (the Enhanced Queue
  // opens incidents in that one).
  function rememberView(view) {
    if (view) chrome.storage.local.set({ incidentViewPreference: view });
  }
  let lastRoute = JSON.stringify(currentIncident());
  rememberView(currentView());
  const routeTimer = setInterval(() => {
    // Extension reloaded/updated: this copy can't reach it any more ("Extension context invalidated").
    if (!chrome.runtime?.id) { clearInterval(routeTimer); return; }
    const inc = currentIncident();
    const route = JSON.stringify(inc);
    if (route === lastRoute) return;
    lastRoute = route;
    rememberView(inc?.view);
    chrome.runtime.sendMessage({ type: 'incident-route', incidentArmId: inc?.id || null, view: inc?.view || null },
      () => void chrome.runtime.lastError);
    if (!inc) closeDialog();
  }, 500);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'incident-frame-query') {
      sendResponse({ incidentArmId: currentIncidentArmId(), view: currentView() });
      return;
    }
    // Only the service worker can send this (tabs.sendMessage); used by the Comments tab ops.
    if (msg?.type === 'incident-context') {
      armAuth().then((auth) => {
        sendResponse({ incidentArmId: currentIncidentArmId(), token: auth.token || null, auxHeader: auth.auxHeader || null,
          expired: !!auth.expired });
      });
      return true; // async response
    }
    if (msg?.type === 'playbook-frame-click') {
      const id = currentIncidentArmId();
      const ok = !!id && typeof msg.buttonId === 'string';
      if (ok) openDialog(id, msg.buttonId);
      sendResponse({ ok });
    }
  });

  // Button appearance comes from the master config via the service worker (already validated there).
  function applyButtonColors(node, button) {
    node.style.setProperty('--sb-pb-color', button.color);
    node.style.setProperty('--sb-pb-text', button.textColor);
  }

  // ---- Dialog
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

  let running = false;

  function closeDialog() {
    if (running) return;
    document.getElementById(DIALOG_ID)?.remove();
    removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') closeDialog(); }

  async function openDialog(incidentArmId, buttonId) {
    closeDialog();
    const body = el('div', { class: 'sb-pbd-body' }, el('div', { class: 'sb-pbd-muted', text: 'Looking up the playbook…' }));
    const actions = el('div', { class: 'sb-pbd-actions' });
    const icon = el('span', { class: 'sb-pbd-icon', text: '▶' });
    const title = el('span', { text: 'Run playbook' });
    const modal = el('div', { class: 'sb-pbd-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Run playbook' },
      el('div', { class: 'sb-pbd-header' }, icon, title),
      body,
      actions
    );
    const dialog = el('div', { id: DIALOG_ID, onmousedown: (e) => { if (e.target.id === DIALOG_ID) closeDialog(); } }, modal);
    document.documentElement.appendChild(dialog);
    addEventListener('keydown', onKey, true);
    actions.append(el('button', { class: 'sb-pbd-btn', text: 'Cancel', onclick: closeDialog }));

    const auth = await armAuth();
    if (!document.getElementById(DIALOG_ID)) return;
    if (!auth.token) {
      body.replaceChildren(el('div', { class: 'sb-pbd-error', text: 'SentiBuddy hasn\'t captured an Azure sign-in token yet. Refresh the incident page and try again.' }));
      return;
    }
    if (auth.expired) {
      body.replaceChildren(el('div', { class: 'sb-pbd-error', text: EXPIRED_MSG }));
      return;
    }

    const info = await send({ type: 'playbook-resolve', token: auth.token, auxHeader: auth.auxHeader, incidentArmId, buttonId });
    if (!document.getElementById(DIALOG_ID)) return;
    if (info.error) {
      body.replaceChildren(el('div', { class: 'sb-pbd-error', text: `Couldn't look up playbooks: ${info.error}` }));
      return;
    }
    const button = info.button;
    applyButtonColors(modal, button);
    icon.textContent = button.icon || '▶';
    title.textContent = button.confirm.title;
    modal.setAttribute('aria-label', button.confirm.title);
    renderConfirm(body, actions, incidentArmId, info, buttonId);
  }

  function renderConfirm(body, actions, incidentArmId, info, buttonId) {
    const button = info.button;
    const inc = info.incident || {};
    const summary = el('div', { class: 'sb-pbd-incident' },
      el('div', { class: 'sb-pbd-inc-title', text: `Incident ${inc.number ?? ''}${inc.title ? ` — ${inc.title}` : ''}` }),
      el('div', { class: 'sb-pbd-muted', text: [inc.severity, inc.status, info.workspace].filter(Boolean).join(' • ') })
    );

    if (!info.candidates?.length) {
      body.replaceChildren(summary, el('div', { class: 'sb-pbd-error', text: info.lookingFor }));
      return;
    }

    let selectedId = info.suggestedId;
    const nameOf = (id) => info.candidates.find(c => c.id === id)?.name || '';
    const playbookName = el('div', { class: 'sb-pbd-playbook', text: nameOf(selectedId) });
    const confirmBtn = el('button', { class: 'sb-pbd-btn sb-pbd-danger', text: button.confirm.button });
    confirmBtn.disabled = !selectedId;

    const parts = [summary, el('div', { class: 'sb-pbd-question', text: button.confirm.question })];
    if (selectedId) {
      parts.push(playbookName);
    } else {
      // The playbook couldn't be matched to the workspace name — make the user pick explicitly.
      const select = el('select', { class: 'sb-pbd-select', onchange: (e) => {
        selectedId = e.target.value || null;
        confirmBtn.disabled = !selectedId;
      } }, el('option', { value: '', text: 'Choose the playbook…' }),
        ...info.candidates.map(c => el('option', { value: c.id, text: c.name })));
      parts.push(select, el('div', { class: 'sb-pbd-warn',
        text: `Couldn't tell which playbook belongs to workspace "${info.workspace}". Pick the correct one.` }));
    }
    const status = el('div', { class: 'sb-pbd-status' });
    parts.push(status);
    body.replaceChildren(...parts);

    confirmBtn.addEventListener('click', async (e) => {
      // Only a real user click/keypress can run it; page scripts can't confirm on the user's behalf.
      if (!e.isTrusted || !selectedId || running) return;
      running = true;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.textContent = 'Running…';
      status.className = 'sb-pbd-status';
      status.textContent = '';

      const auth = await armAuth();
      const res = auth.expired
        ? { error: EXPIRED_MSG }
        : await send({ type: 'playbook-run', token: auth.token, auxHeader: auth.auxHeader,
          incidentArmId, logicAppsResourceId: selectedId, tenantId: info.tenantId, buttonId });
      running = false;

      if (res.error) {
        status.className = 'sb-pbd-status sb-pbd-error';
        status.textContent = `${button.label} failed: ${res.error}`;
        confirmBtn.textContent = 'Retry';
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        return;
      }
      status.className = 'sb-pbd-status sb-pbd-ok';
      status.textContent = `✓ ${nameOf(selectedId)} was triggered. The run appears under the incident's playbook runs shortly.`;
      confirmBtn.remove();
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Close';
    });

    const cancelBtn = el('button', { class: 'sb-pbd-btn', text: 'Cancel', onclick: closeDialog });
    actions.replaceChildren(cancelBtn, confirmBtn);
    cancelBtn.focus(); // a stray Enter should cancel, not run the playbook
  }
})();
