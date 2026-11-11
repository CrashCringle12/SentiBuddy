// Playbook buttons on the incident details page. The list comes from
// "playbooks" in the master config via the service worker; clicking relays to playbooks/top.js,
// which confirms and runs the client's playbook.
//   new experience: inside the portal's React view iframe, next to "Incident actions"
//   old experience: in the top portal frame, in a bar above the Timeline / … / Comments tabs
// The same script runs in both places and only acts on the experience that renders there.
(() => {
  const IS_TOP = window.top === window;
  const MAX_INLINE = 5; // beyond this, the rest go into a "More" dropdown
  const MORE_ID = 'sb-pb-more';
  const MENU_ID = 'sb-pb-menu';
  const BAR_ID = 'sb-pb-bar';
  const domId = (b) => `sb-pb-${b.id}`;
  let incidentArmId = null;
  let buttons = [];
  let buttonsSig = '';
  let checkTimer = null;

  // Old experience: the incident's Knockout tab strip (Timeline … Comments).
  function findOldViewTabs() {
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      const names = [...list.querySelectorAll('[role="tab"]')].map(t => (t.textContent || '').replace(/\s+/g, ' ').trim());
      if (names.some(n => /^timeline/i.test(n)) && names.some(n => /^comments/i.test(n))) {
        return list.closest('.ext-tab-grid-section, .fxc-section-tabs') || list;
      }
    }
    return null;
  }

  function findIncidentActions() {
    for (const node of document.querySelectorAll('button, [role="button"], [role="menuitem"]')) {
      if (node.dataset.sbPlaybook) continue;
      const label = (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^incident actions$/i.test(label)) return node;
    }
    return null;
  }

  // The old experience's portal stylesheets (top frame) override ours (e.g. resets on button/img
  // that are more specific than our class selectors), so the essentials are also set inline with
  // !important, which no stylesheet can beat. frame.css still provides hover/focus and the rest.
  function forceStyle(node, styles) {
    for (const [prop, value] of Object.entries(styles)) node.style.setProperty(prop, value, 'important');
    return node;
  }
  const BUTTON_STYLE = {
    display: 'inline-flex', 'align-items': 'center', gap: '6px', height: '32px', padding: '0 14px',
    border: '1px solid rgba(0, 0, 0, 0.18)', 'border-radius': '4px',
    background: 'var(--sb-pb-color)', color: 'var(--sb-pb-text)',
    'font-family': '"Segoe UI", "Segoe UI Web (West European)", -apple-system, BlinkMacSystemFont, Roboto, sans-serif',
    'font-size': '13px', 'font-weight': '600', 'line-height': '1', 'white-space': 'nowrap', cursor: 'pointer',
    'box-shadow': 'none', 'text-transform': 'none', 'min-width': '0'
  };

  function sbIcon() {
    const icon = document.createElement('img');
    icon.className = 'sb-playbook-icon';
    icon.src = chrome.runtime.getURL('icon.png');
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    return forceStyle(icon, { display: 'inline-block', width: '16px', height: '16px', 'max-width': 'none',
      flex: 'none', 'border-radius': '3px', margin: '0' });
  }
  function glyph(text) {
    const span = document.createElement('span');
    span.className = 'sb-playbook-glyph';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = text;
    return span;
  }
  // Colors were validated as #rrggbb by the service worker.
  function applyColors(node, b) {
    node.style.setProperty('--sb-pb-color', b.color);
    node.style.setProperty('--sb-pb-text', b.textColor);
  }
  function runButton(b) {
    chrome.runtime.sendMessage({ type: 'playbook-frame-click', buttonId: b.id }, () => void chrome.runtime.lastError);
  }
  // Ignore synthetic clicks (element.click() / dispatchEvent from page scripts).
  function onTrustedClick(node, fn) {
    node.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) fn(e);
    });
  }

  function buildButton(b) {
    const btn = document.createElement('button');
    btn.id = domId(b);
    btn.type = 'button';
    btn.className = 'sb-playbook-btn';
    btn.dataset.sbPlaybook = b.id;
    btn.title = b.description;
    applyColors(btn, b);
    forceStyle(btn, BUTTON_STYLE);
    btn.append(sbIcon());
    if (b.icon) btn.append(glyph(b.icon));
    btn.append(document.createTextNode(b.label));
    onTrustedClick(btn, () => runButton(b));
    return btn;
  }

  function buildMore(count) {
    const btn = document.createElement('button');
    btn.id = MORE_ID;
    btn.type = 'button';
    btn.className = 'sb-playbook-btn sb-playbook-more';
    btn.dataset.sbPlaybook = 'more';
    btn.title = 'More playbooks';
    btn.style.setProperty('--sb-pb-color', '#3b3a39');
    btn.style.setProperty('--sb-pb-text', '#ffffff');
    forceStyle(btn, BUTTON_STYLE);
    btn.setAttribute('aria-haspopup', 'menu');
    btn.append(sbIcon(), document.createTextNode(`More (${count}) ▾`));
    onTrustedClick(btn, () => toggleMenu(btn));
    return btn;
  }

  // ---- "More" dropdown (fixed-position, so the React toolbar's overflow can't clip it)
  function closeMenu() {
    const menu = document.getElementById(MENU_ID);
    menu?.remove();
    return !!menu;
  }
  function toggleMenu(anchor) {
    if (closeMenu()) return;
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    // Fluent tokens are inherited by the toolbar, not by <body>, so copy them from the anchor.
    const cs = getComputedStyle(anchor);
    for (const [ours, token] of [['--sb-menu-bg', '--colorNeutralBackground1'], ['--sb-menu-fg', '--colorNeutralForeground1'],
      ['--sb-menu-border', '--colorNeutralStroke1'], ['--sb-menu-hover', '--colorNeutralBackground1Hover']]) {
      const v = cs.getPropertyValue(token).trim();
      if (v) menu.style.setProperty(ours, v);
    }
    for (const b of buttons.slice(MAX_INLINE)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sb-pb-menu-item';
      item.setAttribute('role', 'menuitem');
      item.title = b.description;
      const swatch = document.createElement('span');
      swatch.className = 'sb-pb-swatch';
      swatch.style.background = b.color;
      item.append(swatch);
      if (b.icon) item.append(glyph(b.icon));
      item.append(document.createTextNode(b.label));
      onTrustedClick(item, () => { closeMenu(); runButton(b); });
      menu.append(item);
    }
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    menu.style.left = `${Math.round(r.left)}px`;
    document.body.append(menu);
    const overflow = menu.getBoundingClientRect().right - (innerWidth - 8);
    if (overflow > 0) menu.style.left = `${Math.max(8, Math.round(r.left - overflow))}px`;
    menu.querySelector('button')?.focus();
  }
  addEventListener('mousedown', (e) => {
    if (!e.target.closest?.(`#${MENU_ID}, #${MORE_ID}`)) closeMenu();
  }, true);
  addEventListener('scroll', closeMenu, true);
  addEventListener('resize', closeMenu);

  function removeAll() {
    document.querySelectorAll('[data-sb-playbook]').forEach(n => n.remove());
    document.getElementById(BAR_ID)?.remove();
    closeMenu();
  }

  let seenActions = false;
  function sync() {
    if (IS_TOP) { syncOldView(); return; }
    const actions = view === 'old' ? null : findIncidentActions();
    // Toolbar just appeared: re-confirm with the top frame that this is an incident page.
    if (actions && !seenActions) queryRoute();
    seenActions = !!actions;
    if (!incidentArmId || !actions || !buttons.length) {
      removeAll();
      return;
    }
    const { inline, wanted } = wantedButtons();
    document.querySelectorAll('[data-sb-playbook]').forEach(n => { if (!wanted.includes(n.id)) n.remove(); });

    const h = Math.round(actions.getBoundingClientRect().height);
    let anchor = actions;
    wanted.forEach((id, i) => {
      const node = document.getElementById(id) || (id === MORE_ID ? buildMore(buttons.length - MAX_INLINE) : buildButton(inline[i]));
      if (node.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', node);
      if (h && node.style.height !== `${h}px`) node.style.height = `${h}px`;
      anchor = node;
    });
  }

  function wantedButtons() {
    const inline = buttons.slice(0, MAX_INLINE);
    const wanted = inline.map(domId);
    if (buttons.length > MAX_INLINE) wanted.push(MORE_ID);
    return { inline, wanted };
  }
  const nodeFor = (id, inline) => document.getElementById(id) ||
    (id === MORE_ID ? buildMore(buttons.length - MAX_INLINE) : buildButton(inline.find(b => domId(b) === id)));

  // Old experience (top frame): a bar of buttons right above the incident's tab strip.
  function syncOldView() {
    const tabs = view === 'old' && incidentArmId && buttons.length ? findOldViewTabs() : null;
    if (!tabs) { removeAll(); return; }
    let bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
      bar.className = 'sb-pb-bar';
      forceStyle(bar, { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '8px',
        padding: '8px 0 10px', background: 'transparent' });
    }
    if (bar.nextElementSibling !== tabs) tabs.insertAdjacentElement('beforebegin', bar);
    const { inline, wanted } = wantedButtons();
    const current = [...bar.children].map(n => n.id);
    if (current.join('|') !== wanted.join('|')) bar.replaceChildren(...wanted.map(id => nodeFor(id, inline)));
  }

  // Throttle (not debounce) so a constantly re-rendering page still gets checked.
  function scheduleSync() {
    if (checkTimer) return;
    checkTimer = setTimeout(() => { checkTimer = null; sync(); }, 250);
  }

  // Cheap: the service worker caches the master config for 30 minutes.
  function loadButtons() {
    chrome.runtime.sendMessage({ type: 'playbook-buttons' }, (res) => {
      void chrome.runtime.lastError;
      const list = Array.isArray(res?.buttons) ? res.buttons : [];
      const sig = JSON.stringify(list);
      if (sig !== buttonsSig) {
        buttonsSig = sig;
        buttons = list;
        removeAll(); // rebuild with the new labels/colors
      }
      scheduleSync();
    });
  }

  let view = null; // 'new' | 'old' | null (from playbooks/top.js)
  function setIncident(id, v) {
    view = v || null;
    // Each copy only handles its own experience: the top frame the old one, React frames the new one.
    const mine = IS_TOP ? view === 'old' : view !== 'old';
    incidentArmId = (mine && id) || null;
    if (incidentArmId) loadButtons();
    scheduleSync();
  }

  function queryRoute() {
    chrome.runtime.sendMessage({ type: 'incident-frame-query' }, (res) => {
      void chrome.runtime.lastError;
      setIncident(res?.incidentArmId, res?.view);
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'incident-route') setIncident(msg.incidentArmId, msg.view);
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
    // Alt+Q toggles the Enhanced Queue even when keyboard focus is inside this iframe (the top frame
    // handles it itself in enhanced-queue/content.js).
    if (IS_TOP || !e.isTrusted || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyQ') return;
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'toggle-enhanced-queue' }, () => void chrome.runtime.lastError);
  }, true);

  // React re-renders the toolbar, so keep re-checking as the DOM changes. (In the top frame only
  // while an old-experience incident is open; syncOldView is cheap otherwise.)
  new MutationObserver(() => { if (!IS_TOP || incidentArmId || document.getElementById(BAR_ID)) scheduleSync(); })
    .observe(document.documentElement, { childList: true, subtree: true });

  queryRoute();
})();
