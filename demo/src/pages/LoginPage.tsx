import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useSession } from '../api/context'
import './LoginPage.css'

/** 登录页：经既有 session/login 建立会话，成功后回到原目标页。 */
export default function LoginPage() {
  const { login } = useSession()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await login(loginName.trim(), password)
      const next = searchParams.get('next')
      navigate(next !== null && next.startsWith('/') ? next : '/', { replace: true })
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'AUTHENTICATION_REQUIRED') {
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
        <div className="login-subtitle">变径盾构站隧一体化建造风险智能识别与评估系统</div>
        <label className="login-field">
          <span>登录名</span>
          <input
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="login-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error !== null && <div className="login-error">{error}</div>}
        <button type="submit" className="login-submit" disabled={pending}>
          {pending ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
