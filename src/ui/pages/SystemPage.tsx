import { Bar } from '../components/primitives';

interface Props {
  save: () => Promise<void>;
  setConfirmReset: (open: boolean) => void;
}
export function SystemPage({ save, setConfirmReset }: Props) {
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">COMPUTER SYSTEMS</span>
          <h2>系统与操作说明</h2>
        </div>
        <span className="mono">LV1 / 1.0.0</span>
      </div>
      <Bar code="LOCAL STATE">世界存档</Bar>
      <p>
        本地自动保存：重要命令、事件结算、每 10
        秒模拟时间及正常退出。关闭程序期间世界不推进。重新打开始终暂停。
      </p>
      <div className="button-row">
        <button className="primary" onClick={save}>
          立即保存
        </button>
        <button onClick={() => setConfirmReset(true)}>归档旧存档并重置</button>
      </div>
      <Bar code="CONTROL REFERENCE">指挥与操舰</Bar>
      <div className="help-grid">
        <div>
          <h3>高层指挥</h3>
          <p>
            在任务中心选择任务、舰船和航线。派遣后点击“继续”。默认规则会保守处理探索与接触，可随时改变方案或召回。
          </p>
          <p>“保持位置”会中断自动驾驶，但补给时限仍会推进。可接管后释放并恢复任务。</p>
        </div>
        <div>
          <h3>直接操舰</h3>
          <p>W/S 增减推进，A/D 转向，点击已识别目标，Space 开火。先扫描再警告，往往无需战斗。</p>
          <p>
            相位射程 145，舰艏 ±60°，冷却 3 秒。接管后速度固定1×，其他舰继续运行。失焦自动暂停。
          </p>
        </div>
        <div>
          <h3>资源与保障</h3>
          <p>科研数据、情报和行动配额在 LV1 中记录成果，尚不提供升级。补给与材料用于交付和维修。</p>
          <p>失能后 35 秒拖回基地。材料不足时基础抢修免费，但速度更慢。</p>
        </div>
        <div>
          <h3>项目边界</h3>
          <p>
            自动驾驶为确定性规则控制，不是模型 Agent。当前完成
            LV1；未来模型只能通过合法动作接口参与世界。
          </p>
          <p>
            原创 HTML/CSS LCARS 实现。视觉参考 TheLCARS.com；LCARS 原设计 Michael Okuda。Star Trek
            相关标识属于各权利人。
          </p>
        </div>
      </div>
    </>
  );
}
