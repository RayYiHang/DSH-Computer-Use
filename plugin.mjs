import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPreview } from './preview/index.mjs';
import { prepareRuntime } from './runtime.mjs';

export const name = 'dsh-computer-use';
export const inject = ['tools', 'approval', 'permissionPresets'];

const bundledRoot = fileURLToPath(new URL('./cua_node/', import.meta.url));
const timeout = 120_000;
const appApprovalPrefix = 'Allow Computer Use to use "';

const exposed = new Map([
  ['js', 'dsh_computer_use'],
  ['js_reset', 'dsh_computer_use_reset'],
]);

async function loadDshApis() {
  const root = process.env.DSH_COMPUTER_USE_RUNTIME ??
    '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh';
  const resolve = createRequire(join(root, 'package.json')).resolve;
  const load = (specifier) => import(pathToFileURL(resolve(specifier)).href);

  const [{ Client }, { StdioClientTransport }, { createMcpToolDefinition }] = await Promise.all([
    load('@modelcontextprotocol/client'),
    load('@modelcontextprotocol/client/stdio'),
    load('@deepseek-ai/dsh-mcp-client'),
  ]);
  return { Client, StdioClientTransport, createMcpToolDefinition };
}

function createSession(apis, ctx, runtime, preview) {
  const client = new apis.Client({ name: 'dsh-chatgpt-computer-use', version: '1.2.0' }, {
    capabilities: { elicitation: { form: {} } },
    versionNegotiation: { mode: 'legacy' },
    supportedProtocolVersions: ['2025-11-25', '2025-06-18'],
  });
  const lifetime = new AbortController();
  const session = { client, lifetime, active: undefined, closed: false, observation: undefined };
  client.onclose = () => {
    session.closed = true;
    lifetime.abort();
  };
  client.setRequestHandler('elicitation/create', async ({ params }, request) => {
    const active = session.active;
    const exec = active?.exec;
    const schema = params.requestedSchema;
    if (!exec?.agent || params.mode !== 'form' || schema?.type !== 'object' ||
        Object.keys(schema.properties ?? {}).length !== 0 ||
        !params.message?.startsWith(appApprovalPrefix) || !params.message.endsWith('"?')) {
      return { action: 'decline' };
    }
    const signal = AbortSignal.any([exec.signal, lifetime.signal, request.mcpReq.signal]);
    if (signal.aborted) return { action: 'cancel' };
    const app = params.message.slice(appApprovalPrefix.length, -2);
    const policy = ctx.approval.overrideOf(exec.agent.session) ?? ctx.approval.config?.policy;
    if (ctx.permissionPresets.current(exec.agent.session) === 'danger-full-access') {
      return { action: 'accept', content: {} };
    }
    const outcome = await ctx.approval.request({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.rootCallId ?? exec.callId,
      reason: params.message,
      signal,
    });
    if (signal.aborted) return { action: 'cancel' };
    if (outcome === 'allowed-once') return { action: 'accept', content: {} };
    const reason = {
      rejected: `用户拒绝了 ${app} 的访问请求。`,
      unavailable: '当前会话没有可用的确认界面。请在 DSH 桌面会话中调用。',
      cancelled: `${app} 的访问确认已取消。`,
    }[outcome];
    active.approvalError = (policy === 'never'
      ? '当前 DSH 会话禁用了审批弹窗。请让用户在「访问模式」中切换到「工作区内修改」或「仅可查看」。'
      : reason) + ' 在用户操作前不要重试或改用其他方式访问该应用。';
    return { action: outcome === 'cancelled' ? 'cancel' : 'decline' };
  });

  session.connect = async () => {
    const observation = await preview.open(runtime, session.active?.exec.agent.session.id).catch(error => {
      ctx.logger.warn('DSH Computer Use preview is unavailable', error);
    });
    if (lifetime.signal.aborted) await observation?.close();
    lifetime.signal.throwIfAborted();
    session.observation = observation;
    const transport = new apis.StdioClientTransport({
      command: runtime.node,
      args: [runtime.launcher],
      cwd: runtime.root,
      env: {
        CUA_REPL_ENABLED_SURFACES: 'computer',
        CUA_REPL_NODE_REPL_PATH: runtime.worker,
        NODE_REPL_NODE_PATH: runtime.node,
        NODE_REPL_NODE_MODULE_DIRS: runtime.modules,
        NODE_REPL_TRUSTED_CODE_PATHS: runtime.modules,
        SKY_CUA_SERVICE_PATH: runtime.helper,
        ...observation?.env,
      },
      stderr: 'pipe',
    });
    transport.stderr?.resume();
    await client.connect(transport, {
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(12_000)]),
    });
  };
  session.close = async () => {
    lifetime.abort();
    session.closed = true;
    await Promise.all([session.observation?.close(), client.close()]);
  };
  return session;
}

