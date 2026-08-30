import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { EvidenceLink } from '../components/EvidenceLink'
import { Icon } from '../components/icons'
import { processNodes } from '../content/context'
import './ProcessModelPage.css'

const tabs = [
  { to: '/identification', label: '识别任务' },
  { to: '/identification/records', label: '风险记录' },
  { to: '/identification/graph', label: '关联图谱' },
  { to: '/identification/process-model', label: '工序模型' },
]

/** 工序节点详情：输入 / 输出 / 状态参数（RI-S33 枚举）/ 证据定位 */
const nodeDetails: Record<
  string,
  { input: string; output: string; stateParams: string[]; evidence: string }
> = {
  'PN-EXPAND-01': {
    input: '小盾构到达扩径工位',
    output: '扩径模块安装调试完成',
    stateParams: ['反力体系状态', '焊接/拼装状态'],
    evidence: 'SRC-PLAN-002-CH04-SEG006',
  },
  'PN-EXPAND-02': {
    input: '扩径模块就绪',
    output: '变径空间成形、初期支护闭合',
    stateParams: ['土仓/泥水压力', '注浆参数', '支护状态'],
    evidence: 'SRC-PLAN-002-CH06-SEG011',
  },
  'PN-EXPAND-03': {
    input: '变径空间成形',
    output: '刀盘扩径至目标断面',
    stateParams: ['刀盘直径', '主驱动伸出量'],
    evidence: 'SRC-PLAN-002-CH07-SEG003',
  },
  'PN-EXPAND-04': {
    input: '刀盘扩径完成',
    output: '盾体扩径与钢管片拼装完成',
    stateParams: ['盾体直径', '焊接/拼装状态', '支护状态'],
    evidence: 'SRC-PLAN-002-CH08-SEG009',
  },
  'PN-EXPAND-05': {
    input: '盾体扩径段成形',
    output: '缩径转换与受力体系过渡完成',
    stateParams: ['盾体直径', '支护状态'],
    evidence: 'SRC-PLAN-002-CH09-SEG002',
  },
}

const equipmentParts = [
  '小盾构',
  '扩径模块',
  '扩挖机构',
  '拼装机械臂',
  '伸缩帽檐',
  '反力系统',
  '推进系统',
  '焊接装配单元',
]

const components = ['钢管片', '锚杆', '尾盾']

const dependencies = [
  {
    name: '时间先后关系',
    desc: '五个工序节点按扩径准备 → 变径空间扩挖 → 刀盘扩径 → 盾体扩径 → 缩径转换的施工顺序衔接。',
  },
  {
    name: '资源依赖关系',
    desc: '扩径模块、反力系统与拼装机械臂为相邻工序共享资源，前一工序未释放不得进入下一工序。',
  },
  {
    name: '受力依赖关系',
    desc: '变径空间扩挖支护闭合后，方可进行刀盘扩径与盾体扩径的受力体系转换；缩径转换依赖扩径段支护稳定。',
  },
]

export default function ProcessModelPage() {
  return (
    <AppShell activeNav="identification" agentContext={['站隧一体化施工工序模型']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">项目工序模型</h1>
            <p className="page-subtitle">查看站隧一体化施工工序模型及其依赖关系</p>
          </div>
          <div className="pm-header-tags">
            <VersionTag>工序模型 V1.0</VersionTag>
            <StatusTag tone="success">已发布</StatusTag>
          </div>
        </header>
        <SectionTabs items={tabs} />

        <Card title="工序节点流程" extra={<span>含五个必含工序节点（RI-S31）</span>}>
          <div className="pm-flow">
            {processNodes.map((p, i) => {
              const d = nodeDetails[p.id]
              return (
                <div key={p.id} className="pm-flow-item">
                  {i > 0 && (
                    <span className="pm-arrow">
                      <Icon name="arrowRight" size={18} />
                    </span>
                  )}
                  <div className="pm-node">
                    <div className="pm-node-head">
                      <span className="pm-node-order">{p.order}</span>
                      <span className="pm-node-name">{p.name}</span>
                    </div>
                    <div className="pm-node-io">输入：{d.input}</div>
                    <div className="pm-node-io">输出：{d.output}</div>
                    <div className="pm-node-params">
                      {d.stateParams.map((sp) => (
                        <span key={sp} className="pm-chip">
                          {sp}
                        </span>
                      ))}
                    </div>
                    <div className="pm-node-evidence">
                      <EvidenceLink segmentId={d.evidence} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <div className="pm-bottom">
          <Card
            title="装备部件与构件"
            extra={<EvidenceLink segmentId="SRC-EQP-004-CH02-SEG005" />}
          >
            <div className="pm-group-label">装备部件</div>
            <div className="pm-chips">
              {equipmentParts.map((e) => (
                <span key={e} className="pm-chip pm-chip--equip">
                  {e}
                </span>
              ))}
            </div>
            <div className="pm-group-label">构件</div>
            <div className="pm-chips">
              {components.map((c) => (
                <span key={c} className="pm-chip pm-chip--part">
                  {c}
                </span>
              ))}
            </div>
          </Card>

          <Card title="依赖关系" extra={<span>三类依赖 + 作用关系（RI-S34）</span>}>
            <ul className="pm-deps">
              {dependencies.map((d) => (
                <li key={d.name} className="pm-dep">
                  <span className="pm-dep-name">{d.name}</span>
                  <span className="pm-dep-desc">{d.desc}</span>
                </li>
              ))}
              <li className="pm-dep">
                <span className="pm-dep-name">作用关系</span>
                <span className="pm-dep-desc">
                  工序节点与装备节点、构件节点之间建立作用关系，支撑状态参数与受力分析。
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
