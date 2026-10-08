# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: v13.spec.ts >> v13 request/report/composer and Agent psychology remain reachable at 1366/1024 and 100%/200% text
- Location: tests\e2e\v13.spec.ts:268:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('navigation', { name: '主导航' }).getByRole('button', { name: /AGENTS/ })

```

# Page snapshot

```yaml
- generic [ref=f3e3]:
  - generic [ref=f3e4]:
    - banner [ref=f3e5]:
      - generic [ref=f3e6]:
        - generic [ref=f3e7]:
          - button "MENU 导航" [ref=f3e8] [cursor=pointer]
          - heading "FRONTIER COMMAND" [level=1] [ref=f3e9]
        - generic [ref=f3e10]:
          - region "Priority Communications" [ref=f3e11]:
            - generic [ref=f3e12]:
              - generic "PRIORITY COMMUNICATIONS 优先通信" [ref=f3e14]
              - button "全部通信" [ref=f3e15] [cursor=pointer]
            - generic [ref=f3e17]:
              - button "HIGH / 0m ADMIRAL：六舰待命。向 UNKNOWN SPACE 测绘，矿场已有材料等待运回；新曙殖民地提供 Credits 收益，矿场满仓时需要运输材料。" [ref=f3e18] [cursor=pointer]:
                - generic [ref=f3e19]: HIGH / 0m
                - text: ADMIRAL：六舰待命。向 UNKNOWN SPACE 测绘，矿场已有材料等待运回；新曙殖民地提供 Credits 收益，矿场满仓时需要运输材料。
              - button "确认通信 1" [ref=f3e20] [cursor=pointer]: 确认
          - region "Simulation controls" [ref=f3e21]:
            - strong [ref=f3e22]:
              - text: DAY 1
              - generic [ref=f3e23]: 00:00
            - generic [ref=f3e24]:
              - button "继续" [pressed] [ref=f3e25] [cursor=pointer]
              - button "1×" [pressed] [ref=f3e26] [cursor=pointer]
              - button "4×" [ref=f3e27] [cursor=pointer]
              - button "16×" [ref=f3e28] [cursor=pointer]
            - generic [ref=f3e29]:
              - generic [ref=f3e30]: 血量 5000 / 5000
              - generic [ref=f3e31]: SHIELD 3000
            - generic [ref=f3e32]:
              - generic [ref=f3e33]:
                - text: READY
                - generic [ref=f3e34]: 6/6
              - generic [ref=f3e35]: HOSTILES 0
        - region "基地可用资源" [ref=f3e36]:
          - generic [ref=f3e37]:
            - generic [ref=f3e38]: CREDITS 信用点
            - generic [ref=f3e39]: "380"
          - generic [ref=f3e40]:
            - generic [ref=f3e41]: MATERIALS 材料
            - generic [ref=f3e42]: "70"
          - generic [ref=f3e43]:
            - generic [ref=f3e44]: PHOTON 光子鱼雷
            - generic [ref=f3e45]: "90"
          - generic [ref=f3e46]:
            - generic [ref=f3e47]: QUANTUM 量子鱼雷
            - generic [ref=f3e48]: "20"
          - generic [ref=f3e49]:
            - generic [ref=f3e50]: SPECIAL FINDS 特殊发现
            - generic [ref=f3e51]: "0"
          - group [ref=f3e52]:
            - generic "库存 / 预留" [ref=f3e53] [cursor=pointer]
    - main [ref=f3e66]:
      - region "Strategic Map workspace" [ref=f3e67]:
        - generic [ref=f3e68]:
          - generic [ref=f3e69]: STRATEGIC MAP 战略星图 SYSTEM
          - generic [ref=f3e70]:
            - button "Routes" [pressed] [ref=f3e71] [cursor=pointer]
            - button "Sensors" [ref=f3e72] [cursor=pointer]
            - button "Intelligence" [pressed] [ref=f3e73] [cursor=pointer]
        - img "战略星图" [ref=f3e75]:
          - button "DF--1/0-A" [ref=f3e113] [cursor=pointer]
          - button "DF-0/0-A" [ref=f3e119] [cursor=pointer]
          - button "DF-0/0-B" [ref=f3e125] [cursor=pointer]
          - button "DF-1/0-A" [ref=f3e131] [cursor=pointer]
          - button "DAWN STARBASE / 曙光基地" [pressed] [ref=f3e137] [cursor=pointer]:
            - generic [ref=f3e143]: "5"
          - button "NEW HORIZON / 新曙殖民地" [ref=f3e144] [cursor=pointer]
          - button "HELIOS MINE / 赫利俄斯矿场" [ref=f3e150] [cursor=pointer]
          - button "BEACON OUTPOST / 信标前哨" [ref=f3e155] [cursor=pointer]
          - button "USS MERIDIAN-3" [ref=f3e160] [cursor=pointer]
          - button "DAWN PASSAGE / 曙光通道" [ref=f3e165] [cursor=pointer]
          - button "SS FEDERATION EXCHANGE" [ref=f3e172] [cursor=pointer]
          - generic: DAWN STARBASE
          - generic: NEW HORIZON
          - generic: HELIOS MINE
          - generic: BEACON OUTPOST
          - generic: DF--1/0-A
          - generic: DF-0/0-A
          - generic: DF-0/0-B
          - generic: DF-1/0-A
        - group [ref=f3e177]:
          - generic "LEGEND 图例" [ref=f3e178] [cursor=pointer]
        - generic [ref=f3e179]:
          - generic [ref=f3e180]: DAWN FRONTIER · DRAG / SEMANTIC ZOOM / SELECT
          - generic [ref=f3e181]:
            - button "缩小地图" [ref=f3e182] [cursor=pointer]: −
            - button "放大地图" [ref=f3e183] [cursor=pointer]: +
            - button "FIT" [ref=f3e184] [cursor=pointer]
            - generic [ref=f3e185]: 0.70×
      - button "打开对象详情" [ref=f3e186] [cursor=pointer]: 对象详情
    - contentinfo [ref=f3e187]:
      - generic [ref=f3e188]:
        - generic "FLEET DIRECTIVES 舰队指令" [ref=f3e190]
        - generic [ref=f3e191]: SIMULATION PAUSED
      - generic [ref=f3e192]:
        - button "USS MERIDIAN-1 AVAILABLE · 0 QUEUED / 0 SUSPENDED 已停靠 · 可下达指令" [ref=f3e193] [cursor=pointer]:
          - generic [ref=f3e194]: USS MERIDIAN-1
          - generic [ref=f3e195]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f3e196]: 已停靠 · 可下达指令
        - button "USS VIGIL AVAILABLE · 0 QUEUED / 0 SUSPENDED 已停靠 · 可下达指令" [ref=f3e197] [cursor=pointer]:
          - generic [ref=f3e198]: USS VIGIL
          - generic [ref=f3e199]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f3e200]: 已停靠 · 可下达指令
        - button "USS VERITY AVAILABLE · 0 QUEUED / 0 SUSPENDED 已停靠 · 可下达指令" [ref=f3e201] [cursor=pointer]:
          - generic [ref=f3e202]: USS VERITY
          - generic [ref=f3e203]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f3e204]: 已停靠 · 可下达指令
        - button "USS HORIZON AVAILABLE · 0 QUEUED / 0 SUSPENDED 已停靠 · 可下达指令" [ref=f3e205] [cursor=pointer]:
          - generic [ref=f3e206]: USS HORIZON
          - generic [ref=f3e207]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f3e208]: 已停靠 · 可下达指令
        - button "USS MERIDIAN-2 AVAILABLE · 0 QUEUED / 0 SUSPENDED 已停靠 · 可下达指令" [ref=f3e209] [cursor=pointer]:
          - generic [ref=f3e210]: USS MERIDIAN-2
          - generic [ref=f3e211]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f3e212]: 已停靠 · 可下达指令
        - button "USS MERIDIAN-3 AVAILABLE · 0 QUEUED / 0 SUSPENDED 已停靠 · 可下达指令" [ref=f3e213] [cursor=pointer]:
          - generic [ref=f3e214]: USS MERIDIAN-3
          - generic [ref=f3e215]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f3e216]: 已停靠 · 可下达指令
  - button "打开舰队通讯（可拖动）" [ref=f3e217]:
    - text: CHAT
    - generic [ref=f3e218]: 通讯
    - generic "1 条未读消息" [ref=f3e219]: "1"
