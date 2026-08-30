import { Icon } from './icons'
import './StageBar.css'

export interface StageItem {
  id: string
  label: string
  hint?: string
  status: 'done' | 'current' | 'pending' | 'failed'
}

/** 横向阶段条（如 RI-S1–RI-S6）：done 绿色对勾，current 工程蓝 */
export function StageBar({ stages }: { stages: StageItem[] }) {
  return (
    <ol className="stage-bar">
      {stages.map((s, i) => (
        <li key={s.id} className={`stage-item stage-item--${s.status}`}>
          <span className="stage-marker">
            {s.status === 'done' ? (
              <Icon name="check" size={14} />
            ) : s.status === 'failed' ? (
              <Icon name="close" size={14} />
            ) : (
              i + 1
            )}
          </span>
          <span className="stage-text">
            <span className="stage-id mono">{s.id}</span>
            <span className="stage-label">{s.label}</span>
            {s.hint && <span className="stage-hint">{s.hint}</span>}
          </span>
          {i < stages.length - 1 && <span className="stage-connector" />}
        </li>
      ))}
    </ol>
  )
}
