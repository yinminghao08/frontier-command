# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pause-regression.spec.ts >> scouted capture keeps running through three autosaves and restores the captured base
- Location: tests\e2e\pause-regression.spec.ts:51:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - generic [ref=f1e4]:
    - banner [ref=f1e5]:
      - generic [ref=f1e6]:
        - generic [ref=f1e7]:
          - generic [ref=f1e8]: STARFLEET COMMAND
          - strong [ref=f1e9]: DAWNFRONTIER
        - generic [ref=f1e10]: ADMIRAL / 047
      - generic [ref=f1e12]:
        - generic [ref=f1e13]:
          - generic [ref=f1e14]: FEDERATION NETWORK / LCARS 26
          - heading "FRONTIER COMMAND" [level=1] [ref=f1e15]
        - generic [ref=f1e16]:
          - generic [aria-hidden] [ref=f1e17]:
            - generic [ref=f1e18]:
              - generic [ref=f1e19]: "0334"
              - generic [ref=f1e20]: "06"
              - generic [ref=f1e21]: "00"
              - generic [ref=f1e22]: "0000"
              - generic [ref=f1e23]: "494"
              - generic [ref=f1e24]: "90"
              - generic [ref=f1e25]: "0020"
              - generic [ref=f1e26]: "06"
              - generic [ref=f1e27]: "00"
            - generic [ref=f1e28]:
              - generic [ref=f1e29]: "0009"
              - generic [ref=f1e30]: "70"
              - generic [ref=f1e31]: "5000"
              - generic [ref=f1e32]: "0000"
              - generic [ref=f1e33]: "1100"
              - generic [ref=f1e34]: "170"
              - generic [ref=f1e35]: "0650"
              - generic [ref=f1e36]: "00"
              - generic [ref=f1e37]: "800"
            - generic [ref=f1e38]:
              - generic [ref=f1e39]: "0000"
              - generic [ref=f1e40]: "00"
              - generic [ref=f1e41]: "334"
              - generic [ref=f1e42]: "0006"
              - generic [ref=f1e43]: "00"
              - generic [ref=f1e44]: "00"
              - generic [ref=f1e45]: "0494"
              - generic [ref=f1e46]: "90"
              - generic [ref=f1e47]: "20"
            - generic [ref=f1e48]:
              - generic [ref=f1e49]: "0006"
              - generic [ref=f1e50]: "00"
              - generic [ref=f1e51]: "09"
              - generic [ref=f1e52]: "0070"
              - generic [ref=f1e53]: "5000"
              - generic [ref=f1e54]: "00"
              - generic [ref=f1e55]: "1100"
              - generic [ref=f1e56]: "170"
              - generic [ref=f1e57]: "650"
          - region "Priority Communications" [ref=f1e58]:
            - generic [ref=f1e59]:
              - generic "PRIORITY COMMUNICATIONS 优先通信" [ref=f1e61]
              - button "全部通信" [ref=f1e62] [cursor=pointer]
            - generic [ref=f1e63]:
              - generic [ref=f1e64]:
                - button "HIGH / 11m 已确认 Orion Hideout，可下达打击指令" [ref=f1e65] [cursor=pointer]:
                  - generic [ref=f1e66]: HIGH / 11m
                  - text: 已确认 Orion Hideout，可下达打击指令
                - button "确认通信 5" [ref=f1e67] [cursor=pointer]: 确认
              - generic [ref=f1e68]:
                - button "HIGH / 0m ADMIRAL：六舰待命。向 UNKNOWN SPACE 测绘，矿场已有材料等待运回；新曙殖民地提供 Credits 收益，矿场满仓时需要运输材料。" [ref=f1e69] [cursor=pointer]:
                  - generic [ref=f1e70]: HIGH / 0m
                  - text: ADMIRAL：六舰待命。向 UNKNOWN SPACE 测绘，矿场已有材料等待运回；新曙殖民地提供 Credits 收益，矿场满仓时需要运输材料。
                - button "确认通信 1" [ref=f1e71] [cursor=pointer]: 确认
              - generic [ref=f1e72]:
                - button "NORMAL / 21m USS VERITY / 明理号 / CAPTURE / ADMIRAL / commander / 基地遗址接管完成" [ref=f1e73] [cursor=pointer]:
                  - generic [ref=f1e74]: NORMAL / 21m
                  - text: USS VERITY / 明理号 / CAPTURE / ADMIRAL / commander / 基地遗址接管完成
                - button "确认通信 9" [ref=f1e75] [cursor=pointer]: 确认
              - generic [ref=f1e76]:
                - button "NORMAL / 21m Orion Hideout 已现场接管，等待运输材料改建基地" [ref=f1e77] [cursor=pointer]:
                  - generic [ref=f1e78]: NORMAL / 21m
                  - text: Orion Hideout 已现场接管，等待运输材料改建基地
                - button "确认通信 8" [ref=f1e79] [cursor=pointer]: 确认
              - generic [ref=f1e80]:
                - button "NORMAL / 11m USS VERITY / 明理号 / ADMIRAL / commander / REPLACE / CAPTURE" [ref=f1e81] [cursor=pointer]:
                  - generic [ref=f1e82]: NORMAL / 11m
                  - text: USS VERITY / 明理号 / ADMIRAL / commander / REPLACE / CAPTURE
                - button "确认通信 7" [ref=f1e83] [cursor=pointer]: 确认
              - generic [ref=f1e84]:
                - button "NORMAL / 11m Orion Hideout 已摧毁；基地库存与恢复能力损失" [ref=f1e85] [cursor=pointer]:
                  - generic [ref=f1e86]: NORMAL / 11m
                  - text: Orion Hideout 已摧毁；基地库存与恢复能力损失
                - button "确认通信 6" [ref=f1e87] [cursor=pointer]: 确认
              - generic [ref=f1e88]:
                - button "NORMAL / 11m 持续侦察确认 Orion Hideout" [ref=f1e89] [cursor=pointer]:
                  - generic [ref=f1e90]: NORMAL / 11m
                  - text: 持续侦察确认 Orion Hideout
                - button "确认通信 4" [ref=f1e91] [cursor=pointer]: 确认
              - generic [ref=f1e92]:
                - button "NORMAL / 1m Wormhole 调查：DAWN PASSAGE / 曙光通道探测到通道，需要确认稳定性" [ref=f1e93] [cursor=pointer]:
                  - generic [ref=f1e94]: NORMAL / 1m
                  - text: Wormhole 调查：DAWN PASSAGE / 曙光通道探测到通道，需要确认稳定性
                - button "确认通信 3" [ref=f1e95] [cursor=pointer]: 确认
              - generic [ref=f1e96]:
                - button "NORMAL / 1m 探测到未确认设施信号，需要持续现场侦察" [ref=f1e97] [cursor=pointer]:
                  - generic [ref=f1e98]: NORMAL / 1m
                  - text: 探测到未确认设施信号，需要持续现场侦察
                - button "确认通信 2" [ref=f1e99] [cursor=pointer]: 确认
          - region "Simulation controls" [ref=f1e100]:
            - strong [ref=f1e101]:
              - text: DAY 1
              - generic [ref=f1e102]: 00:33
            - generic [ref=f1e103]:
              - button "继续" [active] [pressed] [ref=f1e104] [cursor=pointer]
              - button "1×" [ref=f1e105] [cursor=pointer]
              - button "4×" [ref=f1e106] [cursor=pointer]
              - button "16×" [pressed] [ref=f1e107] [cursor=pointer]
            - generic [ref=f1e108]:
              - generic [ref=f1e109]: 血量 5000 / 5000
              - generic [ref=f1e110]: SHIELD 3000
            - generic [ref=f1e111]:
              - generic [ref=f1e112]:
                - text: READY
                - generic [ref=f1e113]: 2/6
              - generic [ref=f1e114]: HOSTILES 0
        - region "基地可用资源" [ref=f1e115]:
          - generic [ref=f1e116]:
            - generic [ref=f1e117]: CREDITS 信用点
            - generic [ref=f1e118]: "494"
          - generic [ref=f1e119]:
            - generic [ref=f1e120]: MATERIALS 材料
            - generic [ref=f1e121]: "70"
          - generic [ref=f1e122]:
            - generic [ref=f1e123]: PHOTON 光子鱼雷
            - generic [ref=f1e124]: "90"
          - generic [ref=f1e125]:
            - generic [ref=f1e126]: QUANTUM 量子鱼雷
            - generic [ref=f1e127]: "20"
          - generic [ref=f1e128]:
            - generic [ref=f1e129]: SPECIAL FINDS 特殊发现
            - generic [ref=f1e130]: "0"
          - group [ref=f1e131]:
            - generic "库存 / 预留" [ref=f1e132] [cursor=pointer]
    - navigation "主导航" [ref=f1e139]:
      - generic [ref=f1e140]:
        - generic [ref=f1e141]: SECTOR
        - strong [ref=f1e142]: "047"
      - button "01 SECTOR 星区" [ref=f1e143] [cursor=pointer]:
        - generic [ref=f1e144]: "01"
        - generic [ref=f1e145]: SECTOR
        - generic [ref=f1e146]: 星区
      - button "02 FLEET 舰队" [ref=f1e147] [cursor=pointer]:
        - generic [ref=f1e148]: "02"
        - generic [ref=f1e149]: FLEET
        - generic [ref=f1e150]: 舰队
      - button "03 OPERATIONS 行动" [ref=f1e151] [cursor=pointer]:
        - generic [ref=f1e152]: "03"
        - generic [ref=f1e153]: OPERATIONS
        - generic [ref=f1e154]: 行动
      - button "04 AGENTS 智能体" [ref=f1e155] [cursor=pointer]:
        - generic [ref=f1e156]: "04"
        - generic [ref=f1e157]: AGENTS
        - generic [ref=f1e158]: 智能体
      - button "05 STARBASE 基地" [ref=f1e159] [cursor=pointer]:
        - generic [ref=f1e160]: "05"
        - generic [ref=f1e161]: STARBASE
        - generic [ref=f1e162]: 基地
      - button "06 COLONIES 殖民地" [ref=f1e163] [cursor=pointer]:
        - generic [ref=f1e164]: "06"
        - generic [ref=f1e165]: COLONIES
        - generic [ref=f1e166]: 殖民地
      - button "07 ARCHIVE 存档" [ref=f1e167] [cursor=pointer]:
        - generic [ref=f1e168]: "07"
        - generic [ref=f1e169]: ARCHIVE
        - generic [ref=f1e170]: 存档
      - generic [ref=f1e171]:
        - generic [ref=f1e172]: LCARS / 2368AGENT LINK / V12
        - button "Console Settings" [ref=f1e173] [cursor=pointer]: CONSOLE SETTINGS
    - main [ref=f1e180]:
      - region "Strategic Map workspace" [ref=f1e181]:
        - generic [ref=f1e182]:
          - generic [ref=f1e183]: STRATEGIC MAP 战略星图 SYSTEM
          - generic [ref=f1e184]:
            - button "Routes" [pressed] [ref=f1e185] [cursor=pointer]
            - button "Sensors" [ref=f1e186] [cursor=pointer]
            - button "Intelligence" [pressed] [ref=f1e187] [cursor=pointer]
        - img "战略星图" [ref=f1e189]:
          - generic [ref=f1e191]: UNKNOWN SPACE 0/-2
          - generic [ref=f1e194]: UNKNOWN SPACE 0/-1
          - generic [ref=f1e197]: UNKNOWN SPACE 1/-2
          - generic [ref=f1e200]: UNKNOWN SPACE 1/-1
          - generic [ref=f1e203]: UNKNOWN SPACE 2/-2
          - generic [ref=f1e206]: UNKNOWN SPACE 2/-1
          - generic [ref=f1e209]: UNKNOWN SPACE 3/-2
          - generic [ref=f1e212]: UNKNOWN SPACE 3/-1
          - button "Orion Hideout" [ref=f1e215] [cursor=pointer]
          - button "USS VERITY / 明理号" [pressed] [ref=f1e220] [cursor=pointer]
          - generic: USS VERITY
          - generic: Orion Hideout
        - group [ref=f1e227]:
          - generic "LEGEND 图例" [ref=f1e228] [cursor=pointer]
        - generic [ref=f1e229]:
          - generic [ref=f1e230]: DAWN FRONTIER · DRAG / SEMANTIC ZOOM / SELECT
          - generic [ref=f1e231]:
            - button "缩小地图" [ref=f1e232] [cursor=pointer]: −
            - button "放大地图" [ref=f1e233] [cursor=pointer]: +
            - button "FIT" [ref=f1e234] [cursor=pointer]
            - generic [ref=f1e235]: 0.85×
    - complementary "对象详情" [ref=f1e236]:
      - generic "对象详情" [ref=f1e239]
      - generic [ref=f1e241]:
        - generic "明理号" [ref=f1e243]
        - paragraph [ref=f1e244]: 宪法级 · 舰队司令拥有最终指挥权
        - generic [ref=f1e245]:
          - generic [ref=f1e246]:
            - text: 血量
            - generic [ref=f1e247]: 200 / 200
          - progressbar "血量" [ref=f1e248]
        - generic [ref=f1e249]:
          - generic [ref=f1e250]:
            - text: 护盾
            - generic [ref=f1e251]: 170 / 170
          - progressbar "护盾" [ref=f1e252]
        - generic [ref=f1e253]:
          - generic [ref=f1e254]:
            - text: 核心
            - generic [ref=f1e255]: 150 / 150
          - progressbar "核心" [ref=f1e256]
        - paragraph [ref=f1e257]: 基础速度 宪法级：6.5 · 当前速度 6.5
        - paragraph [ref=f1e258]: 推进系统 100 / 武器系统 100 · 光子鱼雷 24 / 量子鱼雷 0
        - generic "当前指令 / 队列 / 挂起指令" [ref=f1e260]
        - paragraph [ref=f1e261]: 待命 · 待命 · 可下达指令
        - generic [ref=f1e262]:
          - button "新指令 / 改令" [ref=f1e263] [cursor=pointer]
          - button "取消全部指令" [ref=f1e264] [cursor=pointer]
          - button "撤退" [ref=f1e265] [cursor=pointer]
        - generic "货舱 / 0 / 35" [ref=f1e267]
        - paragraph [ref=f1e268]: 工业材料 0
        - paragraph [ref=f1e269]: 光子鱼雷 0
        - paragraph [ref=f1e270]: 量子鱼雷 0
        - paragraph [ref=f1e271]: 特殊发现 0
        - button "卸货入库" [ref=f1e272] [cursor=pointer]
        - generic [ref=f1e273]:
          - button "返回 曙光 / 保留货物" [ref=f1e274] [cursor=pointer]
          - button "返回 曙光 并卸货" [ref=f1e275] [cursor=pointer]
        - generic "模块 / 0 / 3" [ref=f1e277]
        - generic [ref=f1e278]:
          - button "维修" [ref=f1e279] [cursor=pointer]
          - button "补充弹药" [ref=f1e280] [cursor=pointer]
          - button "改装" [ref=f1e281] [cursor=pointer]
        - generic "常备命令" [ref=f1e283]
        - generic [ref=f1e284]:
          - text: 自主交战规则
          - combobox "自主交战规则" [ref=f1e285]:
            - option "禁止自主开火"
            - option "遭袭或保护对象受袭时还击" [selected]
            - option "交战已确认敌对目标"
        - generic [ref=f1e286]:
          - text: 血量撤退阈值 %
          - spinbutton "血量撤退阈值 %" [ref=f1e287]: "30"
        - generic [ref=f1e288]:
          - text: 护盾撤退阈值 %
          - spinbutton "护盾撤退阈值 %" [ref=f1e289]: "15"
        - generic [ref=f1e290]:
          - text: 核心撤退阈值 %
          - spinbutton "核心撤退阈值 %" [ref=f1e291]: "10"
        - generic [ref=f1e292]:
          - text: 光子鱼雷报告阈值 %
          - spinbutton "光子鱼雷报告阈值 %" [ref=f1e293]: "20"
        - generic [ref=f1e294]:
          - text: 量子鱼雷报告阈值 %
          - spinbutton "量子鱼雷报告阈值 %" [ref=f1e295]: "20"
        - generic [ref=f1e296]:
          - text: 自主追击最大距离
          - spinbutton "自主追击最大距离" [ref=f1e297]: "150"
        - generic [ref=f1e298]:
          - checkbox "允许自主进入 中立区" [ref=f1e299]
          - text: 允许自主进入 中立区
        - generic [ref=f1e300]:
          - checkbox "允许自主进入 罗慕伦领地" [ref=f1e301]
          - text: 允许自主进入 罗慕伦领地
        - generic [ref=f1e302]:
          - checkbox "自动护航" [ref=f1e303]
          - text: 自动护航
        - generic [ref=f1e304]:
          - checkbox "自动响应求救" [ref=f1e305]
          - text: 自动响应求救
        - generic [ref=f1e306]:
          - checkbox "保护民用舰船" [ref=f1e307]
          - text: 保护民用舰船
        - generic [ref=f1e308]:
          - checkbox "保护运输舰" [ref=f1e309]
          - text: 保护运输舰
        - generic [ref=f1e310]:
          - checkbox "保护殖民地" [ref=f1e311]
          - text: 保护殖民地
        - generic [ref=f1e312]:
          - checkbox "已停靠时维修与装弹" [ref=f1e313]
          - text: 已停靠时维修与装弹
        - paragraph [ref=f1e314]: 舰队司令 的当前、排队和挂起指令优先；常备命令只管理自主行为。
        - generic [ref=f1e315]:
          - generic [ref=f1e316]:
            - text: 显示名称
            - textbox "显示名称" [ref=f1e317]: 明理号
          - button "保存名称" [ref=f1e318] [cursor=pointer]
    - contentinfo [ref=f1e319]:
      - generic [ref=f1e320]:
        - generic "FLEET DIRECTIVES 舰队指令" [ref=f1e322]
        - generic [ref=f1e323]: SIMULATION PAUSED
      - generic [ref=f1e324]:
        - button "USS MERIDIAN-1 AVAILABLE · 0 QUEUED / 0 SUSPENDED 已停靠 · 可下达指令" [ref=f1e325] [cursor=pointer]:
          - generic [ref=f1e326]: USS MERIDIAN-1
          - generic [ref=f1e327]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f1e328]: 已停靠 · 可下达指令
        - button "USS VIGIL AVAILABLE · 0 QUEUED / 0 SUSPENDED 待命 · 可下达指令" [ref=f1e329] [cursor=pointer]:
          - generic [ref=f1e330]: USS VIGIL
          - generic [ref=f1e331]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f1e332]: 待命 · 可下达指令
        - button "USS VERITY AVAILABLE · 0 QUEUED / 0 SUSPENDED 待命 · 可下达指令" [pressed] [ref=f1e333] [cursor=pointer]:
          - generic [ref=f1e334]: USS VERITY
          - generic [ref=f1e335]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f1e336]: 待命 · 可下达指令
        - button "USS HORIZON AVAILABLE · 0 QUEUED / 0 SUSPENDED 已停靠 · 可下达指令" [ref=f1e337] [cursor=pointer]:
          - generic [ref=f1e338]: USS HORIZON
          - generic [ref=f1e339]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f1e340]: 已停靠 · 可下达指令
        - button "USS MERIDIAN-2 AVAILABLE · 0 QUEUED / 0 SUSPENDED 待命 · 可下达指令" [ref=f1e341] [cursor=pointer]:
          - generic [ref=f1e342]: USS MERIDIAN-2
          - generic [ref=f1e343]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f1e344]: 待命 · 可下达指令
        - button "USS MERIDIAN-3 AVAILABLE · 0 QUEUED / 0 SUSPENDED 待命 · 可下达指令" [ref=f1e345] [cursor=pointer]:
          - generic [ref=f1e346]: USS MERIDIAN-3
          - generic [ref=f1e347]: AVAILABLE · 0 QUEUED / 0 SUSPENDED
          - generic [ref=f1e348]: 待命 · 可下达指令
  - button "打开舰队通讯（可拖动）" [ref=f1e349]:
    - text: CHAT
    - generic [ref=f1e350]: 通讯
    - generic "10 条未读消息" [ref=f1e351]: "10"
  - status [ref=f1e352]:
    - button "INCOMING / Mira Agent API 未配置，请在控制台设置中配置后重试。" [ref=f1e353] [cursor=pointer]:
      - generic [ref=f1e354]: INCOMING / Mira
      - generic [ref=f1e355]: Agent API 未配置，请在控制台设置中配置后重试。
  - status [ref=f1e356]:
    - generic [ref=f1e357]: 舰队司令 指令已接受：REPLACE / CAPTURE
    - button "关闭通知" [ref=f1e358] [cursor=pointer]: 关闭
