import type { ReactElement } from "react";
/**
 * 统一线性图标集（18px，stroke=currentColor，不使用 Emoji / 3D 图标）。
 * 全部图标 viewBox 24，描边风格一致。
 */
import type { CSSProperties } from "react";

export type IconName =
  | "overview"
  | "project"
  | "identification"
  | "assessment"
  | "warnings"
  | "knowledge"
  | "review"
  | "bell"
  | "agent"
  | "doc"
  | "close"
  | "check"
  | "arrowRight"
  | "alert";

const paths: Record<IconName, ReactElement> = {
  overview: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
  project: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
      <path d="M3 10h18" />
    </>
  ),
  identification: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2" />
    </>
  ),
  assessment: (
    <>
      <path d="M4 20h16" />
      <path d="M6.5 20v-7M11 20V9.5M15.5 20v-5M20 20V6" />
    </>
  ),
  warnings: (
    <>
      <path d="M12 3.5 2.8 19.2a1 1 0 0 0 .86 1.5h16.7a1 1 0 0 0 .86-1.5Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  knowledge: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5Z" />
    </>
  ),
  review: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="1.5" />
      <path d="M9 4.2V3h6v1.2" />
      <path d="m9 13 2.2 2.2L15.5 11" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16v-5.5a6 6 0 0 1 12 0V16l1.6 2.4a.6.6 0 0 1-.5.9H4.9a.6.6 0 0 1-.5-.9Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </>
  ),
  agent: (
    <>
      <path d="M12 3.5c.4 3.8 2 5.6 5.8 6-3.8.4-5.4 2.2-5.8 6-.4-3.8-2-5.6-5.8-6 3.8-.4 5.4-2.2 5.8-6Z" />
      <path d="M18.5 14.5c.2 1.9 1 2.8 2.9 3-1.9.2-2.7 1.1-2.9 3-.2-1.9-1-2.8-2.9-3 1.9-.2 2.7-1.1 2.9-3Z" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3.5h7L19 8.5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5V9H19" />
      <path d="M9 13h6M9 16.5h6" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  arrowRight: <path d="M4.5 12h15m-6-6 6 6-6 6" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