```

# Test source

```ts
  215 |   expect(Object.values(stats.byAgent).every((n) => n <= 2)).toBe(true);
  216 |   expect(provider.requests).toHaveLength(4);
  217 |   await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  218 |   await p.evaluate(() => window.frontier.save());
  219 |   await app!.close();
  220 |   app = undefined;
  221 |   p = await launch(dir);
  222 |   await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  223 |   await p.waitForTimeout(1700);
  224 |   expect(provider.requests).toHaveLength(4);
  225 |   await p.getByRole('button', { name: 'Console Settings', exact: true }).click();
  226 |   await expect(p.getByRole('dialog', { name: '控制台设置' })).toContainText('等待调用额度');
  227 |   await p.screenshot({ path: join(output, 'call-budget-queue.png') });
  228 | });
  229 | 
  230 | test('v13 migration uses checked-in isolated v12 fixture and preserves source bytes/history/physics across restart', async () => {
  231 |   const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-fixture-')),
  232 |     root = join(dir, 'frontiers-v12', 'frontier-000001');
  233 |   mkdirSync(root, { recursive: true });
  234 |   const original = readFileSync(resolve('tests/fixtures/v12/in-progress.json'), 'utf8');
  235 |   for (const name of ['head.json', 'head.json.bak', 'day-1.json'])
  236 |     writeFileSync(join(root, name), original);
  237 |   writeFileSync(
  238 |     join(dir, 'timeline-v12.json'),
  239 |     JSON.stringify({
  240 |       version: 12,
  241 |       activeId: 'frontier-000001',
  242 |       branches: [{ id: 'frontier-000001', name: '隔离 v12 fixture', parent: null }],
  243 |     }),
  244 |   );
  245 |   let p = await launch(dir);
  246 |   const before = await state(p);
  247 |   expect(before.version).toBe(13);
  248 |   expect(before.escortRequests[0]).toMatchObject({ status: 'accepted', conditions: [] });
  249 |   expect(before.commitments).toEqual([]);
  250 |   expect(
  251 |     before.agents.every(
  252 |       (a) =>
  253 |         a.decision.lastAdmiralMessageId === Math.max(0, ...before.chatMessages.map((m) => m.id)),
  254 |     ),
  255 |   ).toBe(true);
  256 |   expect(readFileSync(join(root, 'head.json'), 'utf8')).toBe(original);
  257 |   await p.evaluate(() => window.frontier.save());
  258 |   await app!.close();
  259 |   app = undefined;
  260 |   p = await launch(dir);
  261 |   const restored = await state(p);
  262 |   expect(restored.history).toEqual(before.history);
  263 |   expect(restored.chatMessages).toEqual(before.chatMessages);
  264 |   expect(restored.ships).toEqual(before.ships);
  265 |   expect(readFileSync(join(root, 'head.json'), 'utf8')).toBe(original);
  266 | });
  267 | 
  268 | test('v13 request/report/composer and Agent psychology remain reachable at 1366/1024 and 100%/200% text', async () => {
  269 |   mkdirSync(output, { recursive: true });
  270 |   const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-layout-'));
  271 |   new SaveStore(dir).write(quietEngine().state);
  272 |   const p = await launch(dir);
  273 |   for (const [width, height, scale] of [
  274 |     [1366, 900, 1],
  275 |     [1366, 900, 2],
  276 |     [1024, 768, 1],
  277 |     [1024, 768, 2],
  278 |   ]) {
  279 |     await app!.evaluate(
  280 |       ({ BrowserWindow }, size) =>
  281 |         BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
  282 |       { width, height },
  283 |     );
  284 |     await p.evaluate((textScale) => {
  285 |       const key = 'frontier.lcars.console.v2',
  286 |         settings = JSON.parse(localStorage.getItem(key) ?? '{}');
  287 |       localStorage.setItem(
  288 |         key,
  289 |         JSON.stringify({ ...settings, version: 2, textScale, animations: 'off' }),
  290 |       );
  291 |     }, scale);
  292 |     await p.reload();
  293 |     await p.getByTestId('chat-launcher').waitFor();
  294 |     let comm = await chat(p);
  295 |     await expect(comm.getByLabel('通讯任务模式')).toBeInViewport();
  296 |     await expect(comm.getByLabel('通讯消息')).toBeInViewport();
  297 |     await expect(comm.getByRole('button', { name: 'SEND / 发送', exact: true })).toBeInViewport();
  298 |     await comm.getByLabel('通讯消息').fill('@Talia 巡逻基地 5 分钟');
  299 |     await comm.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
  300 |     await wait(p, (w) => w.admiralTasks.some((t) => t.consent === 'proposed'));
  301 |     await comm.getByRole('button', { name: 'REQUESTS / 待处理请求', exact: true }).click();
  302 |     const takeover = comm.getByRole('button', { name: '直接接管', exact: true }).last();
  303 |     await takeover.scrollIntoViewIfNeeded();
  304 |     await expect(takeover).toBeInViewport();
  305 |     await p.screenshot({ path: join(output, `requests-${width}-text-${scale * 100}.png`) });
  306 |     await comm.locator('[data-channel-id="system-reports"]').scrollIntoViewIfNeeded();
  307 |     await comm.locator('[data-channel-id="system-reports"]').click();
  308 |     await expect(comm.getByLabel('通讯消息')).toHaveCount(0);
  309 |     await expect(comm).toContainText('此频道只读');
  310 |     await p.screenshot({ path: join(output, `reports-${width}-text-${scale * 100}.png`) });
  311 |     await comm.getByRole('button', { name: '关闭面板', exact: true }).click();
  312 |     await p
  313 |       .getByRole('navigation', { name: '主导航' })
  314 |       .getByRole('button', { name: /AGENTS/ })
> 315 |       .click();
      |        ^ Error: locator.click: Target page, context or browser has been closed
  316 |     await p.getByRole('button', { name: '查看 Agent Talia', exact: true }).click();
  317 |     const agents = p.getByRole('dialog', { name: 'AGENTS 工作面板' });
  318 |     const stress = agents.locator('.meter').filter({ hasText: '压力' }).first();
  319 |     await stress.scrollIntoViewIfNeeded();
  320 |     await expect(stress).toBeInViewport();
  321 |     expect(await agents.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  322 |     await p.screenshot({ path: join(output, `agents-${width}-text-${scale * 100}.png`) });
  323 |     await agents.getByRole('button', { name: '关闭管理面板', exact: true }).click();
  324 |   }
  325 | });
  326 | 
```