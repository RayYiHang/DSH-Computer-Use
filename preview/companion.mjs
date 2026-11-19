import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL(
  './bin/DSH Computer Use Preview.app/Contents/MacOS/DSHComputerUsePreview',
  import.meta.url,
));

export function createCompanion(logger, onAction) {
  let child;
  let blocked = false;
  let queued;
  let turn;
  let available = true;
  try {
    accessSync(executable, constants.X_OK);
  } catch {
    available = false;
  }
  function send(message) {
    if (!child?.stdin.writable) return;
    if (blocked && message.kind === 'frame') {
      queued = message;
      return;
    }
    if (message.kind === 'end' && queued?.turn === message.turn) queued = undefined;
    blocked = !child.stdin.write(JSON.stringify(message) + '\n');
  }
  function start() {
    const process = spawn(executable, { stdio: ['pipe', 'pipe', 'ignore'] });
    child = process;
    process.stdin.on('error', () => {});
    process.stdin.on('drain', () => {
      if (process !== child) return;
      blocked = false;
      const latest = queued;
      queued = undefined;
      if (latest) send(latest);
    });
    const messages = createInterface({ input: process.stdout });
    messages.on('line', line => {
      try {
        const event = JSON.parse(line);
        if (child === process && event.turn === turn) onAction(event);
      } catch {
        // Ignore incomplete or invalid companion messages.
      }
    });
    process.once('error', error => logger.warn('DSH preview companion could not start', error));
    process.once('close', () => {
      if (child !== process) return;
      child = undefined;
      queued = undefined;
      blocked = false;
      const closed = turn;
      turn = undefined;
      if (closed) onAction({ kind: 'dock', turn: closed });
    });
  }
  return {
    available,
    show(state) {
      if (!available) return;
      const selected = state.items.find(item => item.key === state.detached);
      if (!selected) return;
      if (!child) start();
      turn = state.turn;
      send({
        kind: 'frame', turn, selected: selected.key,
        apps: state.items.map(({ app, key }) => ({ app, key })),
        image: selected.url.slice(selected.url.indexOf(',') + 1),
      });
    },
    hide(id) {
      if (turn !== id) return;
      turn = undefined;
      send({ kind: 'end', turn: id });
    },
    dispose() {
      turn = undefined;
      child?.stdin.end();
    },
  };
}
