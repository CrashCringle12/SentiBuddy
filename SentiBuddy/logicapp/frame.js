// Logic App designer helpers (runs inside the portal's React view iframes, *.reactblade.portal.azure.net).
//
// - "Add Try/Catch" in the + (insert step) menu: inserts "Scope - <name>" containing
//   "<name> - TRY" and "<name> - CATCH" (CATCH runs after TRY failed).
// - "Surround with scope" in an action's right-click menu: inserts "Scope - <name>" above the
//   action and moves the action into it.
//
// Both put a scope on the clipboard in the designer's own copy format and trigger the designer's
// own Ctrl+V paste on the right + button, so the designer does the insertion; the move uses the
// designer's drag-and-drop move. Store/React access lives in logicapp/page.js (MAIN world).
//
// Designer DOM (Fluent UI v9):
//   + button:      [data-automation-id="msla-plus-button-<from>-<to>"]
//   + menu item:   [role="menuitem"][data-automation-id="msla-add-button-<from>-<to>"]
//   node menu:     [role="menuitem"][data-automation-id="msla-copy-menu-option"] (Delete, Copy action, …)
(() => {
  const TRY_ITEM_ID = 'sb-la-trycatch';
  const SURROUND_ITEM_ID = 'sb-la-surround';
  const TOAST_ID = 'sb-la-toast';
  const ADD_PREFIX = 'msla-add-button-';
  const PLUS_PREFIX = 'msla-plus-button-';
  const MAX_NAME = 70; // action names max out at 80; "Scope - " / " - CATCH" are added
  const BAD_NAME_CHARS = /[<>%&\\?/#:*"|{}]/;
  let busy = false;

  // ---------- Page-world bridge (logicapp/page.js)
  let reqSeq = 0;
  const pending = new Map();
  document.addEventListener('sb-la-response', (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    const p = pending.get(msg?.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
  });
  function page(op, args) {
    const id = `sb${++reqSeq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      document.dispatchEvent(new CustomEvent('sb-la-request', { detail: JSON.stringify({ id, op, args }) }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error('The SentiBuddy designer helper did not respond; reload the designer'));
      }, 3000);
    });
  }

  // ---------- Helpers
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, timeoutMs) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (v || Date.now() > end) return v;
      await sleep(100);
    }
  }
  const itemText = (n) => (n.textContent || '').replace(/\s+/g, ' ').trim();
  const automationId = (n) => n?.getAttribute('data-automation-id') || '';
  const actionKey = (name) => name.replace(/\s+/g, '_');

  function askName(what) {
    let message = `Name for the ${what}.\nThe scope will be named "Scope - <name>".`;
    let value = '';
    for (;;) {
      const input = prompt(message, value);
      if (input == null) return null;
      value = input.trim().replace(/\s+/g, ' ');
      if (!value) message = 'Please enter a name for the scope.';
      else if (value.length > MAX_NAME) message = `Keep the name to ${MAX_NAME} characters or fewer.`;
      else if (BAD_NAME_CHARS.test(value)) message = 'Names can\'t contain < > % & \\ ? / # : * " | { }';
      else return value;
    }
  }

  // Same shape as the designer's own "Copy action" clipboard data for a scope.
  function scopeClipboard(key, actions) {
    return JSON.stringify({
      nodeId: key,
      serializedOperation: { type: 'Scope', actions, runAfter: {} },
      allConnectionData: {},
      staticResults: {},
      isScopeNode: true,
      mslaNode: true
    });
  }

  // Close a Fluent menu (Escape, then an outside click if it's still open) so focus isn't trapped.
  async function closeMenu(menu) {
    if (!menu?.isConnected) return;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    if (await waitFor(() => !menu.isConnected, 400)) return;
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => !menu.isConnected, 400);
  }

  // Paste, then wait for the new scope to show up in the workflow (the designer de-duplicates
  // names, so match on the prefix).
  async function pasteAndWait(key, doPaste) {
    const before = new Set(await page('operationIds'));
    await doPaste();
    return waitFor(async () => (await page('operationIds')).find(id => !before.has(id) && id.startsWith(key)), 4000);
  }

  // Cloned from a native item so it matches the designer's styling; a clone has no React handlers.
  function cloneMenuItem(template, id, label, title, onActivate) {
    const item = template.cloneNode(true);
    item.id = id;
    item.removeAttribute('data-automation-id');
    item.removeAttribute('aria-disabled');
    item.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    item.querySelector('.fui-MenuItem__secondaryContent')?.remove(); // e.g. "Ctrl+C"
    const content = item.querySelector('.fui-MenuItem__content');
    if (content) content.textContent = label; else item.textContent = label;

    const icon = document.createElement('img');
    icon.className = 'sb-la-icon';
    icon.src = chrome.runtime.getURL('icon.png');
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    const iconSlot = item.querySelector('.fui-MenuItem__icon');
    if (iconSlot) iconSlot.replaceChildren(icon); else item.prepend(icon);

    item.title = title;
    const activate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted && !busy) onActivate(item.closest('[role="menu"]'));
    };
    item.addEventListener('click', activate, true);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') activate(e); }, true);
    return item;
  }

  function menuItems(menu) {
    return [...menu.querySelectorAll('[role="menuitem"]')].filter(i => !i.id.startsWith('sb-la-'));
  }

  // ---------- Add Try/Catch (+ menu)
  function injectTryCatch() {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (menu.querySelector(`#${TRY_ITEM_ID}`)) continue;
      const items = menuItems(menu);
      const add = items.find(i => automationId(i).startsWith(ADD_PREFIX));
      if (!add) continue;
      const plusId = PLUS_PREFIX + automationId(add).slice(ADD_PREFIX.length);
      const item = cloneMenuItem(add, TRY_ITEM_ID, 'Add Try/Catch',
        'SentiBuddy: insert a Scope with TRY / CATCH scopes here', (m) => addTryCatch(m, plusId));
      items[items.length - 1].insertAdjacentElement('afterend', item);
    }
  }

  async function addTryCatch(menu, plusId) {
    await closeMenu(menu);
    const name = askName('try/catch');
    if (!name) return;
    const key = `Scope_-_${actionKey(name)}`;
    const tryKey = `${actionKey(name)}_-_TRY`;
    const catchKey = `${actionKey(name)}_-_CATCH`;
    busy = true;
    try {
      await navigator.clipboard.writeText(scopeClipboard(key, {
        [tryKey]: { type: 'Scope', actions: {} },
        [catchKey]: { type: 'Scope', actions: {}, runAfter: { [tryKey]: ['FAILED'] } }
      }));
      const added = await pasteAndWait(key, () => page('pasteAt', { automationId: plusId }));
      if (added) toast(`Added "Scope - ${name}" with TRY / CATCH`);
      else toast(`"Scope - ${name}" is on your clipboard. Use + → "Paste an action" to place it.`, 'warn');
    } catch (err) {
      toast(`Couldn't add the try/catch: ${err?.message || err}. If it's on your clipboard, use + → "Paste an action".`, 'error');
    } finally {
      busy = false;
    }
  }

  // ---------- Surround with scope (action right-click menu)
  function injectSurround() {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (menu.querySelector(`#${SURROUND_ITEM_ID}`)) continue;
      const items = menuItems(menu);
      const copy = items.find(i => automationId(i) === 'msla-copy-menu-option');
      if (!copy) continue;
      const item = cloneMenuItem(copy, SURROUND_ITEM_ID, 'Surround with scope',
        'SentiBuddy: put this action inside a new "Scope - <name>"', surroundWithScope);
      copy.insertAdjacentElement('afterend', item);
    }
  }

  async function surroundWithScope(menu) {
    let target;
    try {
      target = await page('contextNode'); // read before the menu closes
    } catch (err) {
      toast(`Couldn't read the selected action: ${err.message}`, 'error');
      return;
    }
    await closeMenu(menu);
    if (!target?.nodeId) { toast('Couldn\'t tell which action was right-clicked.', 'error'); return; }
    const name = askName(`scope around "${target.nodeId.replace(/_/g, ' ')}"`);
    if (!name) return;
    const key = `Scope_-_${actionKey(name)}`;
    busy = true;
    try {
      await navigator.clipboard.writeText(scopeClipboard(key, {}));
      const scopeId = await pasteAndWait(key, () => page('pasteAbove', { nodeId: target.nodeId }));
      if (!scopeId) throw new Error('the scope wasn\'t inserted');
      if (!await waitFor(() => page('hasEmptyScopeDropZone', { scopeId }), 3000)) {
        throw new Error('the new scope didn\'t finish rendering; drag the action into it');
      }
      await page('moveInto', { nodeId: target.nodeId, scopeId });
      toast(`Wrapped "${target.nodeId.replace(/_/g, ' ')}" in "Scope - ${name}"`);
    } catch (err) {
      toast(`Couldn't surround with a scope: ${err?.message || err}`, 'error');
    } finally {
      busy = false;
    }
  }

  // ---------- Watch for the designer's menus
  let injectQueued = false;
  new MutationObserver(() => {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(() => {
      injectQueued = false;
      injectTryCatch();
      injectSurround();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- Toast
  let toastTimer = null;
  function toast(text, kind) {
    let t = document.getElementById(TOAST_ID);
    if (!t) {
      t = document.createElement('div');
      t.id = TOAST_ID;
      t.setAttribute('role', 'status');
      document.documentElement.appendChild(t);
    }
    t.textContent = text;
    t.className = kind ? `sb-la-${kind}` : '';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, kind ? 8000 : 3500);
  }
})();
