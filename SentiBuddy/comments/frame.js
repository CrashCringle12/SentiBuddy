// "Comments+" tab on the incident details page: a large comment composer with the activity log above it.
//   new experience: inside the portal's React view iframe, a third tab after Overview / Entities
//   old experience: in the top portal frame, after the native Timeline / … / Comments tabs
// The same script runs in both places and only acts on the experience that renders there.
//
// The view is an overlay appended to <html>, positioned over the tab content area, so the portal's
// own tree is never modified beyond inserting the tab button.
(() => {
  const IS_TOP = window.top === window;
  const TAB_ID = 'sb-comments-tab';
  const TAB_LABEL = 'Comments+';
  const VIEW_ID = 'sb-comments-view';
  const MAX_CHARS = 30000;

  let incidentArmId = null;
  let active = false;
  let syncTimer = null;
  let posTimer = null;
  let draftTimer = null;

  // Activity log sources, mirroring Sentinel's filters. Each is a separate request, so only
  // Comments loads by default; the others load the first time their chip is switched on.
  // Activities and Automation health are hidden until their workspace queries are reworked (they
  // don't load reliably through the ARM query proxy); uncomment to bring the chips back.
  const SOURCES = [
    { key: 'comments', label: 'Comments', op: 'comments', dot: 'var(--sbc-accent)' }
    // { key: 'activities', label: 'Activities', op: 'history', dot: 'var(--sbc-muted)' },
    // { key: 'automation', label: 'Automation health', op: 'automation', dot: '#8764b8' }
  ];
  const enabledSources = new Set(['comments']); // kept across incidents while the frame lives
  let sources = freshSources();
  function freshSources() {
    return Object.fromEntries(SOURCES.map(s => [s.key, { fetched: false, loading: false, data: null, note: '' }]));
  }

  // ---------- Messaging helpers
  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res || { error: 'No response from SentiBuddy' });
      });
    });
  }
  const op = (name, extra) => send({ type: 'incident-op', op: name, incidentArmId, ...extra });

  // Route updates are shared with playbooks/frame.js (top frame owns the URL).
  // Each copy only handles its own experience: the top frame the old one, React frames the new one.
  const mine = (id, view) => ((IS_TOP ? view === 'old' : view !== 'old') && id) || null;
  function queryRoute() {
    chrome.runtime.sendMessage({ type: 'incident-frame-query' }, (res) => {
      void chrome.runtime.lastError;
      setIncident(mine(res?.incidentArmId, res?.view));
    });
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'incident-route') setIncident(mine(msg.incidentArmId, msg.view));
  });

  function setIncident(id) {
    if (id === incidentArmId) { scheduleSync(); return; }
    if (active) deactivate();
    incidentArmId = id;
    sources = freshSources();
    document.getElementById(VIEW_ID)?.remove();
    scheduleSync();
  }

  // ---------- DOM helpers
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
  const tabLabel = (t) => (t.textContent || '').replace(/\s+/g, ' ').trim();

  // The incident's tab strip; `after` is the native tab ours goes after. Tabs render their label
  // twice (visible + reserved space), so match on "starts with" after collapsing.
  //   new (React):     Overview / Entities          → after Entities
  //   old (Knockout):  Timeline / … / Comments       → after Comments
  function findTabs() {
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      const tabs = [...list.querySelectorAll('[role="tab"]')].filter(t => t.id !== TAB_ID);
      const named = (re) => tabs.find(t => re.test(tabLabel(t)));
      if (IS_TOP) {
        const comments = named(/^comments/i);
        if (named(/^timeline/i) && comments) return { list, tabs, after: comments };
      } else {
        const entities = named(/^entities/i);
        if (named(/^overview/i) && entities) return { list, tabs, after: entities };
      }
    }
    return null;
  }

  // Build our tab by cloning a native unselected tab so it matches Sentinel's styling exactly.
  // A cloned node carries no React/Knockout handlers.
  function buildTab(found) {
    const template = found.tabs.find(t => t.getAttribute('aria-selected') !== 'true') || found.after;
    const tab = template.cloneNode(true);
    tab.id = TAB_ID;
    tab.setAttribute('aria-selected', 'false');
    tab.removeAttribute('aria-controls');
    tab.removeAttribute('data-tabster');
    tab.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    // Tabs render the label in more than one span (visible + reserved width); rename them all.
    texts.forEach(t => { if (t.nodeValue.trim()) t.nodeValue = TAB_LABEL; });
    if (!texts.some(t => t.nodeValue === TAB_LABEL)) tab.textContent = TAB_LABEL;
    // SentiBuddy icon inline before each label copy (keeps the reserved width in step).
    const walker2 = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
    const labels = [];
    while (walker2.nextNode()) if (walker2.currentNode.nodeValue === TAB_LABEL) labels.push(walker2.currentNode);
    labels.forEach(t => {
      const icon = document.createElement('img');
      icon.className = 'sb-comments-tab-icon';
      icon.src = chrome.runtime.getURL('icon.png');
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      // Inline !important: the old experience's portal styles (top frame) override frame.css here.
      // Visibility is deliberately left inherited: the label's hidden width-reserving copy must keep
      // its icon hidden too, or the two icons overlap.
      for (const [prop, value] of Object.entries({ display: 'inline-block', width: '16px', height: '16px',
        'max-width': 'none', 'margin-right': '6px', 'vertical-align': '-3px', 'border-radius': '3px'
      })) icon.style.setProperty(prop, value, 'important');
      t.parentNode.insertBefore(icon, t);
    });
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) activate();
    });
    return tab;
  }

  // ---------- Sync: keep the tab present while on an incident page
  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = setTimeout(() => { syncTimer = null; sync(); }, 250);
  }

  let seenTabs = false;
  function sync() {
    // Top frame: nothing to look for unless an old-experience incident is open (route-driven).
    if (IS_TOP && !incidentArmId) {
      document.getElementById(TAB_ID)?.remove();
      if (active) deactivate();
      return;
    }
    const found = findTabs();
    if (found && !seenTabs) queryRoute();
    seenTabs = !!found;

    let tab = document.getElementById(TAB_ID);
    if (!incidentArmId || !found) {
      tab?.remove();
      if (active) deactivate();
      return;
    }
    if (!tab || tab.parentElement !== found.after.parentElement || tab.previousElementSibling !== found.after) {
      tab = tab || buildTab(found);
      found.after.insertAdjacentElement('afterend', tab);
    }
    if (!found.list.dataset.sbWatch) {
      found.list.dataset.sbWatch = '1';
      // Clicking a native tab hands control back to Sentinel.
      found.list.addEventListener('click', (e) => {
        const t = e.target.closest('[role="tab"]');
        if (t && t.id !== TAB_ID && active) deactivate();
      }, true);
    }
    if (active) applySelectedLook();
    // Prefetch enabled sources once so the log is ready (or nearly) by the time the tab is opened.
    enabledSources.forEach(k => { if (!sources[k].fetched) loadSource(k); });
  }

  // Only write attributes when they actually change: every write fires the portal's attribute
  // observers, and rewriting on each sync loops with React re-renders ("branches cannot be combined").
  function setAttr(node, name, value) {
    if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  function applySelectedLook() {
    setAttr(document.getElementById(TAB_ID), 'aria-selected', 'true');
  }
  function restoreLook() {
    setAttr(document.getElementById(TAB_ID), 'aria-selected', 'false');
  }

  // ---------- Overlay positioning: cover the tab content area below the tab strip
  function contentRegion() {
    const found = findTabs();
    if (!found) return null;
    const listRect = found.list.getBoundingClientRect();
    let container = found.list.parentElement;
    while (container && container !== document.body && container.getBoundingClientRect().height < innerHeight * 0.5) {
      container = container.parentElement;
    }
    const c = (container || document.body).getBoundingClientRect();
    const top = Math.max(0, listRect.bottom + 4);
    return { left: c.left, width: c.width, top, height: Math.max(220, Math.min(c.bottom, innerHeight) - top) };
  }
  function position() {
    const view = document.getElementById(VIEW_ID);
    const r = contentRegion();
    if (!view || !r) return;
    Object.assign(view.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  // ---------- Theme: borrow the incident page's own Fluent UI tokens so the view matches
  // light / dark / high-contrast exactly. Our overlay lives outside the FluentProvider, so the
  // values are read from the tab strip (custom properties inherit) and copied onto the view.
  const THEME_TOKENS = {
    '--sbc-panel': ['--colorNeutralBackground2', '--colorNeutralBackground1'],
    '--sbc-border': ['--colorNeutralStroke2', '--colorNeutralStroke1'],
    '--sbc-text': ['--colorNeutralForeground1'],
    '--sbc-muted': ['--colorNeutralForeground3', '--colorNeutralForeground2'],
    '--sbc-accent': ['--colorBrandForeground1', '--colorBrandBackground'],
    '--sbc-accent-bg': ['--colorBrandBackground'],
    '--sbc-accent-hover': ['--colorBrandBackgroundHover'],
    '--sbc-on-accent': ['--colorNeutralForegroundOnBrand'],
    '--sbc-selected': ['--colorBrandBackground2', '--colorSubtleBackgroundSelected'],
    '--sbc-bubble': ['--colorNeutralBackground2', '--colorNeutralBackground3'],
    '--sbc-bubble-border': ['--colorNeutralStroke2'],
    '--sbc-code': ['--colorNeutralBackground3', '--colorNeutralBackground4'],
    '--sbc-input': ['--colorNeutralBackground1'],
    '--sbc-hover': ['--colorSubtleBackgroundHover', '--colorNeutralBackground1Hover'],
    '--sbc-focus': ['--colorCompoundBrandStroke', '--colorBrandStroke1'],
    '--sbc-font': ['--fontFamilyBase'],
    '--sbc-mono': ['--fontFamilyMonospace']
  };
  const parseRgb = (c) => {
    const m = c && c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    return m && (m[4] === undefined || Number(m[4]) > 0.5) ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  // The actual painted background behind the tab strip (first opaque ancestor).
  function pageBackground() {
    for (let n = findTabs()?.list || document.body; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (parseRgb(bg)) return bg;
    }
    return null;
  }
  function applyTheme(view) {
    const src = getComputedStyle(findTabs()?.list || document.body);
    let tokens = 0;
    for (const [ours, candidates] of Object.entries(THEME_TOKENS)) {
      const value = candidates.map(t => src.getPropertyValue(t).trim()).find(Boolean);
      if (value) { view.style.setProperty(ours, value); tokens++; } else view.style.removeProperty(ours);
    }
    const bg = pageBackground();
    if (bg) view.style.setProperty('--sbc-bg', bg); else view.style.removeProperty('--sbc-bg');
    // Without Fluent tokens, fall back to our built-in palette matching the page's brightness.
    const rgb = parseRgb(bg);
    const dark = rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.5 : false;
    view.classList.toggle('sb-dark', dark);
    view.classList.toggle('sb-tokens', tokens > 0);
  }

  // ---------- Activate / deactivate
  function activate() {
    if (!incidentArmId) return;
    active = true;
    applySelectedLook();
    let view = document.getElementById(VIEW_ID);
    if (!view) {
      view = buildView();
      document.documentElement.appendChild(view);
      applyPreviewVisibility();
    }
    applyTheme(view);
    view.hidden = false;
    position();
    clearInterval(posTimer);
    let ticks = 0;
    posTimer = setInterval(() => {
      position();
      if (++ticks % 5 === 0) applyTheme(view); // follow portal theme switches
    }, 400);
    renderLog();
    loadDraft();
    view.querySelector('textarea').focus();
    refreshSources();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if (!document.hidden) refreshSources(); }, REFRESH_MS);
  }

  // Comments can be added or edited elsewhere (Sentinel's own activity log, other analysts), so
  // reload while the tab is open: every REFRESH_MS and whenever the page becomes visible again.
  const REFRESH_MS = 30000;
  let refreshTimer = null;
  function refreshSources() {
    enabledSources.forEach(k => loadSource(k));
  }
  document.addEventListener('visibilitychange', () => { if (active && !document.hidden) refreshSources(); });

  function deactivate() {
    active = false;
    clearInterval(posTimer);
    clearInterval(refreshTimer);
    const view = document.getElementById(VIEW_ID);
    if (view) view.hidden = true;
    restoreLook();
  }

  addEventListener('resize', () => { if (active) position(); });

  // ---------- View
  function buildView() {
    const textarea = el('textarea', {
      class: 'sbc-input', placeholder: 'Write a comment…',
      spellcheck: 'true', maxlength: String(MAX_CHARS),
      oninput: () => { updateCount(); saveDraftSoon(); },
      onkeydown: onComposerKey,
      onpaste: onComposerPaste,
      onscroll: syncPreviewScroll
    });
    const toolbarBtn = (label, title, fn) => el('button', { type: 'button', class: 'sbc-tool', title, onclick: (e) => { e.preventDefault(); fn(); textarea.focus(); } }, label);
    const HEADER_OPTS = [
      { label: 'Normal', prefix: '' },
      { label: 'Heading 1', prefix: '# ' },
      { label: 'Heading 2', prefix: '## ' },
      { label: 'Heading 3', prefix: '### ' }
    ];
    const COLORS = ['#000000', '#e60000', '#ff9900', '#ffff00', '#008a00', '#0066cc', '#9933ff', '#ffffff', '#facccc', '#ffebcc', '#ffffcc', '#cce8cc', '#cce0f5', '#ebd6ff', '#bbbbbb', '#f06666', '#ffc266', '#ffff66', '#66b966', '#66a3e0', '#c285ff', '#888888', '#a10000', '#b26b00', '#b2b200', '#006100', '#0047b2', '#6b24b2', '#444444', '#5c0000', '#663d00', '#666600', '#003700', '#002966', '#3d1466'];

    function closeAllMenus() {
      document.getElementById(VIEW_ID)?.querySelectorAll('.sbc-dropdown').forEach(m => m.remove());
    }
    // One listener for the view's lifetime: any click outside an open menu closes it.
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest?.('.sbc-dropdown, .sbc-dropdown-toggle')) closeAllMenus();
    }, true);
    // Toggle buttons open their menu, or close it if it's already open.
    function toggleMenu(button, build) {
      const open = button.nextElementSibling?.classList.contains('sbc-dropdown');
      closeAllMenus();
      if (!open) button.insertAdjacentElement('afterend', build());
    }
    function buildHeaderMenu() {
      const menu = el('div', { class: 'sbc-dropdown' });
      HEADER_OPTS.forEach(opt => {
        const btn = el('button', {
          type: 'button', class: 'sbc-dropdown-item', title: opt.label,
          onclick: (e) => { e.preventDefault(); applyHeading(opt.prefix); closeAllMenus(); textarea.focus(); }
        }, opt.label);
        menu.append(btn);
      });
      return menu;
    }
    function buildColorMenu(isBg) {
      const menu = el('div', { class: 'sbc-dropdown sbc-color-grid' });
      COLORS.forEach(hex => {
        const btn = el('button', {
          type: 'button', class: 'sbc-color-swatch', title: hex,
          style: `background: ${hex}; border-color: ${hex}`,
          onclick: (e) => { e.preventDefault(); insertColor(hex, isBg); closeAllMenus(); textarea.focus(); }
        }, '');
        menu.append(btn);
      });
      return menu;
    }

    function applyHeading(prefix) {
      const ta = textarea;
      const { selectionStart: s, selectionEnd: en, value } = ta;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const lineEnd = value.indexOf('\n', en);
      const actualEnd = lineEnd === -1 ? value.length : lineEnd;
      const line = value.slice(lineStart, actualEnd);
      const cleanLine = line.replace(/^#+\s+/, '');
      const newLine = prefix ? prefix + cleanLine : cleanLine;
      ta.setRangeText(newLine, lineStart, actualEnd, 'end');
      updateCount(); saveDraftSoon();
    }
    function insertColor(hex, isBg) {
      const ta = textarea;
      const { selectionStart: s, selectionEnd: en, value } = ta;
      const selected = value.slice(s, en) || 'text';
      const tag = isBg ? 'bg' : 'color';
      const marker = `{${tag}:${hex}:${selected}}`;
      ta.setRangeText(marker, s, en, 'end');
      updateCount(); saveDraftSoon();
    }
    function insertLink() {
      const ta = textarea;
      const { selectionStart: s, selectionEnd: en, value } = ta;
      const selected = value.slice(s, en) || 'link';
      const url = prompt('Enter URL (https:// required):', 'https://');
      if (!url) return;
      if (!/^https:\/\//.test(url)) { alert('Only https:// URLs allowed'); return; }
      const marker = `[${selected}](${url})`;
      ta.setRangeText(marker, s, en, 'end');
      updateCount(); saveDraftSoon();
    }
    function insertImage() {
      const ta = textarea;
      alert('Paste or drag-and-drop images directly into the editor. Images are stored as base64 data URIs.');
    }

    return el('div', { id: VIEW_ID, hidden: '' },
      el('div', { class: 'sbc-log-header' },
        el('span', { class: 'sbc-log-title', text: 'Activity log' }),
        el('div', { class: 'sbc-chips', 'data-role': 'chips' }),
        el('span', { class: 'sbc-spacer' }),
        el('button', { type: 'button', class: 'sbc-tool', 'data-role': 'reload', title: 'Reload activity',
          onclick: () => enabledSources.forEach(k => loadSource(k)) }, el('span', { class: 'sbc-reload-icon', text: '⟳' }))
      ),
      el('div', { class: 'sbc-log', 'data-role': 'log' }),
      el('div', { class: 'sbc-composer' },
        el('div', { class: 'sbc-toolbar' },
          el('div', { class: 'sbc-toolbar-group' },
            el('button', { type: 'button', class: 'sbc-tool sbc-dropdown-toggle', title: 'Text style',
              onclick: (e) => toggleMenu(e.currentTarget, buildHeaderMenu) }, '¶'),
            toolbarBtn(el('b', { text: 'B' }), 'Bold (Ctrl+B)', () => wrap('**', '**')),
            toolbarBtn(el('i', { text: 'I' }), 'Italic (Ctrl+I)', () => wrap('*', '*')),
            toolbarBtn(el('u', { text: 'U' }), 'Underline', () => wrap('__', '__')),
            toolbarBtn(el('s', { text: 'S' }), 'Strikethrough', () => wrap('~~', '~~'))
          ),
          el('div', { class: 'sbc-toolbar-group' },
            toolbarBtn('🔗', 'Link', insertLink),
            toolbarBtn('🖼', 'Image (paste into editor)', insertImage)
          ),
          el('div', { class: 'sbc-toolbar-group' },
            el('button', { type: 'button', class: 'sbc-tool sbc-dropdown-toggle', title: 'Text color',
              style: 'position: relative',
              onclick: (e) => toggleMenu(e.currentTarget, () => buildColorMenu(false)) },
              el('span', { style: 'display: inline-block; width: 12px; height: 12px; background: #e60000; border-radius: 2px; vertical-align: -2px' })),
            el('button', { type: 'button', class: 'sbc-tool sbc-dropdown-toggle', title: 'Background color',
              onclick: (e) => toggleMenu(e.currentTarget, () => buildColorMenu(true)) },
              el('span', { style: 'display: inline-block; width: 12px; height: 12px; background: #ffff00; border: 1px solid #666; border-radius: 2px; vertical-align: -2px' }))
          ),
          el('div', { class: 'sbc-toolbar-group' },
            toolbarBtn('•', 'Bullet list', () => prefixLines('- ')),
            toolbarBtn('1.', 'Numbered list', () => prefixLines('1. ')),
            toolbarBtn('← ', 'Decrease indent', () => decreaseIndent()),
            toolbarBtn(' →', 'Increase indent', () => increaseIndent())
          ),
          el('div', { class: 'sbc-toolbar-group' },
            toolbarBtn('"', 'Blockquote', () => prefixLines('> ')),
            toolbarBtn('</>', 'Code block (type `backticks` for inline code)', () => wrap('\n```\n', '\n```\n')),
            toolbarBtn('✕', 'Clear formatting', clearFormatting)
          ),
          el('span', { class: 'sbc-spacer' }),
          el('button', { type: 'button', class: 'sbc-tool', 'data-role': 'preview-btn', onclick: togglePreview }, 'Preview')
        ),
        // Side-by-side editor: what you type on the left, how it will look once posted on the right.
        el('div', { class: 'sbc-editor', 'data-role': 'editor' },
          el('div', { class: 'sbc-pane' },
            el('div', { class: 'sbc-pane-label', text: 'Write' }),
            textarea),
          el('div', { class: 'sbc-pane', 'data-role': 'preview-pane' },
            el('div', { class: 'sbc-pane-label', text: 'Preview' }),
            el('div', { class: 'sbc-preview sbc-body', 'data-role': 'preview' }))
        ),
        el('div', { class: 'sbc-footer' },
          el('span', { 'data-role': 'count', class: 'sbc-muted' }),
          el('span', { 'data-role': 'status', class: 'sbc-status' }),
          el('span', { class: 'sbc-spacer' }),
          el('span', { class: 'sbc-muted', text: 'Ctrl+Enter to post' }),
          el('button', { type: 'button', class: 'sbc-post', 'data-role': 'post', onclick: (e) => { if (e.isTrusted) postComment(); } }, 'Comment')
        )
      )
    );

    function decreaseIndent() {
      const ta = textarea;
      const { value } = ta;
      const s = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      let en = value.indexOf('\n', ta.selectionEnd);
      if (en === -1) en = value.length;
      const lines = value.slice(s, en).split('\n');
      ta.setRangeText(lines.map(l => l.replace(/^\s{0,2}/, '')).join('\n'), s, en, 'end');
      updateCount(); saveDraftSoon();
    }
    function increaseIndent() {
      const ta = textarea;
      const { value } = ta;
      const s = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      let en = value.indexOf('\n', ta.selectionEnd);
      if (en === -1) en = value.length;
      const lines = value.slice(s, en).split('\n');
      ta.setRangeText(lines.map(l => '  ' + l).join('\n'), s, en, 'end');
      updateCount(); saveDraftSoon();
    }
    function clearFormatting() {
      const ta = textarea;
      const { selectionStart: s, selectionEnd: en, value } = ta;
      if (s === en) { ta.value = ta.value.replace(/[*_`~#>-]/g, ''); updateCount(); saveDraftSoon(); return; }
      const selected = value.slice(s, en);
      const cleaned = selected.replace(/[*_`~#{:}[\]()]/g, '');
      ta.setRangeText(cleaned, s, en, 'end');
      updateCount(); saveDraftSoon();
    }
  }
  const $ = (sel) => document.getElementById(VIEW_ID)?.querySelector(sel);

  // ---------- Composer
  function onComposerKey(e) {
    if (!e.isTrusted) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); postComment(); }
    else if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); wrap('**', '**'); }
    else if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); wrap('*', '*'); }
    else if (mod && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); wrap('`', '`'); }
    e.stopPropagation(); // keep the portal's keyboard shortcuts out of the editor
  }

  function wrap(before, after) {
    const ta = $('textarea');
    const { selectionStart: s, selectionEnd: en, value } = ta;
    ta.setRangeText(before + value.slice(s, en) + after, s, en, 'end');
    if (s === en) ta.selectionStart = ta.selectionEnd = s + before.length;
    updateCount(); saveDraftSoon();
  }
  function prefixLines(prefix) {
    const ta = $('textarea');
    const { value } = ta;
    const s = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let en = value.indexOf('\n', ta.selectionEnd);
    if (en === -1) en = value.length;
    const lines = value.slice(s, en).split('\n');
    const numbered = prefix === '1. ';
    ta.setRangeText(lines.map((l, i) => (numbered ? `${i + 1}. ` : prefix) + l).join('\n'), s, en, 'end');
    updateCount(); saveDraftSoon();
  }
  function updateCount() {
    const n = $('textarea').value.length;
    const c = $('[data-role="count"]');
    c.textContent = `${n.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;
    c.classList.toggle('sbc-warn', n > MAX_CHARS * 0.9);
    schedulePreview(); // every edit path (typing, toolbar, draft restore, post) goes through here
  }
  function setStatus(text, kind) {
    const s = $('[data-role="status"]');
    if (!s) return;
    s.textContent = text || '';
    s.className = `sbc-status${kind ? ` sbc-${kind}` : ''}`;
  }

  // ---------- Rich paste (OneNote, Word, web pages). The editor is a plain textarea, so HTML on the
  // clipboard is converted into the editor's own syntax: formatting survives, stays editable and
  // shows in the live preview. Plain-text pastes (and Ctrl+Shift+V) are left to the browser.
  function onComposerPaste(e) {
    if (!e.isTrusted) return;
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    let text;
    try { text = htmlToEditorText(html); } catch { return; } // fall back to the browser's plain paste
    if (!text) return;
    e.preventDefault();
    const ta = e.currentTarget;
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    updateCount(); saveDraftSoon();
  }

  const PASTE_SKIP = new Set(['STYLE', 'SCRIPT', 'META', 'TITLE', 'HEAD', 'LINK', 'XML', 'TEMPLATE', 'IMG', 'SVG', 'OBJECT', 'IFRAME']);
  const PASTE_BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'PRE', 'BLOCKQUOTE',
    'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'DL', 'DT', 'DD', 'ADDRESS']);
  const colorCtx = document.createElement('canvas').getContext('2d');

  // Any CSS color (hex, rgb(), names like OneNote's "yellow") → #rrggbb, or null.
  function toHex(value) {
    const v = String(value || '').trim().toLowerCase().replace(/\s*!important$/, '');
    if (!v || /^(transparent|inherit|initial|unset|currentcolor|auto|windowtext|none)$/.test(v) || v.startsWith('var(')) return null;
    colorCtx.fillStyle = '#010203';
    colorCtx.fillStyle = v;
    const out = colorCtx.fillStyle;
    if (out === '#010203' && v !== '#010203') return null; // not a color
    return /^#[0-9a-f]{6}$/i.test(out) ? out : null; // translucent colors come back as rgba(): skip
  }

  // Inline style attribute → { prop: value } (manual parse so mso-* properties survive).
  function styleOf(node) {
    const out = {};
    (node.getAttribute('style') || '').split(';').forEach(d => {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().toLowerCase();
    });
    return out;
  }

  // Formatting an element applies itself (tags, OneNote/Word inline styles, <font color>).
  function formatsOf(node) {
    const tag = node.tagName;
    const st = styleOf(node);
    const deco = `${st['text-decoration'] || ''} ${st['text-decoration-line'] || ''}`;
    const weight = st['font-weight'] || '';
    const href = tag === 'A' ? (node.getAttribute('href') || '') : '';
    let bg = toHex(st['background-color']) || toHex(st['mso-highlight']);
    if (!bg && st.background && !/url\(/.test(st.background)) bg = toHex(st.background.split(/\s+/)[0]);
    return {
      bold: /^(B|STRONG)$/.test(tag) || /^(bold|bolder|[6-9]00)$/.test(weight),
      italic: /^(I|EM)$/.test(tag) || st['font-style'] === 'italic',
      underline: tag === 'U' || /underline/.test(deco),
      strike: /^(S|STRIKE|DEL)$/.test(tag) || /line-through/.test(deco),
      code: /^(CODE|KBD|SAMP|TT)$/.test(tag) || /consolas|courier|monospace/.test(st['font-family'] || ''),
      color: toHex(st.color || node.getAttribute('color')),
      bg,
      link: /^https:\/\/\S+$/i.test(href) ? href.replace(/[()\s]/g, c => encodeURIComponent(c)) : null
    };
  }

  // Formatting inherited by children; colors only count when they differ from plain black/white.
  function childCtx(node, ctx) {
    const f = formatsOf(node);
    const color = f.color && f.color !== '#000000' ? f.color : (f.color ? null : ctx.color);
    const bg = f.bg && f.bg !== '#ffffff' ? f.bg : (f.bg ? null : ctx.bg);
    return {
      bold: ctx.bold || f.bold, italic: ctx.italic || f.italic, underline: ctx.underline || f.underline,
      strike: ctx.strike || f.strike, code: ctx.code || f.code, link: ctx.link || f.link, color, bg
    };
  }

  // Wrap each non-empty line in markers, keeping edge whitespace outside them (markers can't span lines).
  function wrapEach(s, open, close) {
    return s.split('\n').map(seg => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(seg);
      return m[2] ? `${m[1]}${open}${m[2]}${close}${m[3]}` : seg;
    }).join('\n');
  }
  const oneLine = (s) => s.replace(/\s*\n\s*/g, ' ').trim();

  // Inline conversion of a node. Bold/italic/etc. wrap at the element that turns them on; colors
  // wrap each text run so color markers never nest.
  function pasteInline(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      let t = node.nodeValue.replace(/[\s ]+/g, ' ');
      if (!t.trim()) return t;
      if (ctx.color && !ctx.code && !t.includes('}')) t = wrapEach(t, `{color:${ctx.color}:`, '}');
      if (ctx.bg && !ctx.code && !t.includes('}')) t = wrapEach(t, `{bg:${ctx.bg}:`, '}');
      return t;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toUpperCase();
    if (PASTE_SKIP.has(tag)) return '';
    if (tag === 'BR') return '\n';
    const inner = ctx2 => [...node.childNodes].map(c => pasteInline(c, ctx2)).join('');
    const cc = childCtx(node, ctx);
    let s = inner(cc);
    if (PASTE_BLOCK.has(tag)) s = `\n${s}\n`;
    return wrapFormats(node, s, ctx);
  }

  function wrapFormats(node, s, ctx) {
    const f = formatsOf(node);
    if (!s.trim()) return s;
    if (f.code && !ctx.code && !s.includes('`')) return wrapEach(s, '`', '`');
    if (ctx.code) return s;
    if (f.strike && !ctx.strike) s = wrapEach(s, '~~', '~~');
    if (f.underline && !ctx.underline && !f.link) s = wrapEach(s, '__', '__');
    if (f.italic && !ctx.italic) s = wrapEach(s, '*', '*');
    if (f.bold && !ctx.bold) s = wrapEach(s, '**', '**');
    if (f.link && !ctx.link && !/[[\]]/.test(s)) s = `[${oneLine(s)}](${f.link})`;
    return s;
  }

  // Block conversion: one editor line per paragraph / list item / table row.
  function pasteBlocks(parent, lines, ctx) {
    let buf = '';
    const flush = () => {
      buf.split('\n').forEach(l => { if (l.trim()) lines.push(l.trim()); });
      buf = '';
    };
    for (const node of parent.childNodes) {
      const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName.toUpperCase() : '';
      if (!tag || !PASTE_BLOCK.has(tag)) { buf += pasteInline(node, ctx); continue; }
      flush();
      const cc = childCtx(node, ctx);
      if (/^H[1-6]$/.test(tag)) {
        const text = oneLine(pasteInline(node, { ...ctx, bold: true }));
        if (text) lines.push(`${'#'.repeat(Math.min(Number(tag[1]), 3))} ${text}`);
      } else if (tag === 'UL' || tag === 'OL') {
        pasteList(node, lines, 0, ctx);
      } else if (tag === 'LI') {
        lines.push(`- ${oneLine(pasteInline(node, ctx))}`);
      } else if (tag === 'TABLE') {
        pasteTable(node, lines, ctx);
      } else if (tag === 'PRE') {
        lines.push('```', ...node.textContent.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n'), '```');
      } else if (tag === 'BLOCKQUOTE') {
        const inner = [];
        pasteBlocks(node, inner, cc);
        inner.filter(Boolean).forEach(l => lines.push(`> ${l}`));
      } else if (tag === 'HR') {
        lines.push('');
      } else if ([...node.children].some(c => PASTE_BLOCK.has(c.tagName.toUpperCase()))) {
        // Layout wrapper (OneNote nests several): recurse, passing down its colors. Bold/italic on a
        // wrapper itself isn't carried over (wrapping whole lines would break list/table syntax).
        pasteBlocks(node, lines, { ...ctx, color: cc.color, bg: cc.bg });
      } else {
        const text = pasteInline(node, ctx);
        if (text.trim()) { buf = text; flush(); } else lines.push(''); // empty paragraph = spacer line
      }
    }
    flush();
  }

  // Lists nest by 2-space indentation. OneNote puts nested <ul>/<ol> directly inside the parent
  // list (siblings of <li>); browsers/Word put them inside the <li>. Both are handled.
  function pasteList(list, lines, depth, ctx) {
    const ordered = list.tagName.toUpperCase() === 'OL';
    let n = 0;
    for (const child of list.children) {
      const tag = child.tagName.toUpperCase();
      if (tag === 'UL' || tag === 'OL') { pasteList(child, lines, depth + 1, ctx); continue; }
      if (tag !== 'LI') continue;
      n++;
      const nested = [];
      const cc = childCtx(child, ctx);
      let text = '';
      for (const k of child.childNodes) {
        const kt = k.nodeType === Node.ELEMENT_NODE ? k.tagName.toUpperCase() : '';
        if (kt === 'UL' || kt === 'OL') nested.push(k);
        else text += pasteInline(k, cc);
      }
      text = wrapFormats(child, oneLine(text), ctx);
      lines.push(`${'  '.repeat(depth)}${ordered ? `${n}.` : '-'} ${text}`);
      nested.forEach(k => pasteList(k, lines, depth + 1, ctx));
    }
  }

  // Tables become "| a | b |" rows. OneNote sometimes wraps content in a single-cell table; that's
  // unwrapped instead.
  function pasteTable(table, lines, ctx) {
    const rows = [...table.querySelectorAll('tr')].filter(r => r.closest('table') === table);
    const cellsOf = (r) => [...r.children].filter(c => /^(TD|TH)$/i.test(c.tagName));
    if (rows.length === 1 && cellsOf(rows[0]).length === 1) {
      pasteBlocks(cellsOf(rows[0])[0], lines, ctx);
      return;
    }
    rows.forEach((r, i) => {
      const cells = cellsOf(r).map(c => oneLine(pasteInline(c, ctx)).replace(/\|/g, '\\|'));
      lines.push(`| ${cells.join(' | ')} |`);
      if (i === 0 && (cellsOf(r).every(c => c.tagName.toUpperCase() === 'TH') || r.closest('thead'))) {
        lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
      }
    });
    lines.push('');
  }

  function htmlToEditorText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const lines = [];
    pasteBlocks(doc.body, lines, { bold: false, italic: false, underline: false, strike: false, code: false, link: null, color: null, bg: null });
    // Collapse runs of blank lines and trim blank edges.
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }

  // Live preview, rendered with the same converter + sanitizer used for posting and for the log,
  // so it matches what the comment will look like. On by default; the choice is remembered.
  let livePreview = true;
  let previewFrame = 0;
  chrome.storage.local.get({ commentsLivePreview: true }, (s) => {
    livePreview = s.commentsLivePreview !== false;
    applyPreviewVisibility();
  });

  function applyPreviewVisibility() {
    const pane = $('[data-role="preview-pane"]');
    if (!pane) return;
    pane.hidden = !livePreview;
    const btn = $('[data-role="preview-btn"]');
    btn.textContent = livePreview ? 'Hide preview' : 'Show preview';
    btn.title = livePreview ? 'Hide the live preview' : 'Show a live preview of how the comment will look';
    btn.setAttribute('aria-pressed', String(livePreview));
    schedulePreview();
  }

  function togglePreview() {
    livePreview = !livePreview;
    chrome.storage.local.set({ commentsLivePreview: livePreview });
    applyPreviewVisibility();
    $('textarea')?.focus();
  }

  function schedulePreview() {
    if (!livePreview || previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      renderPreview();
    });
  }

  function renderPreview() {
    const ta = $('textarea');
    const pv = $('[data-role="preview"]');
    if (!ta || !pv || !livePreview) return;
    pv.replaceChildren();
    if (!ta.value.trim()) {
      pv.append(el('span', { class: 'sbc-preview-empty', text: 'Your formatted comment will appear here.' }));
      return;
    }
    appendSanitized(pv, toCommentHtml(ta.value));
    syncPreviewScroll();
  }

  // Keep the preview roughly aligned with the part of the text being edited.
  function syncPreviewScroll() {
    const ta = $('textarea');
    const pv = $('[data-role="preview"]');
    if (!ta || !pv || !livePreview) return;
    const max = ta.scrollHeight - ta.clientHeight;
    pv.scrollTop = max > 0 ? (ta.scrollTop / max) * (pv.scrollHeight - pv.clientHeight) : 0;
  }

  // Drafts survive tab switches and reloads (browser-session storage via the service worker).
  async function loadDraft() {
    const ta = $('textarea');
    if (!ta || ta.value) { updateCount(); return; }
    const res = await send({ type: 'comment-draft', op: 'get', incidentArmId });
    if (res?.text && !ta.value) { ta.value = res.text; setStatus('Draft restored', 'muted'); }
    updateCount();
  }
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    const id = incidentArmId;
    draftTimer = setTimeout(() => {
      const ta = $('textarea');
      if (ta) send({ type: 'comment-draft', op: 'set', incidentArmId: id, text: ta.value });
    }, 500);
  }

  let posting = false;
  async function postComment() {
    const ta = $('textarea');
    const text = ta.value;
    if (posting || !text.trim()) return;
    const html = toCommentHtml(text);
    if (html.length > MAX_CHARS) { setStatus('Comment is too long once formatted', 'error'); return; }
    posting = true;
    const btn = $('[data-role="post"]');
    btn.disabled = true;
    setStatus('Posting…');
    const res = await op('add-comment', { message: html });
    posting = false;
    btn.disabled = false;
    if (res.error) { setStatus(`Couldn't post: ${res.error}`, 'error'); return; }
    ta.value = '';
    clearTimeout(draftTimer);
    send({ type: 'comment-draft', op: 'set', incidentArmId, text: '' });
    updateCount();
    setStatus('Comment posted', 'ok');
    loadSource('comments', { scrollToEnd: true });
  }

  // Markdown-lite → HTML. Everything is HTML-escaped FIRST, so only the tags produced here exist.
  // URLs are deliberately not auto-linked (SOC comments are full of live IOCs).
  //
  // Azure renders the stored comment as Markdown (inline HTML allowed), not as plain HTML: a comment
  // that starts with text gets Markdown applied, so e.g. stray backticks became a code span showing
  // our raw <br> tags. Like the old SentiBuddy note generator, the output is one block-level HTML
  // element (<div>…</div>) with no raw newlines, which Markdown passes through untouched. Markdown
  // punctuation left in text is also entity-encoded in case a renderer looks inside HTML anyway.
  // That keeps the live preview identical to what Azure shows.
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const MD_ENTITY = { '*': '&#42;', '_': '&#95;', '`': '&#96;', '~': '&#126;', '[': '&#91;', ']': '&#93;', '\\': '&#92;' };
  function markdownInert(html) {
    // Text can't contain "<" (escaped above), so <...> only ever matches tags we generated.
    const inert = html.replace(/(<[^>]*>)|([*_`~[\]\\])/g, (_m, tag, ch) => tag || MD_ENTITY[ch]);
    return `<div>${inert}</div>`;
  }
  function inlineMd(s) {
    return s
      .replace(/\{color:([#0-9a-fA-F]{6,7}):([^}]+)\}/g, '<span style="color: $1">$2</span>')
      .replace(/\{bg:([#0-9a-fA-F]{6,7}):([^}]+)\}/g, '<span style="background-color: $1; padding: 0 2px">$2</span>')
      .replace(/\[([^\[\]]+)\]\(https:\/\/[^\s\)]+\)/g, (m) => {
        const match = /\[([^\[\]]+)\]\((https:\/\/[^\s\)]+)\)/.exec(m);
        return `<a href="${escapeHtml(match[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1])}</a>`;
      })
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
      .replace(/__([^_\n]+)__/g, '<u>$1</u>')
      .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  }
  function toCommentHtml(text) {
    const parts = text.replace(/\r\n/g, '\n').split(/```/);
    const out = [];
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        out.push(`<pre><code>${escapeHtml(part.replace(/^\n|\n$/g, '')).replace(/\n/g, '<br>')}</code></pre>`);
        return;
      }
      const lines = escapeHtml(part).split('\n');
      // Lists nest by indentation (2 spaces per level); each level keeps its <li> open so nested
      // lists sit inside their parent item.
      const listStack = [];
      const closeListsTo = (level) => {
        while (listStack.length > level) out.push(`</li></${listStack.pop()}>`);
      };
      const closeList = () => closeListsTo(0);
      // Tables: consecutive "| a | b |" lines; a "| --- | --- |" row makes the row above a header.
      let tableRows = [];
      const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
      const splitCells = (row) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());
      const flushTable = () => {
        if (!tableRows.length) return;
        const header = tableRows.length > 1 && TABLE_SEP.test(tableRows[1]);
        const rows = tableRows.filter(r => !TABLE_SEP.test(r));
        out.push('<table>');
        rows.forEach((r, ri) => {
          const tag = header && ri === 0 ? 'th' : 'td';
          out.push(`<tr>${splitCells(r).map(c => `<${tag}>${inlineMd(c)}</${tag}>`).join('')}</tr>`);
        });
        out.push('</table>');
        tableRows = [];
      };
      lines.forEach((line, idx) => {
        if (/^\s*\|.*\|\s*$/.test(line)) {
          closeList();
          tableRows.push(line);
          return;
        }
        flushTable();
        const header = /^(#{1,3})\s+(.*)$/.exec(line);
        const blockquote = /^&gt;\s?(.*)$/.exec(line); // ">" is already escaped here
        const listItem = /^(\s*)(?:([-*])|\d+[.)])\s+(.*)$/.exec(line);
        const indent = /^(\s+)(.*)$/.exec(line);
        if (header) {
          closeList();
          const level = header[1].length;
          out.push(`<h${level}>${inlineMd(header[2])}</h${level}>`);
          return;
        }
        if (blockquote) {
          closeList();
          out.push(`<blockquote>${inlineMd(blockquote[1])}</blockquote>`);
          return;
        }
        if (listItem) {
          const kind = listItem[2] ? 'ul' : 'ol';
          const level = Math.min(Math.floor(listItem[1].length / 2), 6);
          closeListsTo(level + 1);
          if (listStack.length === level + 1) {
            if (listStack[level] === kind) out.push('</li>');
            else closeListsTo(level);
          }
          while (listStack.length < level + 1) { out.push(`<${kind}>`); listStack.push(kind); }
          out.push(`<li>${inlineMd(listItem[3])}`);
          return;
        }
        closeList();
        const content = indent ? `<div style="margin-left: ${Math.min(indent[1].length, 8) * 20}px">${inlineMd(indent[2])}</div>` : inlineMd(line);
        out.push(content);
        if (idx < lines.length - 1) out.push('<br>');
      });
      flushTable();
      closeList();
    });
    return markdownInert(out.join('').replace(/^(<br>)+|(<br>)+$/g, ''));
  }

  // ---------- Safe HTML rendering for existing comments (people and playbooks write HTML).
  // Parsed in an inert document, then rebuilt node-by-node from an allowlist.
  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'UL', 'OL', 'LI',
    'PRE', 'CODE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
    'SPAN', 'DIV', 'HR', 'A', 'IMG']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH',
    'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'AUDIO', 'VIDEO', 'SOURCE', 'TITLE', 'HEAD']);
  function appendSanitized(target, html) {
    const doc = new DOMParser().parseFromString(azureInlineMarkdown(html), 'text/html');
    copySafe(doc.body, target, 0);
  }

  // Azure displays a comment's stored HTML *and* applies inline Markdown to its text, even inside
  // tags: "<p>**Overview:**</p>" shows bold, `x` shows as code, "\)" shows as ")". Do the same on
  // the raw HTML string (before entities are decoded) so the log and the preview match Azure.
  // Comments posted by SentiBuddy entity-encode these characters (markdownInert), so they stay literal
  // here exactly as they do in Azure. Runs before sanitizing; it only adds allowlisted tags.
  function azureInlineMarkdown(html) {
    let skip = 0; // inside <code>/<pre>: no Markdown
    return String(html || '').split(/(<[^>]*>)/).map(part => {
      if (part.startsWith('<')) {
        const m = /^<(\/?)(code|pre)\b/i.exec(part);
        if (m) skip = Math.max(0, skip + (m[1] ? -1 : 1));
        return part;
      }
      return skip || !part ? part : inlineMarkdownText(part);
    }).join('');
  }

  function inlineMarkdownText(s) {
    const held = [];
    const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
    // `code` spans (matching backtick runs; an unmatched run stays literal), then backslash escapes.
    s = s.replace(/(^|[^`])(`+)(?!`)([\s\S]*?[^`])\2(?!`)/g,
      (_m, pre, _ticks, body) => pre + hold(`<code>${body.replace(/^ ([\s\S]*\S[\s\S]*) $/, '$1')}</code>`));
    s = s.replace(/\\([!-%'-/:;=?@[-`{-~])/g, (_m, c) => hold(`&#${c.charCodeAt(0)};`));
    s = s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
      .replace(/(^|\W)_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => held[Number(i)]);
  }
  function copySafe(src, dest, depth) {
    if (depth > 40) return;
    for (const child of src.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { dest.append(child.nodeValue); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      if (!ALLOWED.has(tag)) { copySafe(child, dest, depth + 1); continue; } // unwrap unknown tags, keep text
      if (tag === 'IMG') {
        // Only inline images pasted into comments; never fetch remote URLs (tracking pixels).
        const srcAttr = child.getAttribute('src') || '';
        if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(srcAttr)) {
          dest.append(el('img', { src: srcAttr, alt: child.getAttribute('alt') || '', class: 'sbc-img' }));
        } else {
          dest.append('[image]');
        }
        continue;
      }
      const node = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        if (/^https:\/\//i.test(href)) {
          node.href = href;
          node.target = '_blank';
          node.rel = 'noopener noreferrer';
          node.title = href;
        }
      }
      if (tag === 'TD' || tag === 'TH') {
        for (const a of ['colspan', 'rowspan']) {
          const v = child.getAttribute(a);
          if (v && /^\d{1,2}$/.test(v)) node.setAttribute(a, v);
        }
      }
      if (tag === 'SPAN' || tag === 'DIV') {
        const style = child.getAttribute('style') || '';
        const safeStyles = style
          .split(';').filter(s => s.trim())
          .map(s => {
            const [prop, val] = s.split(':').map(p => p.trim());
            if (!prop || !val) return '';
            if (prop === 'color' && /^#[0-9a-f]{6}$/i.test(val)) return `color: ${val}`;
            if (prop === 'background-color' && /^#[0-9a-f]{6}$/i.test(val)) return `background-color: ${val}; padding: 0 2px`;
            return '';
          }).filter(s => s).join('; ');
        if (safeStyles) node.setAttribute('style', safeStyles);
      }
      copySafe(child, node, depth + 1);
      dest.append(node);
    }
  }

  // ---------- Activity log
  // Reloads keep showing what's already listed (st.data is only replaced when the new data arrives);
  // the header's reload icon spins meanwhile.
  async function loadSource(key, opts = {}) {
    if (!incidentArmId) return;
    const def = SOURCES.find(s => s.key === key);
    const st = sources[key];
    if (st.loading) return;
    const forId = incidentArmId;
    st.fetched = true;
    st.loading = true;
    renderLog();
    const res = await op(def.op);
    if (forId !== incidentArmId) return;
    st.loading = false;
    if (res.error || res.unavailable) {
      st.note = `${def.label} unavailable: ${res.error || res.unavailable}`;
    } else {
      st.data = key === 'comments' ? res.comments : (res.rows || []);
      st.note = '';
    }
    renderLog(opts);
  }

  function toggleSource(key) {
    if (enabledSources.has(key)) enabledSources.delete(key);
    else {
      enabledSources.add(key);
      if (!sources[key].fetched) loadSource(key);
    }
    renderLog();
  }

  const ownerName = (o) => {
    if (!o) return 'Unassigned';
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return o || 'Unassigned'; } }
    return o.assignedTo || o.email || o.userPrincipalName || 'Unassigned';
  };
  const labelNames = (l) => {
    if (typeof l === 'string') { try { l = JSON.parse(l); } catch { return []; } }
    return Array.isArray(l) ? l.map(x => x?.labelName).filter(Boolean) : [];
  };

  // Turn consecutive SecurityIncident rows into "X changed from A to B" entries.
  function historyEntries(rows) {
    const out = [];
    let prev = null;
    for (const r of rows) {
      const time = r.LastModifiedTime;
      const by = r.ModifiedBy || '';
      if (!prev) {
        out.push({ kind: 'update', time, by, text: `Incident created (${r.Severity || '?'} · ${r.Status || '?'})` });
      } else {
        const changes = [];
        for (const [field, label] of [['Status', 'Status'], ['Severity', 'Severity'], ['Classification', 'Classification'], ['Title', 'Title']]) {
          if ((prev[field] || '') !== (r[field] || '')) changes.push(`${label}: ${prev[field] || '—'} → ${r[field] || '—'}`);
        }
        const po = ownerName(prev.Owner), no = ownerName(r.Owner);
        if (po !== no) changes.push(`Owner: ${po} → ${no}`);
        const pl = new Set(labelNames(prev.Labels)), nl = new Set(labelNames(r.Labels));
        const added = [...nl].filter(x => !pl.has(x)), removed = [...pl].filter(x => !nl.has(x));
        if (added.length) changes.push(`Tags added: ${added.join(', ')}`);
        if (removed.length) changes.push(`Tags removed: ${removed.join(', ')}`);
        changes.forEach(text => out.push({ kind: 'update', time, by, text }));
      }
      prev = r;
    }
    return out;
  }

  function fmtTime(t) {
    const d = new Date(t);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // SentinelHealth rows → entries ("Playbook 'x' — Success").
  function automationEntries(rows) {
    return rows.map(r => ({
      kind: 'automation',
      time: r.TimeGenerated,
      status: String(r.Status || ''),
      text: `${r.SentinelResourceType || 'Automation'} "${r.SentinelResourceName || '?'}" — ${r.Status || 'Unknown'}`,
      detail: [r.Description, r.Reason].filter(Boolean).join(' · ')
    }));
  }

  function entriesFor(key) {
    const data = sources[key].data;
    if (!data) return [];
    if (key === 'comments') return data.map(c => ({ kind: 'comment', time: c.time, by: c.author, html: c.message }));
    if (key === 'activities') return historyEntries(data);
    return automationEntries(data);
  }

  // Same chip style as the Enhanced Queue's severity/status filters.
  function renderChips() {
    const box = $('[data-role="chips"]');
    if (!box) return;
    box.replaceChildren(...SOURCES.map(s => {
      const st = sources[s.key];
      const on = enabledSources.has(s.key);
      const count = st.data ? String(entriesFor(s.key).length) : st.loading ? '…' : st.note ? '!' : '';
      return el('button', {
        type: 'button',
        class: `sbc-chip${on ? ' sbc-on' : ''}`,
        'aria-pressed': String(on),
        title: st.note || (on ? `Hide ${s.label.toLowerCase()}` : `Show ${s.label.toLowerCase()}`),
        onclick: () => toggleSource(s.key)
      },
        el('span', { class: 'sbc-chip-dot', style: `background:${s.dot}` }),
        s.label,
        count ? el('span', { class: 'sbc-count', text: count }) : null);
    }));
  }

  function renderEntry(e) {
    if (e.kind === 'comment') {
      const body = el('div', { class: 'sbc-body' });
      appendSanitized(body, e.html);
      return el('div', { class: 'sbc-entry sbc-comment' },
        el('div', { class: 'sbc-entry-head' },
          el('span', { class: 'sbc-avatar', text: initials(e.by) }),
          el('span', { class: 'sbc-author', text: e.by }),
          el('span', { class: 'sbc-time', text: fmtTime(e.time) })),
        body);
    }
    if (e.kind === 'automation') {
      const status = /fail/i.test(e.status) ? 'fail' : /partial/i.test(e.status) ? 'partial' : /success/i.test(e.status) ? 'ok' : '';
      return el('div', { class: 'sbc-entry sbc-update sbc-automation' },
        el('span', { class: `sbc-dot sbc-dot-auto${status ? ` sbc-dot-${status}` : ''}` }),
        el('span', { class: 'sbc-update-text' }, e.text,
          e.detail ? el('span', { class: 'sbc-detail', text: e.detail }) : null),
        el('span', { class: 'sbc-time', text: fmtTime(e.time) }));
    }
    return el('div', { class: 'sbc-entry sbc-update' },
      el('span', { class: 'sbc-dot' }),
      el('span', { class: 'sbc-update-text', text: e.text }),
      el('span', { class: 'sbc-time', text: `${e.by ? `${e.by} · ` : ''}${fmtTime(e.time)}` }));
  }

  function renderLog(opts = {}) {
    renderChips();
    const busy = SOURCES.some(s => enabledSources.has(s.key) && sources[s.key].loading);
    const reload = $('[data-role="reload"]');
    if (reload) {
      reload.classList.toggle('sbc-loading', busy);
      reload.title = busy ? 'Checking for new or edited activity…' : 'Reload activity';
    }
    const box = $('[data-role="log"]');
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;

    const enabled = SOURCES.filter(s => enabledSources.has(s.key));
    const entries = enabled.flatMap(s => entriesFor(s.key));
    entries.sort((a, b) => new Date(a.time) - new Date(b.time));

    const nodes = entries.map(renderEntry);
    const notes = enabled.map(s => sources[s.key].note).filter(Boolean);
    const loading = enabled.some(s => sources[s.key].loading || !sources[s.key].fetched);
    if (!enabled.length) nodes.push(el('div', { class: 'sbc-empty', text: 'Select a filter above to show activity.' }));
    else if (!entries.length && loading) nodes.push(el('div', { class: 'sbc-empty', text: 'Loading activity…' }));
    else if (!entries.length && !notes.length) nodes.push(el('div', { class: 'sbc-empty', text: 'Nothing here yet.' }));
    notes.forEach(n => nodes.unshift(el('div', { class: 'sbc-note', text: n })));

    box.replaceChildren(...nodes);
    if (opts.scrollToEnd || nearBottom || !box.dataset.scrolled) {
      box.scrollTop = box.scrollHeight;
      if (entries.length) box.dataset.scrolled = '1';
    }
  }
  function initials(name) {
    const parts = String(name || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
  }

  // ---------- Boot
  new MutationObserver(scheduleSync).observe(document.documentElement, { childList: true, subtree: true });
  queryRoute();
})();
