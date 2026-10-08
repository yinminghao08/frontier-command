import { app, BrowserWindow, ipcMain, protocol, net, safeStorage } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SimulationEngine } from '../src/engine/engine';
import { createWorld } from '../src/engine/data';
import { createAgentDemoWorld } from '../src/engine/demo';
import { HOST_FRAME_MS } from '../src/engine/clock';
import { SaveStore } from './persistence';
import { z } from 'zod';
import { AgentConfigStore, apiInputSchema } from './agents/config';
import { AgentDecisionService } from './agents/service';
import { ChatCompletionsClient, AgentApiError } from './agents/client';
function failureReason(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return '存档内容无法读取或未通过校验；原文件已保留。';
  // OS errors contain local paths; keep those in the main process.
  if (error instanceof Error && 'code' in error)
    return '存档文件读写失败，请检查磁盘空间和文件占用后重试。';
  return error instanceof Error ? error.message : '存档操作失败，请重试。';
}
const saveActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ type: z.literal('demo'), name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ type: z.literal('copy'), name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ type: z.literal('load'), id: z.string().regex(/^frontier-\d{6,}$/) }).strict(),
  z
    .object({
      type: z.literal('rename'),
      id: z.string().regex(/^frontier-\d{6,}$/),
      name: z.string().trim().min(1).max(40),
    })
    .strict(),
  z.object({ type: z.literal('delete'), id: z.string().regex(/^frontier-\d{6,}$/) }).strict(),
  z.object({ type: z.literal('openManager') }).strict(),
  z.object({ type: z.literal('closeManager') }).strict(),
]);

