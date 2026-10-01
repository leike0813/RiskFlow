import { useState } from 'react'
import { ApiError } from '../api/client'
import { Icon } from './icons'
import './ConfirmButton.css'

/**
 * 命令确认按钮：点击弹确认对话框（工程、对象、版本、预计结果、副作用）。
 * 提供 onConfirm 时确认后真实提交：提交中禁用按钮，失败就地呈现结构化错误码并保持对话框
 * 打开供重试；缺省 onConfirm 时确认后仅关闭（C34 域静态原型沿用）。
 */
export function ConfirmButton({
  label,
  summary,
  tone = 'primary',
  onConfirm,
}: {
  label: string
  summary: string[]
  tone?: 'primary' | 'danger'
  onConfirm?: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failureCode, setFailureCode] = useState<string | null>(null)

  const close = () => {
    if (submitting) return
    setOpen(false)
    setFailureCode(null)
  }

  const confirm = async () => {
    if (onConfirm === undefined) {
      setOpen(false)
      return
    }
    setSubmitting(true)
    setFailureCode(null)
    try {
      await onConfirm()
      setOpen(false)
    } catch (error) {
      setFailureCode(error instanceof ApiError ? error.code : 'TERMINAL_FAILURE')
    } finally {
      setSubmitting(false)
    }
  }

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
        <div className="confirm-overlay" onClick={close}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <header className="confirm-dialog-header">
              <span className="confirm-dialog-title">操作确认</span>
              <button
                type="button"
                className="confirm-dialog-close"
                onClick={close}
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
              {failureCode !== null && (
                <p className="confirm-dialog-lead">提交失败（{failureCode}），可重试或取消。</p>
              )}
            </div>
            <footer className="confirm-dialog-footer">
              <button
                type="button"
                className="confirm-btn confirm-btn--ghost"
                onClick={close}
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="button"
                className={`confirm-btn confirm-btn--${tone}`}
                onClick={() => void confirm()}
                disabled={submitting}
              >
                {submitting ? '提交中…' : `确认${label}`}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