```

# Test source

```ts
  1   | import {
  2   |   test,
  3   |   expect,
  4   |   _electron as electron,
  5   |   type ElectronApplication,
  6   |   type Page,
  7   | } from '@playwright/test';
  8   | import { mkdtempSync, readFileSync } from 'node:fs';
  9   | import { tmpdir } from 'node:os';
  10  | import { join, resolve } from 'node:path';
  11  | import { SaveStore } from '../../electron/persistence';
  12  | import { quietEngine } from '../helpers';
  13  | import { makeEnemy } from '../../src/engine/data';
  14  | import { updateSensors } from '../../src/engine/sensors';
  15  | import { parseSave } from '../../src/engine/saves';
  16  | 
  17  | let app: ElectronApplication | undefined;
  18  | async function launch(directory: string) {
  19  |   app = await electron.launch({
  20  |     args: [resolve('.')],
  21  |     env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '0' },
  22  |   });
  23  |   const page = await app.firstWindow();
  24  |   await page.getByRole('navigation', { name: '主导航' }).waitFor();
  25  |   await page.context().setOffline(true);
  26  |   return page;
  27  | }
  28  | const state = async (page: Page) => (await page.evaluate(() => window.frontier.getState())).state;
  29  | async function resume(page: Page) {
  30  |   await page.getByRole('button', { name: '16×', exact: true }).click();
  31  |   await page.getByRole('button', { name: '继续', exact: true }).click();
  32  | }
  33  | async function continuousUntil(page: Page, tick: number) {
  34  |   await expect
  35  |     .poll(
  36  |       async () => {
  37  |         const snapshot = await state(page);
  38  |         expect(snapshot.paused).toBe(false);
  39  |         expect(snapshot.pauseReasons).toEqual([]);
  40  |         return snapshot.tick;
  41  |       },
  42  |       { timeout: 45000, intervals: [100] },
  43  |     )
  44  |     .toBeGreaterThanOrEqual(tick);
  45  | }
  46  | test.afterEach(async () => {
  47  |   await app?.close().catch(() => {});
  48  |   app = undefined;
  49  | });
  50  | 
  51  | test('scouted capture keeps running through three autosaves and restores the captured base', async () => {
  52  |   test.setTimeout(90000);
  53  |   const e = quietEngine();
  54  |   const site = e.state.locations.find((l) => l.id === 'orion-base')!;
  55  |   const ship = e.state.ships[2];
  56  |   ship.x = site.x;
  57  |   ship.y = site.y;
  58  |   e.dispatchCommand({ type: 'pause', paused: false });
  59  |   for (let i = 0; i < 110; i++) e.step();
  60  |   expect(site.discovered).toBe(true);
  61  |   expect(e.state.siteIntel.some((i) => i.locationId === site.id)).toBe(true);
  62  |   e.hit(site, site.hull + site.shield + 1);
  63  |   e.finishCritical();
  64  |   e.dispatchCommand({ type: 'pause', paused: true });
  65  |   const directory = mkdtempSync(join(tmpdir(), 'frontier-pause-capture-'));
  66  |   const store = new SaveStore(directory);
  67  |   store.write(e.state);
  68  |   let page = await launch(directory);
  69  |   const errors: string[] = [];
  70  |   page.on('pageerror', (error) => errors.push(error.message));
  71  |   await page.locator('.operation-chip[data-ship-id="' + ship.id + '"]').click();
  72  |   await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  73  |   const dialog = page.getByRole('dialog', { name: 'Admiral 指令' });
  74  |   await dialog.getByLabel('指令类型', { exact: true }).selectOption('CAPTURE');
  75  |   await dialog.getByLabel('指令目标', { exact: true }).selectOption(site.id);
  76  |   await dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  77  |   await resume(page);
  78  |   await expect
  79  |     .poll(
  80  |       async () => {
  81  |         const snapshot = await state(page);
  82  |         expect(snapshot.paused).toBe(false);
  83  |         return snapshot.locations.find((l) => l.id === site.id)?.owner;
  84  |       },
  85  |       { timeout: 20000, intervals: [100] },
  86  |     )
  87  |     .toBe('starfleet');
  88  |   const captured = await state(page);
  89  |   const savedCapture = parseSave(JSON.parse(readFileSync(store.path, 'utf8')));
  90  |   expect(savedCapture.locations.find((l) => l.id === site.id)?.owner).toBe('starfleet');
  91  |   expect(savedCapture.siteIntel.some((i) => i.locationId === site.id)).toBe(false);
  92  |   const savedTicks = new Set<number>();
  93  |   await expect
  94  |     .poll(
  95  |       async () => {
  96  |         const snapshot = await state(page);
> 97  |         expect(snapshot.paused).toBe(false);
      |                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  98  |         expect(snapshot.pauseReasons).toEqual([]);
  99  |         const saved = parseSave(JSON.parse(readFileSync(store.path, 'utf8')));
  100 |         if (saved.tick > captured.tick) savedTicks.add(saved.tick);
  101 |         return snapshot.tick;
  102 |       },
  103 |       { timeout: 45000, intervals: [100] },
  104 |     )
  105 |     .toBeGreaterThanOrEqual(captured.tick + 350);
  106 |   expect(savedTicks.size).toBeGreaterThanOrEqual(3);
  107 |   expect(parseSave(JSON.parse(readFileSync(store.path, 'utf8'))).tick).toBeGreaterThanOrEqual(
  108 |     captured.tick + 300,
  109 |   );
  110 |   await page.screenshot({
  111 |     path: join(directory, 'capture-continuous.png'),
  112 |     animations: 'disabled',
  113 |   });
  114 |   await page.getByRole('button', { name: '暂停', exact: true }).click();
  115 |   const beforeClose = await state(page);
  116 |   await app!.close();
  117 |   app = undefined;
  118 |   page = await launch(directory);
  119 |   const restored = await state(page);
  120 |   expect(restored.tick).toBe(beforeClose.tick);
  121 |   expect(restored.locations.find((l) => l.id === site.id)?.owner).toBe('starfleet');
  122 |   expect(restored.history.some((h) => h.kind === 'capture' && h.entityId === site.id)).toBe(true);
  123 |   await resume(page);
  124 |   await continuousUntil(page, restored.tick + 120);
  125 |   expect(errors).toEqual([]);
  126 | });
  127 | 
  128 | test('known contact reacquisition and hostile upgrade do not pause, including after restart', async () => {
  129 |   const e = quietEngine();
  130 |   const enemy = makeEnemy('known-scout', 'scout', 'orion', { x: e.base.x + 80, y: e.base.y });
  131 |   enemy.cloak = 'off';
  132 |   enemy.nextDecision = 1e9;
  133 |   enemy.standing.roe = 'HOLD FIRE';
  134 |   e.state.ships.forEach((s) => {
  135 |     s.standing.roe = 'HOLD FIRE';
  136 |   });
  137 |   e.state.enemies = [enemy];
  138 |   updateSensors(e);
  139 |   e.finishCritical();
  140 |   e.dispatchCommand({ type: 'pause', paused: false });
  141 |   e.state.tick = 120;
  142 |   e.state.time = 12;
  143 |   enemy.lastHostileAt = e.state.time;
  144 |   enemy.lastHostileTargetId = 'base';
  145 |   const directory = mkdtempSync(join(tmpdir(), 'frontier-pause-contact-'));
  146 |   const store = new SaveStore(directory);
  147 |   store.write(e.state);
  148 |   let page = await launch(directory);
  149 |   await resume(page);
  150 |   await continuousUntil(page, e.state.tick + 150);
  151 |   const running = await state(page);
  152 |   expect(
  153 |     running.communications.some(
  154 |       (c) => c.text.includes('已确认敌对接触') && !c.text.includes('手动继续'),
  155 |     ),
  156 |   ).toBe(true);
  157 |   await expect(page.getByRole('dialog', { name: '接触警报' })).not.toBeVisible();
  158 |   await page.getByRole('button', { name: '暂停', exact: true }).click();
  159 |   const beforeClose = await state(page);
  160 |   await app!.close();
  161 |   app = undefined;
  162 |   expect(
  163 |     parseSave(JSON.parse(readFileSync(store.path, 'utf8'))).contactAlerts[0].hostileAlerted,
  164 |   ).toBe(true);
  165 |   page = await launch(directory);
  166 |   await resume(page);
  167 |   await continuousUntil(page, beforeClose.tick + 120);
  168 |   await expect(page.getByRole('dialog', { name: '接触警报' })).not.toBeVisible();
  169 | });
  170 | 
```