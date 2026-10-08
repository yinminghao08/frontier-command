import { contextBridge, ipcRenderer } from 'electron';
import type { Command, SessionCommand, Snapshot, PublicSimulationEvent } from '../src/engine/types';
import type { SaveAction } from '../src/engine/timeline';
import type { AgentApiInput } from '../src/engine/agent-api';
contextBridge.exposeInMainWorld('frontier', {
  getState: () => ipcRenderer.invoke('world:get'),
  command: (command: Command | SessionCommand) => ipcRenderer.invoke('world:command', command),
  save: () => ipcRenderer.invoke('world:save'),
  timeline: () => ipcRenderer.invoke('world:timeline'),
  listSaves: () => ipcRenderer.invoke('world:saves'),
  saveAction: (action: SaveAction) => ipcRenderer.invoke('world:save-action', action),
  setDisplayZoom: (factor: number) => ipcRenderer.invoke('display:zoom', factor),
  agentSettings: () => ipcRenderer.invoke('agent:settings'),
  agentRuntime: () => ipcRenderer.invoke('agent:runtime'),
  configureAgentApi: (settings: AgentApiInput) =>
    ipcRenderer.invoke('agent:configure-api', settings),
  testAgentApi: (settings?: AgentApiInput, requestId?: string) =>
    ipcRenderer.invoke('agent:test-api', settings, requestId),
  cancelAgentApiTest: (requestId: string) => ipcRenderer.invoke('agent:cancel-test', requestId),
  onEvents: (callback: (events: PublicSimulationEvent[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, events: PublicSimulationEvent[]) =>
      callback(events);
    ipcRenderer.on('world:events', handler);
    return () => ipcRenderer.removeListener('world:events', handler);
  },
  onState: (callback: (state: Snapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Snapshot) => callback(state);
    ipcRenderer.on('world:state', handler);
    return () => ipcRenderer.removeListener('world:state', handler);
  },
});
