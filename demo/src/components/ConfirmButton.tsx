import { useState } from 'react'
import { Icon } from './icons'
import './ConfirmButton.css'

/**
 * 命令确认按钮：点击弹确认对话框（工程、对象、版本、预计结果），
 * 确认后仅关闭（demo 无后端，不产生业务写入）。
 */
export function ConfirmButton({
  label,
  summary,
  tone = 'primary',
}: {
  label: string
  summary: string[]
  tone?: 'primary' | 'danger'
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={`confirm-btn confirm-btn--${tone}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <div className="confirm-overlay" onClick={() => setOpen(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <header className="confirm-dialog-header">
              <span className="confirm-dialog-title">操作确认</span>
              <button
                type="button"
                className="confirm-dialog-close"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className="confirm-dialog-body">
              <p className="confirm-dialog-lead">请确认以下信息后执行「{label}」：</p>
              <ul className="confirm-summary">
                {summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <footer className="confirm-dialog-footer">
              <button type="button" className="confirm-btn confirm-btn--ghost" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className={`confirm-btn confirm-btn--${tone}`}
                onClick={() => setOpen(false)}
              >
                确认{label}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
