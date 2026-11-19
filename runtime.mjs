import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const installerUrl = 'https://persistent.oaistatic.com/codex-app-prod/ChatGPT.dmg';
const helperName = 'Codex Computer Use.app';
const publisher = 'anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"';
const helperRequirement = `${publisher} and identifier "com.openai.sky.CUAService"`;
const preparationTimeout = 360_000;

export function runtimeFiles(root) {
  const modules = join(root, 'lib', 'node_modules');
  return {
    root,
    modules,
    node: join(root, 'bin', 'node'),
    worker: join(root, 'bin', 'node_repl'),
    launcher: join(modules, '@oai', 'cua-repl', 'bin', 'cua-repl.mjs'),
    helper: join(modules, '@oai', 'sky', helperName),
  };
}

async function hasRuntime(root) {
  const { node, worker, launcher, helper } = runtimeFiles(root);
  try {
    await Promise.all([
      access(node, constants.X_OK),
      access(worker, constants.X_OK),
      access(launcher, constants.R_OK),
      access(join(helper, 'Contents', 'MacOS', 'SkyComputerUseService'), constants.X_OK),
    ]);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return false;
    throw error;
  }
}

async function verifyRuntime(root) {
  const { node, worker, helper } = runtimeFiles(root);
  if (!await hasRuntime(root)) throw new Error('安装包内缺少 macOS Computer Use 运行时。');
  for (const executable of [node, worker]) {
    const { stdout } = await run('/usr/bin/file', ['-b', executable]);
    if (!/\barm64\b/.test(stdout)) throw new Error('此版本需要 Apple Silicon Mac 的运行时。');
  }
  await run('/usr/bin/codesign', ['--verify', '--strict', '-R', '=' + helperRequirement, helper], { timeout: 30_000 });
}

async function copyRuntime(app, target) {
  const source = join(app, 'Contents', 'Resources', 'cua_node');
  await run('/usr/bin/codesign', ['--verify', '--strict', '-R', '=' + publisher, app], { timeout: 90_000 });
  await verifyRuntime(source);
  await run('/usr/bin/ditto', [source, target], { timeout: 90_000 });
  await verifyRuntime(target);
}

export async function prepareRuntime({
  bundledRoot,
  cacheRoot = join(homedir(), 'Library', 'Caches', 'DSH-Computer-Use'),
  app = '/Applications/ChatGPT.app',
  image,
} = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('DSH Computer Use 需要 Apple Silicon Mac 和原生 arm64 DSH。');
  }
  if (bundledRoot && await hasRuntime(bundledRoot)) return runtimeFiles(bundledRoot);

  const ready = join(cacheRoot, 'runtime-v1');
  if (await hasRuntime(ready)) return runtimeFiles(ready);
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(join(cacheRoot, '.prepare-'));
  const target = join(stage, 'cua_node');
  let mount;
  try {
    if (!image && await hasRuntime(join(app, 'Contents', 'Resources', 'cua_node'))) {
      await copyRuntime(app, target);
    } else {
      if (!image) {
        image = join(stage, 'ChatGPT.dmg');
        await run('/usr/bin/curl', [
          '--fail', '--silent', '--show-error', '--location',
          '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15',
          '--max-time', '360', '--output', image, installerUrl,
        ], { timeout: preparationTimeout + 5_000 });
      }
      const location = join(stage, 'image');
      await mkdir(location);
      await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', location, image], {
        timeout: 90_000,
      });
      mount = location;
      await copyRuntime(join(mount, 'ChatGPT.app'), target);
    }
    try {
      await rename(target, ready);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !await hasRuntime(ready)) throw error;
    }
    return runtimeFiles(ready);
  } finally {
    if (mount) {
      await run('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 });
    }
    await rm(stage, { recursive: true, force: true });
  }
}
