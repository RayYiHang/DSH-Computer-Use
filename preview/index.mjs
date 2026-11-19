import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompanion } from './companion.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const wrapper = join(directory, 'sky.mjs');
const endpoint = '/api/dsh-computer-use-preview';
const mimeTypes = [['iVBORw0KGgo', 'image/png'], ['/9j/', 'image/jpeg'], ['UklGR', 'image/webp']];
const maxApps = 4;
const noStore = { 'cache-control': 'no-store' };

export function createPreview(ctx) {
  let available = false;
  let companionSession;
  const frames = new Map();
  const companion = createCompanion(ctx.logger, event => {
    const state = frames.get(companionSession);
    if (state?.turn !== event.turn) return;
    if (event.kind === 'dock') dock();
    if (event.kind === 'select' && state.items.some(item => item.key === event.selected)) {
      save(companionSession, { ...state, detached: event.selected });
    }
  });

  function save(session, state) {
    const next = { ...state, revision: randomUUID() };
    frames.set(session, next);
    if (next.detached) companion.show(next);
    return next;
  }

  function dock() {
    const session = companionSession;
    const state = frames.get(session);
    companionSession = undefined;
    if (!state?.detached) return;
    companion.hide(state.turn);
    save(session, { ...state, detached: null });
  }

  async function route(request) {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const frame = frames.get(params.get('sessionId'));
      const value = frame && frame.revision === params.get('revision') ? { unchanged: true } : frame ?? null;
      return Response.json(value, { headers: noStore });
    }

    const action = await request.json().catch(() => null);
    const state = frames.get(action?.sessionId);
    if (!state || state.turn !== action.turn) return new Response(null, { status: 409, headers: noStore });
    if (action.kind === 'dock' && companionSession === action.sessionId) {
      dock();
    } else if (action.kind === 'detach' && companion.available && state.items.some(item => item.key === action.key)) {
      if (companionSession && companionSession !== action.sessionId) dock();
      companionSession = action.sessionId;
      save(action.sessionId, { ...state, detached: action.key });
    } else {
      return new Response(null, { status: 400, headers: noStore });
    }
    return Response.json(frames.get(action.sessionId), { headers: noStore });
  }

  ctx.inject(['connection'], scope => {
    if (process.env.DSH_COMPUTER_USE_PREVIEW === '0') return;
    scope.effect(() => {
      const remove = scope.connection.fetch.register({
        path: endpoint, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: route,
      });
      available = true;
      return async () => {
        available = false;
        dock();
        companion.dispose();
        frames.clear();
        await remove();
      };
    });
  });

  return {
    async open(runtime, sessionId) {
      if (!available || typeof sessionId !== 'string') return;
      const original = createRequire(runtime.launcher).resolve('@oai/sky/service');
      const path = await mkdtemp(join(tmpdir(), 'dsh-cua-preview-'));
      const turn = randomUUID();
      const pending = new Set();
      let closed = false;
      let reading = false;

      async function update() {
        if (reading || closed) return;
        reading = true;
        try {
          for (const filename of pending) {
            pending.delete(filename);
            if (closed || !available) break;
            const data = await readFile(join(path, filename), 'utf8').then(JSON.parse).catch(() => null);
            if (closed || !data || typeof data.image !== 'string' || typeof data.app !== 'string') continue;
            const type = mimeTypes.find(([prefix]) => data.image.startsWith(prefix))?.[1];
            if (!type || !/^[a-f0-9]{24}$/.test(data.key)) continue;
            const previous = frames.get(sessionId);
            if (previous && previous.turn !== turn && companionSession === sessionId) dock();
            const state = previous?.turn === turn ? previous : { turn, items: [], detached: null, canDetach: companion.available };
            const items = [
              { key: data.key, app: data.app, url: `data:${type};base64,${data.image}` },
              ...state.items.filter(item => item.key !== data.key),
            ];
            if (items.length > maxApps) {
              const last = items.length - 1;
              items.splice(items[last].key === state.detached ? last - 1 : last, 1);
            }
            save(sessionId, { ...state, items });
          }
        } finally {
          reading = false;
        }
      }

      let watcher;
      try {
        watcher = watch(path, { persistent: false }, (_event, name) => {
          if (closed || !/^[a-f0-9]{24}\.json$/.test(name ?? '')) return;
          pending.add(name);
          void update();
        });
        watcher.on('error', () => watcher.close());
      } catch (error) {
        await rm(path, { recursive: true, force: true });
        throw error;
      }
      return {
        env: {
          NODE_REPL_TRUSTED_CODE_PATHS: [runtime.modules, directory].join(delimiter),
          NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ sky: wrapper }),
          DSH_CUA_SKY_SERVICE: original,
          DSH_CUA_PREVIEW_PATH: path,
        },
        async close() {
          if (closed) return;
          closed = true;
          watcher.close();
          if (frames.get(sessionId)?.turn === turn) {
            if (companionSession === sessionId) dock();
            frames.delete(sessionId);
          }
          await rm(path, { recursive: true, force: true });
        },
      };
    },
  };
}
