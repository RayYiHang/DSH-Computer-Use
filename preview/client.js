window.__ModuleLoader__.load({
  id: 'dsh-chatgpt-computer-use',
  factory: require => {
    const { createElement: h, useEffect, useState, useSyncExternalStore } = require('react');
    const endpoint = './api/dsh-computer-use-preview';
    const position = {
      position: 'absolute', top: 'calc(var(--dsh-frame-chrome-top, 0px) + 55px)', right: '18px',
      width: 'min(252px, calc(100vw - 89px))',
    };
    const surface = {
      background: 'var(--dsw-alias-bg-base, #fff)',
      color: 'var(--dsw-alias-text-primary, #21242a)',
      border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
      borderRadius: '13px',
      boxShadow: '0 7px 24px #1016202b',
    };
    const headerStyle = {
      display: 'flex', alignItems: 'center', gap: '3px',
      minHeight: '38px', padding: '2px 5px 2px 11px',
      fontSize: '12px', fontWeight: 600,
    };
    const iconStyle = {
      appearance: 'none', border: 0, background: 'transparent', color: 'inherit',
      width: '28px', height: '28px', borderRadius: '6px', font: '17px system-ui',
      cursor: 'pointer', flexShrink: 0,
    };
    const imageStyle = {
      display: 'block', width: '100%', maxHeight: 'min(316px, 46vh)', objectFit: 'contain',
      background: 'color-mix(in srgb, currentColor 6%, transparent)',
    };
    const deckStyle = {
      position: 'absolute', right: 'calc(100% - 2px)', top: '42px',
      display: 'flex', flexDirection: 'column', gap: '0', paddingRight: '5px',
    };
    const tabStyle = {
      ...surface, position: 'relative', width: '64px', height: '56px',
      borderRadius: '9px', marginBottom: '-9px', cursor: 'pointer', padding: 0, overflow: 'hidden',
    };
    const thumbnail = {
      display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center',
    };
    const english = {
      preview: 'App preview', close: 'Close app preview', detach: 'Move to preview companion',
      dock: 'Return preview here', companions: 'App preview layers', other: 'Show ',
      failed: 'Could not move the preview',
    };
    const chinese = {
      preview: '应用预览', close: '关闭应用预览', detach: '移到预览伙伴',
      dock: '收回预览', companions: '应用预览叠层', other: '显示 ',
      failed: '暂时无法移动预览',
    };

    function icon(label, glyph, onClick, disabled) {
      return h('button', {
        style: iconStyle, type: 'button', disabled, title: label, 'aria-label': label, onClick,
      }, glyph);
    }

    function Preview({ connection, current, status, panelInfo }) {
      const sessionId = useSyncExternalStore(current.subscribe, current.getSnapshot).key;
      const activePanel = useSyncExternalStore(panelInfo.subscribe, panelInfo.getSnapshot).activePanelId;
      const running = useSyncExternalStore(status.subscribe, status.getSnapshot).get(sessionId)?.running;
      const [snapshot, setSnapshot] = useState(null);
      const [picked, setPicked] = useState(null);
      const [dismissed, setDismissed] = useState(null);
      const [moving, setMoving] = useState(false);
      const [error, setError] = useState(false);
      const labels = navigator.language.startsWith('zh') ? chinese : english;

      useEffect(() => {
        setSnapshot(null);
        setError(false);
        if (!connection.isLoopback || !sessionId || !running || activePanel !== null) return;
        const lifetime = new AbortController();
        let timer;
        let revision;
        async function poll() {
          try {
            const query = new URLSearchParams({ sessionId, revision: revision ?? '' });
            const response = await fetch(`${endpoint}?${query}`, { signal: lifetime.signal, cache: 'no-store' });
            const value = response.ok ? await response.json() : null;
            if (lifetime.signal.aborted) return;
            if (!value?.unchanged) {
              revision = value?.revision;
              setSnapshot(value ? { ...value, sessionId } : null);
            }
          } catch {
            // The next poll can recover after a connection changes.
          } finally {
            if (!lifetime.signal.aborted) timer = setTimeout(poll, 450);
          }
        }
        void poll();
        return () => {
          lifetime.abort();
          clearTimeout(timer);
        };
      }, [connection, sessionId, running, activePanel]);

      if (!running || activePanel !== null || snapshot?.sessionId !== sessionId || dismissed === snapshot.turn) return null;
      const items = snapshot.items;
      const selection = picked?.turn === snapshot.turn ? items.find(item => item.key === picked.key) : null;
      const front = selection ?? items[0];
      if (!front) return null;

      async function move(kind) {
        setMoving(true);
        setError(false);
        try {
          const response = await fetch(endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ sessionId, turn: snapshot.turn, key: front.key, kind }),
          });
          if (!response.ok) throw new Error('Preview move failed');
          const next = await response.json();
          setPicked({ turn: next.turn, key: front.key });
          setSnapshot(value => value?.turn === next.turn ? { ...next, sessionId } : value);
        } catch {
          setError(true);
        } finally {
          setMoving(false);
        }
      }

      if (snapshot.detached) {
        return h('aside', { style: position, 'aria-label': labels.preview },
          h('button', {
            style: { ...surface, float: 'right', padding: '8px 12px', cursor: 'pointer' },
            type: 'button', disabled: moving, onClick: () => void move('dock'),
          }, labels.dock),
          error && h('div', { role: 'status' }, labels.failed));
      }

      const tabs = items.filter(item => item.key !== front.key);
      return h('aside', { style: position, 'aria-label': labels.preview },
        tabs.length > 0 && h('div', { style: deckStyle, role: 'group', 'aria-label': labels.companions },
          tabs.map((item, index) => h('button', {
            key: item.key, type: 'button', title: item.app,
            'aria-label': labels.other + item.app,
            style: { ...tabStyle, zIndex: tabs.length - index },
            onClick: () => setPicked({ turn: snapshot.turn, key: item.key }),
          }, h('img', { src: item.url, style: thumbnail, alt: '', draggable: false })))),
        h('div', { style: { ...surface, overflow: 'hidden' } },
          h('div', { style: headerStyle },
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, front.app || labels.preview),
            snapshot.canDetach && icon(labels.detach, '↗', () => void move('detach'), moving),
            icon(labels.close, '×', () => setDismissed(snapshot.turn), false)),
          h('img', { src: front.url, style: imageStyle, alt: front.app || labels.preview, draggable: false }),
          error && h('div', { role: 'status', style: { padding: 8, fontSize: 12 } }, labels.failed)));
    }

    return {
      inject: ['connection', 'slots', 'uiSession', 'layout'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-computer-use-preview',
          inject: () => ({
            connection: ctx.connection, current: ctx.uiSession.adapter.current,
            status: ctx.uiSession.sessionStatus, panelInfo: ctx.layout.panelInfo,
          }),
        }, Preview));
      },
    };
  },
});
