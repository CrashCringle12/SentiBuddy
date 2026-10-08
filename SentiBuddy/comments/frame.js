// Comments tab (runs inside the portal's React view iframes, *.reactblade.portal.azure.net).
// Adds a third tab next to Overview / Entities on the incident details page with a large comment
// composer and the activity log (comments + status/owner/severity changes) above it.
//
// The view is an overlay appended to <html>, positioned over the tab content area, so React's
// own tree is never modified beyond inserting the tab button.
(() => {
  const TAB_ID = 'sb-comments-tab';
  const VIEW_ID = 'sb-comments-view';
  const MAX_CHARS = 30000;

  let incidentArmId = null;
  let active = false;
  let syncTimer = null;
  let posTimer = null;
  let draftTimer = null;

  // Activity log sources, mirroring Sentinel's filters. Each is a separate request, so only
  // Comments loads by default; the others load the first time their chip is switched on.
  const SOURCES = [
    { key: 'comments', label: 'Comments', op: 'comments', dot: 'var(--sbc-accent)' },
    { key: 'activities', label: 'Activities', op: 'history', dot: 'var(--sbc-muted)' },
    { key: 'automation', label: 'Automation health', op: 'automation', dot: '#8764b8' }
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

  // Route updates are shared with escalate/frame.js (top frame owns the URL).
  function queryRoute() {
    chrome.runtime.sendMessage({ type: 'escalate-frame-query' }, (res) => {
      void chrome.runtime.lastError;
      setIncident(res?.incidentArmId || null);
    });
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'escalate-route') setIncident(msg.incidentArmId || null);
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

  // The Overview/Entities tab strip. Fluent tabs render their label twice (visible + reserved
  // space), so match on "starts with" after collapsing.
  function findTabs() {
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      const tabs = [...list.querySelectorAll('[role="tab"]')].filter(t => t.id !== TAB_ID);
      const overview = tabs.find(t => /^overview/i.test(tabLabel(t)));
      const entities = tabs.find(t => /^entities/i.test(tabLabel(t)));
      if (overview && entities) return { list, tabs, overview, entities };
    }
    return null;
  }

  // Build our tab by cloning a native unselected tab so it matches Sentinel's styling exactly.
  // A cloned node carries no React handlers.
  function buildTab(found) {
    const template = found.tabs.find(t => t.getAttribute('aria-selected') !== 'true') || found.entities;
    const tab = template.cloneNode(true);
    tab.id = TAB_ID;
    tab.setAttribute('aria-selected', 'false');
    tab.removeAttribute('aria-controls');
    tab.removeAttribute('data-tabster');
    tab.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    // Fluent renders the label in more than one span (visible + reserved width); rename them all.
    texts.forEach(t => { if (t.nodeValue.trim()) t.nodeValue = 'Comments'; });
    if (!texts.some(t => t.nodeValue === 'Comments')) tab.textContent = 'Comments';
    // SentiBuddy icon inline before each label copy (keeps Fluent's reserved width in step).
    const walker2 = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
    const labels = [];
    while (walker2.nextNode()) if (walker2.currentNode.nodeValue === 'Comments') labels.push(walker2.currentNode);
    labels.forEach(t => {
      const icon = document.createElement('img');
      icon.className = 'sb-comments-tab-icon';
      icon.src = chrome.runtime.getURL('icon.png');
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
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
    const found = findTabs();
    if (found && !seenTabs) queryRoute();
    seenTabs = !!found;

    let tab = document.getElementById(TAB_ID);
    if (!incidentArmId || !found) {
      tab?.remove();
      if (active) deactivate();
      return;
    }
    if (!tab || tab.parentElement !== found.entities.parentElement || tab.previousElementSibling !== found.entities) {
      tab = tab || buildTab(found);
      found.entities.insertAdjacentElement('afterend', tab);
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
    enabledSources.forEach(k => { if (!sources[k].loading) loadSource(k); });
  }

  function deactivate() {
    active = false;
    clearInterval(posTimer);
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
      onkeydown: onComposerKey
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
        el('button', { type: 'button', class: 'sbc-tool', title: 'Reload activity',
          onclick: () => enabledSources.forEach(k => loadSource(k)) }, '⟳')
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
            toolbarBtn('{ }', 'Code block', () => wrap('\n```\n', '\n```\n')),
            toolbarBtn('</>', 'Inline code', () => wrap('`', '`')),
            toolbarBtn('✕', 'Clear formatting', clearFormatting)
          ),
          el('span', { class: 'sbc-spacer' }),
          el('button', { type: 'button', class: 'sbc-tool', 'data-role': 'preview-btn', title: 'Preview how the comment will look', onclick: togglePreview }, 'Preview')
        ),
        textarea,
        el('div', { class: 'sbc-preview', 'data-role': 'preview', hidden: '' }),
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
  }
  function setStatus(text, kind) {
    const s = $('[data-role="status"]');
    if (!s) return;
    s.textContent = text || '';
    s.className = `sbc-status${kind ? ` sbc-${kind}` : ''}`;
  }

  function togglePreview() {
    const ta = $('textarea');
    const pv = $('[data-role="preview"]');
    const showing = !pv.hidden;
    if (showing) {
      pv.hidden = true; ta.hidden = false; $('[data-role="preview-btn"]').textContent = 'Preview'; ta.focus();
    } else {
      pv.replaceChildren();
      appendSanitized(pv, toCommentHtml(ta.value));
      pv.style.height = `${ta.offsetHeight}px`;
      pv.hidden = false; ta.hidden = true; $('[data-role="preview-btn"]').textContent = 'Edit';
    }
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
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
        out.push(`<pre><code>${escapeHtml(part.replace(/^\n|\n$/g, ''))}</code></pre>`);
        return;
      }
      const lines = escapeHtml(part).split('\n');
      let list = null;
      const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
      lines.forEach((line, idx) => {
        const header = /^(#{1,3})\s+(.*)$/.exec(line);
        const blockquote = /^>\s+(.*)$/.exec(line);
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
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
        if (bullet || num) {
          const kind = bullet ? 'ul' : 'ol';
          if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
          out.push(`<li>${inlineMd((bullet || num)[1])}</li>`);
          return;
        }
        closeList();
        const content = indent ? `<div style="margin-left: ${Math.min(indent[1].length, 8) * 20}px">${inlineMd(indent[2])}</div>` : inlineMd(line);
        out.push(content);
        if (idx < lines.length - 1) out.push('<br>');
      });
      closeList();
    });
    return out.join('').replace(/^(<br>)+|(<br>)+$/g, '');
  }

  // ---------- Safe HTML rendering for existing comments (people and playbooks write HTML).
  // Parsed in an inert document, then rebuilt node-by-node from an allowlist.
  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'UL', 'OL', 'LI',
    'PRE', 'CODE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
    'SPAN', 'DIV', 'HR', 'A', 'IMG']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH',
    'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'AUDIO', 'VIDEO', 'SOURCE', 'TITLE', 'HEAD']);
  function appendSanitized(target, html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    copySafe(doc.body, target, 0);
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
  async function loadSource(key, opts = {}) {
    if (!incidentArmId) return;
    const def = SOURCES.find(s => s.key === key);
    const st = sources[key];
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
      const count = st.loading ? '…' : st.note ? '!' : st.data ? String(entriesFor(s.key).length) : '';
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
