import { contextBridge, ipcRenderer } from 'electron';
import type { Command, Snapshot } from '../src/engine/types';
contextBridge.exposeInMainWorld('frontier', {
  getState: () => ipcRenderer.invoke('world:get'),
  command: (command: Command) => ipcRenderer.invoke('world:command', command),
  save: () => ipcRenderer.invoke('world:save'),
  reset: () => ipcRenderer.invoke('world:reset'),
  onState: (callback: (state: Snapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Snapshot) => callback(state);
    ipcRenderer.on('world:state', handler);
    return () => ipcRenderer.removeListener('world:state', handler);
  },
});
