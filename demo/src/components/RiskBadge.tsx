import type { RiskLevel } from '../content/risks'
import './RiskBadge.css'

/** 风险等级实心小标签：I级风险 … IV级风险 */
export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`risk-badge risk-badge--${level}`}>{level}级风险</span>
}
