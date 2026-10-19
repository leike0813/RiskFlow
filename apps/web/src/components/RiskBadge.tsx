import { useChartTheme } from "../theme/DesignSystemProvider";
import {
  presentRiskLevel,
  RISK_COLOR_UNDEFINED_MESSAGE,
  type RiskLevelPresentationInput,
} from "../theme/riskPresentation";
import "./RiskBadge.css";

/**
 * 风险等级徽章：颜色和文字都来自与矩阵、图例同一份受控等级呈现规则。
 * 等级无法映射时保留实际标识并给出可读说明，不改写成别的等级，也不借用操作错误色。
 */
export function RiskBadge({ levelId, ordinal, displayName }: RiskLevelPresentationInput) {
  const presentation = presentRiskLevel({ levelId, ordinal, displayName }, useChartTheme());
  return (
    <span
      className="risk-badge"
      data-risk-mapped={presentation.mapped ? "true" : "false"}
      style={{ color: presentation.foreground, background: presentation.background }}
    >
      {presentation.label}
      {!presentation.mapped && (
        <span className="risk-badge-note">（{RISK_COLOR_UNDEFINED_MESSAGE}）</span>
      )}
    </span>
  );
}