protocol.registerSchemesAsPrivileged([
  { scheme: 'frontier', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (process.env.FRONTIER_USER_DATA) app.setPath('userData', process.env.FRONTIER_USER_DATA);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let window: BrowserWindow | null = null;
let engine: SimulationEngine;
let store: SaveStore;
let saveBlocked = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastAutoSave = 0;
let saveMessage = '';
let managerOpen = false;
let agentConfig: AgentConfigStore;
let agentService: AgentDecisionService | undefined;
const agentClient = new ChatCompletionsClient();
function startAgentService() {
  agentService?.dispose();
  agentService = new AgentDecisionService(
    {
      snapshot: () => engine.snapshot(),
      controllerPort: (id) => engine.controllerPort(id),
      validate: (command, actorId) => engine.validate(command, actorId),
      command: (command, actorId) => {
        if (saveBlocked) return { ok: false, reason: '当前存档受保护' };
        const result = engine.dispatchCommand(command, actorId);
        if (result.ok) {
          save();
          send();
        }
        return result;
      },
    },
    () => agentConfig.connection(),
    agentClient,
  );
}
const send = () => {
  if (window && !window.isDestroyed()) window.webContents.send('world:state', engine.snapshot());
};
function save() {
  if (saveBlocked) return { ok: false, reason: saveMessage };
  try {
    store.write(engine.state);
    lastAutoSave = engine.state.tick;
    return { ok: true, reason: '世界状态已保存至本机' };
  } catch (error) {
    const message = failureReason(error);
    if (store.currentProtected) {
      saveBlocked = true;
      saveMessage = message;
    }
    return { ok: false, reason: `保存失败：${message}` };
  }
}
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  const root = resolve(__dirname, '../../dist');
  protocol.handle('frontier', (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(
      url.pathname === '/' ? '/index.html' : url.pathname,
    ).replace(/^\/+/, '');
    const file = resolve(root, relative);
    if (
      url.hostname !== 'app' ||
      !(file.startsWith(root + require('node:path').sep) || file === root)
    )
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  store = new SaveStore(app.getPath('userData'));
  const loaded = store.read();
  saveMessage = loaded.message;
  saveBlocked = loaded.blocked;
  engine = new SimulationEngine(loaded.world ?? createWorld());
  agentConfig = new AgentConfigStore(app.getPath('userData'), safeStorage);
  startAgentService();
  if (engine.state.status === 'active') engine.state.paused = true;
  if (!loaded.world && !loaded.blocked) store.write(engine.state);
  window = new BrowserWindow({
    show: process.env.FRONTIER_HEADLESS !== '1',
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    useContentSize: true,
    backgroundColor: '#000000',
    title: 'STARFLEET · FRONTIER COMMAND',
    icon: join(app.getAppPath(), 'build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (
      !url.startsWith('frontier://app/') &&
      !url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'frontier://app/')
    )
      event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Untrusted IPC sender');
  };
  ipcMain.handle('world:get', (event) => {
    trusted(event);
    return {
      state: engine.snapshot(),
      saveMessage,
      saveBlocked,
      timeline: store.status(engine.state.tick),
    };
  });
  ipcMain.handle('world:command', (event, command: unknown) => {
    trusted(event);
    if (
      command &&
      typeof command === 'object' &&
      'type' in command &&
      command.type === 'admiralChatTask'
    )
      return { ok: false, reason: '聊天任务授权仅由主进程处理真实消息' };
    const session = z
      .object({ type: z.enum(['restorePreviousDay', 'beginNewFrontier']) })
      .strict()
      .safeParse(command);
    if (session.success) {
      try {
        const next =
          session.data.type === 'restorePreviousDay'
            ? store.restorePreviousDay(engine.state)
            : store.beginNew(createWorld(), saveBlocked ? undefined : engine.state);
        engine = new SimulationEngine(next);
        startAgentService();
        saveBlocked = false;
        lastAutoSave = engine.state.tick;
        managerOpen = false;
        send();
        return { ok: true, reason: '已切换至独立时间线，原记录保留' };
      } catch (error) {
        return { ok: false, reason: failureReason(error) };
      }
    }
    if (saveBlocked) return { ok: false, reason: saveMessage };
    if (
      managerOpen &&
      typeof command === 'object' &&
      command &&
      'type' in command &&
      command.type === 'pause' &&
      'paused' in command &&
      command.paused === false
    )
      return { ok: false, reason: '请关闭存档管理器后手动继续模拟' };
    const previousReasons = engine.state.pauseReasons.length;
    const result = engine.dispatchCommand(command);
    if (
      result.ok &&
      typeof command === 'object' &&
      command &&
      (engine.state.pauseReasons.length > previousReasons ||
        !['speed', 'pause'].includes((command as { type: string }).type))
    ) {
      const saved = save();
      if (!saved.ok && engine.state.status === 'active') engine.log(saved.reason, 'danger');
    }
    send();
    return result;
  });
  ipcMain.handle('world:save', (event) => {
    trusted(event);
    return save();
  });
  ipcMain.handle('world:saves', (event) => {
    trusted(event);
    return store.catalog();
  });
  ipcMain.handle('world:save-action', (event, input: unknown) => {
    trusted(event);
    const parsed = saveActionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: '操作参数无效；名称应为 1–40 个字符' };
    try {
      const action = parsed.data;
      let next: ReturnType<typeof createWorld> | undefined;
      switch (action.type) {
        case 'openManager':
          managerOpen = true;
          if (engine.state.status === 'active')
            engine.dispatchCommand({ type: 'pause', paused: true });
          send();
          return { ok: true, reason: '存档管理器已打开，世界保持暂停' };
        case 'closeManager':
          managerOpen = false;
          return { ok: true, reason: '存档管理器已关闭，世界保持暂停' };
        case 'create':
          next = store.beginNew(createWorld(), saveBlocked ? undefined : engine.state, action.name);
          break;
        case 'demo':
          next = store.beginNew(
            createAgentDemoWorld(),
            saveBlocked ? undefined : engine.state,
            action.name,
          );
          break;
        case 'copy': {
          if (saveBlocked) throw Error('当前存档受保护，无法复制');
          const copied = structuredClone(engine.state);
          if (copied.status === 'active') copied.paused = true;
          next = store.copyCurrent(copied, action.name);
          break;
        }
        case 'load':
          next = store.activate(action.id, saveBlocked ? undefined : engine.state);
          break;
        case 'rename':
          store.rename(action.id, action.name);
          break;
        case 'delete':
          store.delete(action.id);
          break;
      }
      if (next) {
        engine = new SimulationEngine(next);
        startAgentService();
        saveBlocked = false;
        saveMessage = '已切换存档，世界保持暂停';
        lastAutoSave = engine.state.tick;
        send();
        managerOpen = false;
      }
      return {
        ok: true,
        reason: next
          ? '已进入存档，世界保持暂停'
          : action.type === 'rename'
            ? '存档已重命名'
            : '存档已删除',
      };
    } catch (error) {
      if (store.currentProtected) {
        saveBlocked = true;
        saveMessage = failureReason(error);
      }
      return {
        ok: false,
        reason: failureReason(error),
      };
    }
  });
  ipcMain.handle('world:timeline', (event) => {
    trusted(event);
    return store.status(engine.state.tick);
  });
  ipcMain.handle('display:zoom', (event, factor: unknown) => {
    trusted(event);
    const zoom = z.number().finite().min(1).max(2).parse(factor);
    if (Math.abs(window!.webContents.getZoomFactor() - zoom) > 1e-8)
      window!.webContents.setZoomFactor(zoom);
    return zoom;
  });
  ipcMain.handle('agent:settings', (event) => {
    trusted(event);
    return agentConfig.publicSettings();
  });
  ipcMain.handle('agent:configure-api', (event, input: unknown) => {
    trusted(event);
    const parsed = apiInputSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, reason: 'API 设置格式无效，请检查地址、模型与推理档位。' };
    try {
      agentConfig.update(parsed.data);
      startAgentService();
      if (!saveBlocked)
        for (const agent of engine.snapshot().agents)
          engine.dispatchCommand({ type: 'retryAgent', agentId: agent.id });
      save();
      send();
      return { ok: true, reason: 'Agent API 设置已保存，Key 使用系统加密。' };
    } catch {
      return { ok: false, reason: 'API 设置无法安全保存，请检查系统加密与磁盘。' };
    }
  });
  ipcMain.handle('agent:test-api', async (event, input: unknown) => {
    trusted(event);
    const parsed = input === undefined ? undefined : apiInputSchema.safeParse(input);
    if (parsed && !parsed.success) return { ok: false, reason: 'API 测试参数无效。' };
    try {
      return await agentClient.test(
        agentConfig.connection(parsed?.success ? parsed.data : undefined),
      );
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof AgentApiError ? error.message : 'API 测试失败，请检查配置。',
      };
    }
  });
  window.on('close', () => {
    agentService?.dispose();
    const result = save();
    if (!result.ok) console.error(result.reason);
  });
  await window.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'frontier://app/index.html');
  timer = setInterval(() => {
    const previousLog = engine.state.nextLog;
    let events: ReturnType<SimulationEngine['advanceFrame']> = [];
    try {
      events = engine.advanceFrame((events, state) => {
        if (events.some((e) => e.type === 'dayBoundary')) store.daily(state);
        if (events.some((e) => e.type === 'commandLost')) store.write(state);
      });
    } catch (error) {
      engine.state.paused = true;
      saveMessage = '时间线写入失败：' + failureReason(error);
      saveBlocked = true;
    }
    // Critical pauses are world events even when they do not add a log entry.

    if (
      engine.state.tick - lastAutoSave >= 100 ||
      engine.state.nextLog !== previousLog ||
      events.some((event) => event.type === 'criticalPause')
    ) {
      const result = save();
      if (!result.ok && !saveBlocked && engine.state.status === 'active') {
        engine.state.paused = true;
        engine.log(result.reason, 'danger');
        lastAutoSave = engine.state.tick;
      }
    }
    send();
    if (!saveBlocked && !managerOpen) agentService?.pump();
    const publicEvents = events.filter((event) => event.type === 'shipTransited');
    if (publicEvents.length && window && !window.isDestroyed())
      window.webContents.send('world:events', publicEvents);
  }, HOST_FRAME_MS);
});
app.on('second-instance', () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
app.on('window-all-closed', () => {
  agentService?.dispose();
  if (timer) clearInterval(timer);
  app.quit();
});
