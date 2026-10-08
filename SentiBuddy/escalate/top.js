// Playbook buttons (top portal frame). The incident details page renders in a React iframe where
// escalate/frame.js draws the buttons; clicks are relayed here because this frame holds the
// ARM token captured by enhanced-queue/content.js. The confirmation dialog runs here too.
(() => {
  if (window.top !== window) return;

  const DIALOG_ID = 'sb-esc-dialog';
  const INCIDENT_PAGE_RE = /IncidentPage\.ReactView\/incidentArmId\/([^/?#]+)/i;
  // Kept in sync with ESC_INCIDENT_ID_RE in service_worker.js (no ? # % or whitespace in segments).
  const INCIDENT_ID_RE = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/?#%\s]+\/providers\/Microsoft\.OperationalInsights\/workspaces\/[^/?#%\s]+\/providers\/Microsoft\.SecurityInsights\/incidents\/[^/?#%\s]+$/i;

  // Only the full incident details page (e.g. #view/.../IncidentPage.ReactView/incidentArmId/...)
  function currentIncidentArmId() {
    const m = INCIDENT_PAGE_RE.exec(location.hash);
    if (!m) return null;
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return null; }
    return INCIDENT_ID_RE.test(id) ? id : null;
  }

  function armAuth() {
    return typeof globalThis.SentiBuddyArmAuth === 'function' ? globalThis.SentiBuddyArmAuth() : {};
  }

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res || { error: 'No response from SentiBuddy service worker' });
      });
    });
  }

  // Tell the React frames when the route changes so the button shows/hides with the page.
  let lastId = currentIncidentArmId();
  setInterval(() => {
    const id = currentIncidentArmId();
    if (id === lastId) return;
    lastId = id;
    chrome.runtime.sendMessage({ type: 'escalate-route', incidentArmId: id }, () => void chrome.runtime.lastError);
    if (!id) closeDialog();
  }, 500);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'escalate-frame-query') {
      sendResponse({ incidentArmId: currentIncidentArmId() });
      return;
    }
    // Only the service worker can send this (tabs.sendMessage); used by the Comments tab ops.
    if (msg?.type === 'incident-context') {
      const auth = armAuth();
      sendResponse({ incidentArmId: currentIncidentArmId(), token: auth.token || null, auxHeader: auth.auxHeader || null });
      return;
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
    const body = el('div', { class: 'sb-esc-body' }, el('div', { class: 'sb-esc-muted', text: 'Looking up the client playbook…' }));
    const actions = el('div', { class: 'sb-esc-actions' });
    const icon = el('span', { class: 'sb-esc-icon', text: '▶' });
    const title = el('span', { text: 'Run playbook' });
    const modal = el('div', { class: 'sb-esc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Run playbook' },
      el('div', { class: 'sb-esc-header' }, icon, title),
      body,
      actions
    );
    const dialog = el('div', { id: DIALOG_ID, onmousedown: (e) => { if (e.target.id === DIALOG_ID) closeDialog(); } }, modal);
    document.documentElement.appendChild(dialog);
    addEventListener('keydown', onKey, true);
    actions.append(el('button', { class: 'sb-esc-btn', text: 'Cancel', onclick: closeDialog }));

    const auth = armAuth();
    if (!auth.token) {
      body.replaceChildren(el('div', { class: 'sb-esc-error', text: 'SentiBuddy hasn\'t captured an Azure sign-in token yet. Refresh the incident page and try again.' }));
      return;
    }

    const info = await send({ type: 'playbook-resolve', token: auth.token, auxHeader: auth.auxHeader, incidentArmId, buttonId });
    if (!document.getElementById(DIALOG_ID)) return;
    if (info.error) {
      body.replaceChildren(el('div', { class: 'sb-esc-error', text: `Couldn't look up playbooks: ${info.error}` }));
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
    const summary = el('div', { class: 'sb-esc-incident' },
      el('div', { class: 'sb-esc-inc-title', text: `Incident ${inc.number ?? ''}${inc.title ? ` — ${inc.title}` : ''}` }),
      el('div', { class: 'sb-esc-muted', text: [inc.severity, inc.status, info.workspace].filter(Boolean).join(' • ') })
    );

    if (!info.candidates?.length) {
      body.replaceChildren(summary, el('div', { class: 'sb-esc-error', text: info.lookingFor }));
      return;
    }

    let selectedId = info.suggestedId;
    const nameOf = (id) => info.candidates.find(c => c.id === id)?.name || '';
    const playbookName = el('div', { class: 'sb-esc-playbook', text: nameOf(selectedId) });
    const confirmBtn = el('button', { class: 'sb-esc-btn sb-esc-danger', text: button.confirm.button });
    confirmBtn.disabled = !selectedId;

    const parts = [summary, el('div', { class: 'sb-esc-question', text: button.confirm.question })];
    if (selectedId) {
      parts.push(playbookName);
    } else {
      // Client couldn't be determined from the workspace name — make the user pick explicitly.
      const select = el('select', { class: 'sb-esc-select', onchange: (e) => {
        selectedId = e.target.value || null;
        confirmBtn.disabled = !selectedId;
      } }, el('option', { value: '', text: 'Choose the client playbook…' }),
        ...info.candidates.map(c => el('option', { value: c.id, text: c.name })));
      parts.push(select, el('div', { class: 'sb-esc-warn',
        text: `Couldn't determine the client from workspace "${info.workspace}". Pick the correct playbook.` }));
    }
    const status = el('div', { class: 'sb-esc-status' });
    parts.push(status);
    body.replaceChildren(...parts);

    confirmBtn.addEventListener('click', async (e) => {
      // Only a real user click/keypress can run it; page scripts can't confirm on the user's behalf.
      if (!e.isTrusted || !selectedId || running) return;
      running = true;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      confirmBtn.textContent = 'Running…';
      status.className = 'sb-esc-status';
      status.textContent = '';

      const auth = armAuth();
      const res = await send({ type: 'playbook-run', token: auth.token, auxHeader: auth.auxHeader,
        incidentArmId, logicAppsResourceId: selectedId, tenantId: info.tenantId, buttonId });
      running = false;

      if (res.error) {
        status.className = 'sb-esc-status sb-esc-error';
        status.textContent = `${button.label} failed: ${res.error}`;
        confirmBtn.textContent = 'Retry';
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        return;
      }
      status.className = 'sb-esc-status sb-esc-ok';
      status.textContent = `✓ ${nameOf(selectedId)} was triggered. The run appears under the incident's playbook runs shortly.`;
      confirmBtn.remove();
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Close';
    });

    const cancelBtn = el('button', { class: 'sb-esc-btn', text: 'Cancel', onclick: closeDialog });
    actions.replaceChildren(cancelBtn, confirmBtn);
    cancelBtn.focus(); // a stray Enter should cancel, not escalate
  }
})();
