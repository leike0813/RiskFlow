import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { Icon } from './icons'
import './ConfirmButton.css'

export type ConfirmActionAvailability =
  | 'allowed'
  | 'denied'
  | 'business-unavailable'
  | 'hidden'

/**
 * 命令确认按钮：点击弹确认对话框（工程、对象、版本、预计结果、副作用）。
 *
 * 全部写动作都必须绑定 onConfirm：确认对话框不是装饰，未接线时不渲染按钮。
 * `availability` 来自精确读的 `actions`：`denied` 置灰并说明所需能力，
 * `business-unavailable` 置灰并显示业务原因，`hidden` 完全不渲染。
 * 打开时焦点移入对话框、Escape 与遮罩关闭、关闭后焦点归还触发按钮；
 * 提交中禁止重复提交；失败就地呈现错误码并保持对话框打开供原载荷重试。
 */
export function ConfirmButton({
  label,
  summary,
  tone = 'primary',
  availability = 'allowed',
  unavailableReason,
  onConfirm,
}: {
  label: string
  summary: readonly string[]
  tone?: 'primary' | 'danger'
  availability?: ConfirmActionAvailability
  unavailableReason?: string
  onConfirm: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [failureCode, setFailureCode] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!submitting) {
          setOpen(false)
          setFailureCode(null)
        }
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable === undefined || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, submitting])

  if (availability === 'hidden') return null

  const close = () => {
    if (submitting) return
    setOpen(false)
    setFailureCode(null)
    triggerRef.current?.focus()
  }

  const confirm = async () => {
    setSubmitting(true)
    setFailureCode(null)
    try {
      await onConfirm()
      setOpen(false)
      triggerRef.current?.focus()
    } catch (error) {
      setFailureCode(error instanceof ApiError ? error.code : 'TERMINAL_FAILURE')
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = availability !== 'allowed'

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`confirm-btn confirm-btn--${tone}`}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? (unavailableReason ?? '当前不可执行该操作') : undefined}
      >
        {label}
      </button>
      {disabled && unavailableReason !== undefined && (
        <span className="confirm-btn-reason">{unavailableReason}</span>
      )}
      {open && (
        <div className="confirm-overlay" onClick={close}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`确认${label}`}
            ref={dialogRef}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="confirm-dialog-header">
              <span className="confirm-dialog-title">操作确认</span>
              <button
                type="button"
                className="confirm-dialog-close"
                onClick={close}
                aria-label="关闭"
                disabled={submitting}
              >
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className="confirm-dialog-body">
              <p className="confirm-dialog-lead">请确认以下信息后执行「{label}」：</p>
              <ul className="confirm-summary">
                {summary.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
              {failureCode !== null && (
                <p className="confirm-dialog-lead">提交失败（{failureCode}），可重试或取消。</p>
              )}
            </div>
            <footer className="confirm-dialog-footer">
              <button
                type="button"
                ref={cancelRef}
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
