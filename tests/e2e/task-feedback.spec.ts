import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';
import { AgentTestProvider } from './agent-provider';

test('Electron short LLM judgments accept immediately, reject with a reason and never post a waiting placeholder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-short-judgment-'));
  new SaveStore(dir).write(quietEngine().state);
  const provider = new AgentTestProvider();
  const url = await provider.start();
  const app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: dir, FRONTIER_HEADLESS: '1' },
  });
  try {
    const p = await app.firstWindow();
    await p.getByTestId('chat-launcher').waitFor();
    const errors: string[] = [];
    p.on('pageerror', (error) => errors.push(error.message));
    await p.evaluate(
      (baseUrl) =>
        window.frontier.configureAgentApi({
          baseUrl,
          defaultModel: 'short-e2e',
          reasoningEffort: 'none',
          apiKey: 'local-short-task-key',
        }),
      url,
    );
    await expect
      .poll(async () =>
        (await p.evaluate(() => window.frontier.getState())).state.agents.every(
          (a) => !a.decision.pendingReasons.length,
        ),
      )
      .toBe(true);
    const before = provider.requests.length;
    await p.getByTestId('chat-launcher').click();
    const comm = p.getByRole('dialog', { name: '舰队通讯' });
    await comm.locator('[data-channel-id="private:ops-meridian"]').click();
    await comm.getByLabel('通讯任务模式').selectOption('voluntary');
    await comm.getByLabel('通讯消息').fill('巡逻基地 5 分钟');
    const started = Date.now();
    await comm.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await p.evaluate(() => window.frontier.getState())).state.ships.find(
            (s) => s.id === 'meridian',
          )?.current?.action.type,
        { timeout: 5000, intervals: [100] },
      )
      .toBe('PATROL');
    expect(Date.now() - started).toBeLessThan(5000);
    const judged = provider.requests.slice(before);
    expect(judged).toHaveLength(1);
    expect(judged[0].messages[0].content).toMatch(/^TASK_JUDGMENT:/);
    expect(judged[0]).not.toHaveProperty('reasoning_effort');
    await expect(comm.getByRole('log')).not.toContainText('等待自主判断');
    const first = (await p.evaluate(() => window.frontier.getState())).state;
    expect(first.paused).toBe(true);
    expect(first.admiralTasks[0].rounds).toBe(0);
    const directive = first.ships.find((s) => s.id === 'meridian')!.current!.id;
    provider.mode = 'refuse';
    await comm.locator('[data-channel-id="frontier-command"]').click();
    await comm.getByLabel('通讯消息').fill('@Mira 巡逻基地 10 分钟');
    await comm.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await p.evaluate(() => window.frontier.getState())).state.admiralTasks.at(-1)?.consent,
        { timeout: 5000 },
      )
      .toBe('rejected');
    await expect(comm.getByRole('log')).toContainText('拒绝任务：当前状态不适合执行');
    const rejected = (await p.evaluate(() => window.frontier.getState())).state;
    expect(rejected.ships.find((s) => s.id === 'meridian')!.current!.id).toBe(directive);
    expect(rejected.chatMessages.some((m) => m.content.includes('等待自主判断'))).toBe(false);
    expect(errors).toEqual([]);
    const output = resolve('docs/verification/v13');
    mkdirSync(output, { recursive: true });
    await p.screenshot({ path: join(output, 'short-task-feedback.png') });
  } finally {
    await app.close();
    await provider.close();
  }
});
