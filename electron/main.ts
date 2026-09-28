import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SimulationEngine } from '../src/engine/engine';
import { createWorld } from '../src/engine/data';
import { HOST_FRAME_MS } from '../src/engine/clock';
import { SaveStore } from './persistence';

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
    const message = error instanceof Error ? error.message : String(error);
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
  engine.state.paused = true;
  engine.clearInputs();
  engine.log(loaded.message, loaded.blocked ? 'danger' : 'info');
  window = new BrowserWindow({
    show: process.env.FRONTIER_HEADLESS !== '1',
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
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
    return { state: engine.snapshot(), saveMessage, saveBlocked };
  });
  ipcMain.handle('world:command', (event, command: unknown) => {
    trusted(event);
    const previousReasons = engine.state.pauseReasons.length;
    const result = engine.dispatchCommand(command);
    if (
      result.ok &&
      typeof command === 'object' &&
      command &&
      (engine.state.pauseReasons.length > previousReasons ||
        !['helm', 'target', 'fire', 'speed', 'pause'].includes((command as { type: string }).type))
    ) {
      const saved = save();
      if (!saved.ok) engine.log(saved.reason, 'danger');
    }
    send();
    return result;
  });
  ipcMain.handle('world:save', (event) => {
    trusted(event);
    return save();
  });
  ipcMain.handle('world:reset', (event) => {
    trusted(event);
    try {
      store.archive();
      engine = new SimulationEngine(createWorld());
      saveBlocked = false;
      const result = save();
      send();
      return result;
    } catch (error) {
      return { ok: false, reason: `无法归档旧存档：${String(error)}` };
    }
  });
  window.on('blur', () => {
    engine.state.paused = true;
    engine.clearInputs();
    send();
  });
  window.on('close', () => {
    engine.clearInputs();
    const result = save();
    if (!result.ok) console.error(result.reason);
  });
  await window.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'frontier://app/index.html');
  timer = setInterval(() => {
    const previousLog = engine.state.nextLog;
    const events = engine.advanceFrame();
    // Critical pauses are world events even when they do not add a log entry.
    // dayBoundary remains available for a future daily-autosave policy.
    if (
      engine.state.tick - lastAutoSave >= 100 ||
      engine.state.nextLog !== previousLog ||
      events.some((event) => event.type === 'criticalPause')
    ) {
      const result = save();
      if (!result.ok && !saveBlocked) {
        engine.state.paused = true;
        engine.log(result.reason, 'danger');
        lastAutoSave = engine.state.tick;
      }
    }
    send();
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
  if (timer) clearInterval(timer);
  app.quit();
});
