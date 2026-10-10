import LoginPage from "./LoginPage.js";

/**
 * 首次改密入口：与会话受限态共用同一份表单。
 * 只切换模式，不复制表单实现或错误语义。
 */
export default function ChangePasswordPage() {
  return <LoginPage mode="change-password" />;
}
