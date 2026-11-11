// Logic App designer helper that runs in the page's MAIN world (declared with "world": "MAIN" in
// the manifest) so it can reach the designer's Redux store and React tree, which the isolated
// content script (logicapp/frame.js) can't see. It only acts on requests from frame.js:
//   document event 'sb-la-request'  detail = JSON { id, op, args }
//   document event 'sb-la-response' detail = JSON { id, result } | { id, error }
//
// Designer internals used (Azure/LogicAppsUX, libs/designer):
//   - react-redux <Provider store>: state.workflow.{operations,nodesMetadata},
//     state.designerView.nodeContextMenuData.nodeId (the action that was right-clicked)
//   - DropZone ({ graphId, parentId, childId }) renders each + button and binds Ctrl+V to paste
//     the clipboard node at that spot (pasteScopeOperation for scopes)
//   - OperationCardNode/ScopeCardNode useDrag spec ({ type: 'BOX', end }) whose end() dispatches
//     moveOperation (the same move as drag and drop)
(() => {
  if (window.__sbLogicAppPage) return;
  window.__sbLogicAppPage = true;

  const PLUS_SELECTOR = '[data-automation-id^="msla-plus-button-"]';
  const CARD_SELECTOR = '[data-automation-id^="card-"]';

  // Scope cards/edges use tagged ids ("<scope>-#scope"); compare on the bare node id.
  const bareId = (id) => (typeof id === 'string' ? id.replace(/-#[a-z]+$/i, '') : id);

  const fiberOf = (el) => {
    const key = el && Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    return key ? el[key] : null;
  };

  let store = null;
  function getStore() {
    if (store) return store;
    for (const el of document.querySelectorAll(`${CARD_SELECTOR}, ${PLUS_SELECTOR}`)) {
      for (let f = fiberOf(el); f; f = f.return) {
        const s = f.memoizedProps?.store;
        if (s && typeof s.dispatch === 'function' && typeof s.getState === 'function' && s.getState()?.workflow) {
          store = s;
          return s;
        }
      }
    }
    throw new Error('Logic App designer not found on this page');
  }
  const state = () => getStore().getState();

  // Every rendered + button with its DropZone props.
  function dropZones() {
    const out = [];
    for (const btn of document.querySelectorAll(PLUS_SELECTOR)) {
      for (let f = fiberOf(btn); f; f = f.return) {
        const p = f.memoizedProps;
        if (p && typeof p.graphId === 'string' && ('parentId' in p || 'childId' in p)) {
          out.push({ btn, rel: { graphId: p.graphId, parentId: p.parentId, childId: p.childId } });
          break;
        }
      }
    }
    return out;
  }

  // The designer's own paste: focus the + (its DropZone listens for Ctrl+V while focus is inside).
  function pressPaste(btn) {
    btn.focus();
    const init = { key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true };
    btn.dispatchEvent(new KeyboardEvent('keydown', init));
    btn.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  // The react-dnd drag spec of a node's card (useDrag keeps [spec, deps] in a useMemo hook).
  function dragSpecFor(nodeId) {
    for (const el of document.querySelectorAll(CARD_SELECTOR)) {
      for (let f = fiberOf(el); f; f = f.return) {
        if (bareId(f.memoizedProps?.id) !== nodeId || !('data' in f.memoizedProps)) continue;
        for (let h = f.memoizedState; h; h = h.next) {
          const v = h.memoizedState;
          const spec = Array.isArray(v) ? v[0] : null;
          if (spec && spec.type === 'BOX' && typeof spec.end === 'function') return spec;
        }
        break;
      }
    }
    return null;
  }

  const ops = {
    contextNode() {
      const s = state();
      const nodeId = bareId(s.designerView?.nodeContextMenuData?.nodeId) || null;
      if (!nodeId) return null;
      return { nodeId, graphId: s.workflow.nodesMetadata?.[nodeId]?.graphId ?? 'root' };
    },

    operationIds() {
      return Object.keys(state().workflow.operations || {});
    },

    // Paste the clipboard node at the + directly above nodeId.
    pasteAbove({ nodeId }) {
      const dz = dropZones().find(z => bareId(z.rel.childId) === nodeId);
      if (!dz) throw new Error('No + found above this action (triggers and some branch layouts can\'t be wrapped)');
      pressPaste(dz.btn);
      return true;
    },

    // Paste the clipboard node at the + whose button has this automation id.
    pasteAt({ automationId }) {
      const btn = [...document.querySelectorAll(PLUS_SELECTOR)].find(b => b.getAttribute('data-automation-id') === automationId);
      if (!btn) throw new Error('That + is no longer on the canvas');
      pressPaste(btn);
      return true;
    },

    hasEmptyScopeDropZone({ scopeId }) {
      return dropZones().some(z => z.rel.graphId === scopeId && !z.rel.childId);
    },

    // Move nodeId into the (empty) scope scopeId, exactly as drag and drop would.
    moveInto({ nodeId, scopeId }) {
      const dz = dropZones().find(z => z.rel.graphId === scopeId && !z.rel.childId);
      if (!dz) throw new Error('The new scope\'s drop zone isn\'t rendered');
      const spec = dragSpecFor(nodeId);
      if (spec) {
        spec.end({ id: nodeId }, { getDropResult: () => dz.rel });
        return 'drag';
      }
      // Fallback: the move reducer itself (upstream token data refreshes on the next edit).
      const oldGraphId = state().workflow.nodesMetadata?.[nodeId]?.graphId ?? 'root';
      getStore().dispatch({
        type: 'workflow/moveNode',
        payload: { nodeId, oldGraphId, newGraphId: scopeId, relationshipIds: dz.rel }
      });
      return 'reducer';
    }
  };

  document.addEventListener('sb-la-request', (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    if (!msg || typeof msg.id !== 'string' || !Object.hasOwn(ops, msg.op)) return;
    let reply;
    try {
      reply = { id: msg.id, result: ops[msg.op](msg.args || {}) };
    } catch (err) {
      reply = { id: msg.id, error: String(err?.message || err) };
    }
    document.dispatchEvent(new CustomEvent('sb-la-response', { detail: JSON.stringify(reply) }));
  });
})();
