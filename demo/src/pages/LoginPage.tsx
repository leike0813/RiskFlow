import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useSession } from '../api/context'
import './LoginPage.css'

/**
 * 认证表单：登录与首次改密共用同一份表单与样式。
 *
 * 两种模式只有一个差别——受限会话没有登录名输入，改密成功后按新元数据进入原目标。
 * 恢复期与恢复失败由上层门禁呈现，这里不重复表达会话状态。
 */
export default function LoginPage(props: { readonly mode?: 'login' | 'change-password' }) {
  const { login, changePassword } = useSession()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const changePasswordMode = props.mode === 'change-password'
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goNext = (): void => {
    const next = searchParams.get('next')
    navigate(next !== null && next.startsWith('/') ? next : '/', { replace: true })
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      if (changePasswordMode) {
        await changePassword(password)
      } else {
        await login(loginName.trim(), password)
      }
      goNext()
    } catch (cause) {
      if (changePasswordMode) {
        setError('改密失败，请重试')
      } else if (cause instanceof ApiError && cause.code === 'AUTHENTICATION_REQUIRED') {
        setError('登录名或密码不正确')
      } else if (cause instanceof ApiError && cause.code === 'NOT_FOUND') {
        setError('账户不可用或无权访问')
      } else {
        setError('登录服务暂时不可用，请稍后重试')
      }
      setPending(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">RiskFlow</div>
        <div className="login-subtitle">
          {changePasswordMode ? '首次登录需要修改初始密码' : '变径盾构站隧一体化建造风险智能识别与评估系统'}
        </div>
        {changePasswordMode ? null : (
          <label className="login-field">
            <span>登录名</span>
            <input
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
        )}
        <label className="login-field">
          <span>{changePasswordMode ? '新密码' : '密码'}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={changePasswordMode ? 'new-password' : 'current-password'}
            required
          />
        </label>
        {error !== null && <div className="login-error">{error}</div>}
        <button type="submit" className="login-submit" disabled={pending}>
          {pending ? '提交中…' : changePasswordMode ? '提交' : '登录'}
        </button>
      </form>
    </div>
  )
}
