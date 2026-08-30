import type { ReactNode } from 'react'
import { Icon } from './icons'
import './StatusTag.css'

export type StatusTone = 'success' | 'running' | 'review' | 'failed' | 'neutral'

/** 状态标签：完成=绿色对勾、运行中=蓝、人工复核=紫灰、失败=红、其余中性 */
export function StatusTag({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`status-tag status-tag--${tone}`}>
      {tone === 'success' && <Icon name="check" size={12} />}
      {children}
    </span>
  )
}
