// 焦点工具，函数语义照搬 apps/web/src/shared/focus.ts（a11y 基线对齐生产 C10）。

export const MAIN_HEADING_FOCUS_ID = 'main-heading' as const;

export const dockTabIndexForKey = (
  currentIndex: number,
  key: string,
  tabCount = 2,
): number | undefined => {
  if (
    !Number.isInteger(currentIndex) ||
    currentIndex < 0 ||
    currentIndex >= tabCount ||
    tabCount < 1
  )
    return undefined;
  if (key === 'ArrowRight') return (currentIndex + 1) % tabCount;
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  return undefined;
};

export const focusElement = (
  element: { focus: (options?: FocusOptions) => void } | null,
): boolean => {
  if (element === null) return false;
  element.focus({ preventScroll: true });
  return true;
};

export const focusMainHeading = (): boolean => {
  if (typeof document === 'undefined') return false;
  return focusElement(document.getElementById(MAIN_HEADING_FOCUS_ID));
};
