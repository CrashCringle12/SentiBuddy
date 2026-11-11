// Incident documentation link (top portal frame). When the central config's "documentation" table
// has an entry whose regex matches the incident title, a book icon linking to that page is shown
// after "Incident number N", and hovering the title shows the link.
//
// Two headers are handled:
//   full incident page:  .fxs-blade-title  > h2.fxs-blade-title-titleText + .fxs-blade-title-subtitleText
//   queue details pane:  .ext-details-header-text-container > h2.ext-details-header-title-text + .ext-details-header-subtitle
//
// Everything is off the critical path: DOM scans are debounced and run at idle time, the lookup is
// an async message to the service worker (which matches against the cached config), and results
// are cached per title here, so the portal never waits on SentiBuddy.
(() => {
  if (window.top !== window) return;

  const ICON_CLASS = 'sb-doc-icon';
  const TIP_ID = 'sb-doc-tip';
  const INCIDENT_NUMBER_RE = /^Incident number \d+$/i;
  const lookups = new Map(); // title -> Promise<url|null>
  const titleUrls = new WeakMap(); // title element -> url currently linked

  function lookup(title) {
    if (!lookups.has(title)) {
      lookups.set(title, new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'documentation-lookup', title }, (res) => {
          void chrome.runtime.lastError;
          resolve(typeof res?.url === 'string' && /^https:\/\//i.test(res.url) ? res.url : null);
        });
      }));
      if (lookups.size > 300) lookups.delete(lookups.keys().next().value);
    }
    return lookups.get(title);
  }

  // Header pairs currently on the page: { titleEl, subtitleEl, sourceEl }. sourceEl holds the
  // incident title to look up; usually that's titleEl itself, but the old incident experience
  // (CaseBlade) titles its blade just "Incident", so the real title comes from the blade's own
  // details header (.ext-details-header-title-text).
  function findHeaders() {
    const out = [];
    for (const sub of document.querySelectorAll('.fxs-blade-title-subtitleText, .ext-details-header-subtitle')) {
      if (!INCIDENT_NUMBER_RE.test(subtitleText(sub))) continue;
      const isBlade = sub.classList.contains('fxs-blade-title-subtitleText');
      const titleEl = isBlade
        ? sub.closest('.fxs-blade-title')?.querySelector('.fxs-blade-title-titleText')
        : sub.closest('.ext-details-header-text-container')?.querySelector('.ext-details-header-title-text');
      if (!titleEl) continue;
      let sourceEl = titleEl;
      if (isBlade && /^incident$/i.test((titleEl.textContent || '').trim())) {
        sourceEl = sub.closest('.fxs-blade')?.querySelector('.ext-details-header-title-text');
        if (!sourceEl) continue;
      }
      out.push({ titleEl, subtitleEl: sub, sourceEl });
    }
    return out;
  }

  // Subtitle text without our own icon.
  function subtitleText(sub) {
    let t = '';
    for (const n of sub.childNodes) if (!(n.classList?.contains(ICON_CLASS))) t += n.textContent;
    return t.trim();
  }

  async function syncHeader({ titleEl, subtitleEl, sourceEl }) {
    const title = (sourceEl.textContent || '').trim();
    if (!title) return;
    const url = await lookup(title);
    // The pane may have switched incidents while we waited.
    if ((sourceEl.textContent || '').trim() !== title || !subtitleEl.isConnected) return;

    let icon = subtitleEl.querySelector(`:scope > .${ICON_CLASS}`);
    if (!url) {
      icon?.remove();
      titleUrls.delete(titleEl);
      titleEl.classList.remove('sb-doc-title');
      if (titleEl.dataset.sbDocFocus) {
        titleEl.removeAttribute('tabindex');
        titleEl.removeAttribute('role');
        delete titleEl.dataset.sbDocFocus;
      }
      return;
    }
    if (!icon || icon.dataset.url !== url) { // compare the raw value; a.href is normalized
      icon?.remove();
      icon = buildIcon(url);
      subtitleEl.append(icon);
    }
    titleUrls.set(titleEl, url);
    titleEl.classList.add('sb-doc-title');
    if (!titleEl.hasAttribute('tabindex')) { // keyboard access, only while it's a link
      titleEl.setAttribute('tabindex', '0');
      titleEl.setAttribute('role', 'link');
      titleEl.dataset.sbDocFocus = '1';
    }
    attachHover(titleEl);
  }

  function buildIcon(url) {
    const a = document.createElement('a');
    a.className = ICON_CLASS;
    a.href = url;
    a.dataset.url = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = `Documentation: ${url}`;
    a.setAttribute('aria-label', 'Open documentation for this incident');
    // Book icon (16px, inherits the subtitle color).
    a.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M3 1.75C3 1.34 3.34 1 3.75 1H13c.28 0 .5.22.5.5v10a.5.5 0 0 1-.5.5H4a1 1 0 0 0 0 2h8.5a.5.5 0 0 1 0 1H4a2 2 0 0 1-2-2V2.75c0-.55.45-1 1-1Zm1 .25v9h8.5V2H4Zm1.5 2h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1Z"/></svg>';
    // Keep the click to ourselves (portal panes react to clicks in their header).
    a.addEventListener('click', (e) => e.stopPropagation());
    return a;
  }

  // Hovering the title shows the documentation link and clicking it (or Enter when focused) opens
  // the link in a new tab. Handlers check titleUrls at event time, so a title whose incident has no
  // documentation does nothing. The portal's own title tooltip (full title text) is suspended
  // while ours is up and restored afterwards.
  function openDoc(titleEl, e) {
    const url = titleUrls.get(titleEl);
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  function attachHover(titleEl) {
    if (titleEl.dataset.sbDocHover) return;
    titleEl.dataset.sbDocHover = '1';
    titleEl.addEventListener('click', (e) => { if (e.button === 0) openDoc(titleEl, e); });
    titleEl.addEventListener('auxclick', (e) => { if (e.button === 1) openDoc(titleEl, e); });
    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDoc(titleEl, e); });
    let savedTitle = null;
    titleEl.addEventListener('mouseenter', () => {
      const url = titleUrls.get(titleEl);
      if (!url) return;
      savedTitle = titleEl.getAttribute('title');
      if (savedTitle != null) titleEl.removeAttribute('title');
      showTip(titleEl, url);
    });
    titleEl.addEventListener('mouseleave', () => {
      hideTip();
      if (savedTitle != null && !titleEl.hasAttribute('title')) titleEl.setAttribute('title', savedTitle);
      savedTitle = null;
    });
  }

  function showTip(anchor, url) {
    let tip = document.getElementById(TIP_ID);
    if (!tip) {
      tip = document.createElement('div');
      tip.id = TIP_ID;
      tip.setAttribute('role', 'tooltip');
      document.documentElement.appendChild(tip);
    }
    const full = (anchor.textContent || '').trim();
    tip.replaceChildren();
    if (anchor.scrollWidth > anchor.clientWidth) tip.append(Object.assign(document.createElement('div'), { className: 'sb-doc-tip-title', textContent: full }));
    tip.append(Object.assign(document.createElement('div'), { className: 'sb-doc-tip-label', textContent: '📖 Documentation (click the title to open)' }));
    tip.append(Object.assign(document.createElement('div'), { className: 'sb-doc-tip-url', textContent: url }));
    const r = anchor.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.min(r.bottom + 6, innerHeight - tip.offsetHeight - 8)}px`;
  }
  function hideTip() {
    const tip = document.getElementById(TIP_ID);
    if (tip) tip.hidden = true;
  }

  // Debounced, idle-time scanning on DOM changes.
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      const run = () => findHeaders().forEach(h => { syncHeader(h); });
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 1500 }); else run();
    }, 400);
  }

  function start() {
    new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scheduleScan();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });

  // A new config link (or a Pull) may change the table; forget cached answers.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.configDataURL || changes.playbookConfigCache)) {
      lookups.clear();
      scheduleScan();
    }
  });
})();
