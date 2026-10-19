/**
 * 受控风险等级呈现：把已授权结果里的等级标识/顺序/显示名投影为标签与受控配色。
 *
 * 关键约束（见 openspec/specs/web/design-system/spec.md DS-R2）：
 * - 只消费公开结果，不新增领域 Schema，不重算 P/C、分带或等级。
 * - 颜色来自 ordinal 在受控等级调色板中的位置，绝不从 levelId 的数字或中文名推断。
 * - ordinal 缺失或超出已定义语义色时保留实际标识并中性呈现，不取模、不夹取、
 *   不以默认等级冒充正式结果。
 */
import type { ChartTheme } from "../charts/types.js";

export interface RiskLevelPresentationInput {
  /** 结果中获准的等级标识，可能与 level-1 等原型字面量完全不同。 */
  readonly levelId: string;
  /** 已发布配置给出的等级顺序；缺省或越界表示当前呈现规则无法映射。 */
  readonly ordinal?: number | undefined;
  readonly displayName?: string | undefined;
}

export interface RiskLevelPresentation {
  readonly label: string;
  readonly foreground: string;
  readonly background: string;
  /** 是否落在受控调色板内；false 时调用方必须给出可访问的安全说明。 */
  readonly mapped: boolean;
}

/** 无法映射时统一使用的可访问说明，由消费组件以文本呈现。 */
export const RISK_COLOR_UNDEFINED_MESSAGE = "该等级配色未定义";

export const presentRiskLevel = (
  input: RiskLevelPresentationInput,
  theme: ChartTheme,
): RiskLevelPresentation => {
  const label = input.displayName ?? input.levelId;
  const index = input.ordinal === undefined ? -1 : input.ordinal - 1;
  const mapped =
    index >= 0 &&
    index < theme.levelPalette.length &&
    index < theme.levelForegroundPalette.length &&
    theme.levelPalette[index] !== undefined &&
    theme.levelForegroundPalette[index] !== undefined;
  return mapped
    ? {
        label,
        foreground: theme.levelForegroundPalette[index] as string,
        background: theme.levelPalette[index] as string,
        mapped: true,
      }
    : {
        label:
          input.displayName && input.displayName !== input.levelId
            ? `${input.displayName}（${input.levelId}）`
            : input.levelId,
        foreground: theme.text,
        background: theme.neutralSoft,
        mapped: false,
      };
};