export async function apply(ctx) {
  const apis = await loadDshApis();
  const workers = new Map();
  const preview = createPreview(ctx);

  const close = (agent) => {
    const session = workers.get(agent);
    if (!session) return Promise.resolve();
    workers.delete(agent);
    return session.close().catch(error => {
      ctx.logger.warn('ChatGPT Computer Use worker cleanup failed', error);
    });
  };

  ctx.on('agent/disposed', ({ agent }) => { void close(agent); });
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return;
    for (const agent of workers.keys()) {
      if (agent.session === session) void close(agent);
    }
  });
  ctx.effect(() => async () => {
    await Promise.all([...workers.keys()].map(close));
  });

  let runtimePromise;
  let disposed = false;
  ctx.effect(() => () => { disposed = true; });
  const getRuntime = () => (runtimePromise ??= prepareRuntime({ bundledRoot }).catch(error => {
    runtimePromise = undefined;
    throw new Error('无法准备 DSH Computer Use 运行时。' + error.message, { cause: error });
  }));

  const definitions = [...exposed].map(([upstreamName, publicName]) => {
    const isJs = upstreamName === 'js';
    const properties = isJs ? {
      code: { type: 'string' },
      title: { type: 'string' },
      timeout_ms: { type: 'integer', minimum: 1 },
      completion_summary: { type: 'string' },
    } : {};
    return {
      ...apis.createMcpToolDefinition(ctx, {
        name: publicName,
        rawName: upstreamName,
        description: isJs
          ? 'Use DSH Computer Use to inspect or operate native macOS apps. The first call returns API documentation. Use await cua.getApp with a bundle ID, or await cua.getState() to discover one. Full Access auto-approves application requests. Other approval-enabled modes ask the user. Run calls in order. First use may download the signed runtime from the official OpenAI installer.'
          : 'Reset the DSH Computer Use JavaScript state for this DSH turn.',
        inputSchema: { type: 'object', properties, required: isJs ? ['code'] : [], additionalProperties: false },
        call: async (args, exec) => {
          const agent = exec.agent;
          if (!agent) throw new Error('ChatGPT Computer Use requires an active DSH agent.');
          exec.signal.throwIfAborted();
          const runtime = await getRuntime();
          exec.signal.throwIfAborted();
          if (disposed) throw new Error('DSH Computer Use has been unloaded.');

          let session = workers.get(agent);
          if (session?.closed) {
            await close(agent);
            session = workers.get(agent);
          }
          const opening = !session;
          if (!session) {
            session = createSession(apis, ctx, runtime, preview);
            workers.set(agent, session);
          }
          if (session.active) throw new Error('Run ChatGPT Computer Use calls sequentially.');
          const active = { exec, approvalError: undefined };
          session.active = active;
          try {
            if (opening) await session.connect();
            const result = await session.client.callTool(
              { name: upstreamName, arguments: args },
              {
                signal: AbortSignal.any([exec.signal, session.lifetime.signal]),
                timeout,
              },
            );
            if (active.approvalError) {
              return { isError: true, content: [{ type: 'text', text: active.approvalError }] };
            }
            return result;
          } catch (error) {
            if (workers.get(agent) === session) await close(agent);
            throw error;
          } finally {
            session.active = undefined;
          }
        },
      }),
      timeoutMs: 660_000,
    };
  });

  const unregister = [];
  try {
    for (const definition of definitions) unregister.push(ctx.tools.register(definition));
  } catch (error) {
    unregister.forEach(dispose => dispose());
    throw error;
  }
  ctx.effect(() => () => unregister.forEach(dispose => dispose()));
  ctx.logger.info('DSH Computer Use tools registered');
}
