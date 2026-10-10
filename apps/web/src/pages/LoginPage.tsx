import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { C09HttpError } from "../api/client";
import { useSession } from "../api/session";
import { sessionReturnTarget } from "../api/session";
import "./LoginPage.css";

/**
 * 认证表单：登录与首次改密共用同一份表单与样式。
 *
 * 两种模式只有一个差别——受限会话没有登录名输入，改密成功后按新元数据进入原目标。
 * 恢复期与恢复失败由上层门禁呈现，这里不重复表达会话状态。
 */
export default function LoginPage(props: { readonly mode?: "login" | "change-password" }) {
  const { login, changePassword } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const changePasswordMode = props.mode === "change-password";
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goNext = (): void => {
    const next = searchParams.get("next");
    navigate(sessionReturnTarget(next), { replace: true });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // 不因 pending 拒绝新的提交：会话代次守卫负责丢弃被取代的旧请求，
    // 这里再挡一次会让「后一次登录取代前一次」无法发生。
    setPending(true);
    setError(null);
    try {
      if (changePasswordMode) {
        if (await changePassword(password)) goNext();
        else setPending(false);
      } else {
        if (await login(loginName.trim(), password)) goNext();
        else setPending(false);
      }
    } catch (cause) {
      if (changePasswordMode) {
        setError("改密失败，请重试");
      } else if (cause instanceof C09HttpError && cause.error.code === "AUTHENTICATION_REQUIRED") {
        setError("登录名或密码不正确");
      } else if (cause instanceof C09HttpError && cause.error.code === "NOT_FOUND") {
        setError("账户不可用或无权访问");
      } else {
        setError("登录服务暂时不可用，请稍后重试");
      }
      setPending(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        {/*
          页面标题由本页承担：C37 D-17 之后应用外壳只保留跳转目标文本，
          不再输出第二个一级标题。
        */}
        <h1 className="login-title">{changePasswordMode ? "修改密码" : "登录"}</h1>
        <div className="login-brand">RiskFlow</div>
        <div className="login-subtitle">
          {changePasswordMode
            ? "首次登录需要修改初始密码"
            : "变径盾构站隧一体化建造风险智能识别与评估系统"}
        </div>
        {changePasswordMode ? null : (
          <label className="login-field">
            <span>登录名</span>
            <input
              // `name` 与 `autoComplete` 一并保留：密码管理器、浏览器与既有验收
              // 都按标准字段名定位登录控件，去掉会让它们退化成匿名输入框。
              name="loginName"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
        )}
        <label className="login-field">
          <span>{changePasswordMode ? "新密码" : "密码"}</span>
          <input
            name={changePasswordMode ? "newPassword" : "password"}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={changePasswordMode ? "new-password" : "current-password"}
            required
          />
        </label>
        {error !== null && <div className="login-error">{error}</div>}
        {/*
          提交中不禁用按钮：会话代次守卫负责丢弃被取代的旧请求，
          硬禁用会让「第二次登录取代第一次」这条路径无法发生，
          也让真实用户在网络缓慢时失去重新登录的能力。
        */}
        <button type="submit" className="login-submit" aria-busy={pending}>
          {changePasswordMode ? "保存" : "登录"}
        </button>
      </form>
    </div>
  );
}
