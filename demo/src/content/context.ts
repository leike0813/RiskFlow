/**
 * 全局工程上下文与一级导航定义。
 * 事实源：prototypes/screenshot-content-inventory.md §3.1、full-product-ui-spec.md §2。
 */

export interface ProjectContext {
  project: string
  section: string
  process: string
  dataTimestamp: string
  constructionMethod: string
  stratumCondition: string
  engineeringStage: string
}

export const projectContext: ProjectContext = {
  project: '变径盾构站隧一体化建造工程',
  section: '站隧一体化试验区段',
  process: '变径空间扩挖',
  dataTimestamp: '2026-08-27 09:30',
  constructionMethod: '变径盾构法',
  stratumCondition: '富水软弱地层',
  engineeringStage: '变径空间扩挖与支护',
}

export type NavKey =
  | 'overview'
  | 'project'
  | 'identification'
  | 'assessment'
  | 'warnings'
  | 'knowledge'
  | 'review'

export interface NavItem {
  key: NavKey
  label: string
  to: string
}

/** 七项业务导航（智能 Agent 为全局停靠栏，不在导航内） */
export const navItems: NavItem[] = [
  { key: 'overview', label: '风险态势', to: '/' },
  { key: 'project', label: '工程项目', to: '/project' },
  { key: 'identification', label: '风险识别', to: '/identification' },
  { key: 'assessment', label: '风险评估', to: '/assessment' },
  { key: 'warnings', label: '预警处置', to: '/warnings' },
  { key: 'knowledge', label: '知识与规则', to: '/knowledge' },
  { key: 'review', label: '复核与审计', to: '/review' },
]

/** 顶栏通知角标数字 */
export const notificationCount = 4

/** 五个必含工序节点（识别专利 RI-S31） */
export interface ProcessNode {
  id: string
  name: string
  order: number
}

export const processNodes: ProcessNode[] = [
  { id: 'PN-EXPAND-01', name: '扩径准备', order: 1 },
  { id: 'PN-EXPAND-02', name: '变径空间扩挖', order: 2 },
  { id: 'PN-EXPAND-03', name: '刀盘扩径', order: 3 },
  { id: 'PN-EXPAND-04', name: '盾体扩径', order: 4 },
  { id: 'PN-EXPAND-05', name: '缩径转换', order: 5 },
]

/** 六种风险机理类型（识别专利 RI-S41） */
export const mechanismTypes = [
  '掌子面稳定性失效',
  '支护结构失效',
  '渗流突涌',
  '过挖与地表沉降',
  '施工装备故障',
  '装配连接失效',
] as const

export type MechanismType = (typeof mechanismTypes)[number]
