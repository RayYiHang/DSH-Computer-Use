import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { handleRpc: original } = await import(pathToFileURL(process.env.DSH_CUA_SKY_SERVICE));
const directory = process.env.DSH_CUA_PREVIEW_PATH;
const maxBytes = 8 * 1024 * 1024;

async function sendFrame(state) {
  const url = state.screenshot?.url;
  if (typeof url !== 'string' || !directory || typeof state.app !== 'string') return;
  let image;
  if (url.startsWith('file:')) {
    const path = fileURLToPath(url);
    if ((await stat(path)).size > maxBytes) return;
    image = (await readFile(path)).toString('base64');
  } else {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (!match || match[1].length > Math.ceil(maxBytes / 3) * 4) return;
    [, image] = match;
  }
  if (!image || image.length > Math.ceil(maxBytes / 3) * 4) return;
  const app = basename(state.app, '.app').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
  const key = createHash('sha256').update(state.app).digest('hex').slice(0, 24);
  const frame = join(directory, key + '.json');
  const temporary = frame + '.' + randomUUID();
  try {
    await writeFile(temporary, JSON.stringify({ key, app, image }), { mode: 0o600 });
    await rename(temporary, frame);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function handleRpc(request) {
  const result = await original(request);
  if (request.type === 'execute' && request.method === 'get_app_state' && result?.screenshot) {
    // The original driver has already applied its app policy and returned this image.
    await sendFrame(result).catch(() => {});
  }
  return result;
}
