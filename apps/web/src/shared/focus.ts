export const MAIN_HEADING_FOCUS_ID = "main-heading" as const;

export const focusTargetAfterNavigation = (): typeof MAIN_HEADING_FOCUS_ID => MAIN_HEADING_FOCUS_ID;
export const focusTargetForRoute = focusTargetAfterNavigation;

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
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  return undefined;
};

export const getDockTabIndexOnKey = dockTabIndexForKey;

export const isDialogTabKey = (key: string): boolean => key === "Tab";
export const shouldCloseOnEscape = (key: string, submitting: boolean): boolean =>
  key === "Escape" && !submitting;

export const focusElement = (
  element: { focus: (options?: FocusOptions) => void } | null,
): boolean => {
  if (element === null) return false;
  element.focus({ preventScroll: true });
  return true;
};

export const focusMainHeading = (): boolean => {
  if (typeof document === "undefined") return false;
  return focusElement(document.getElementById(MAIN_HEADING_FOCUS_ID));
};

export const restoreFocus = (opener: { focus: (options?: FocusOptions) => void } | null): boolean =>
  focusElement(opener);

export const nextDialogFocusIndex = (input: {
  currentIndex: number;
  direction: "forward" | "backward";
  focusableCount: number;
}): number | undefined => {
  if (
    !Number.isInteger(input.currentIndex) ||
    !Number.isInteger(input.focusableCount) ||
    input.focusableCount < 1 ||
    input.currentIndex < 0 ||
    input.currentIndex >= input.focusableCount
  )
    return undefined;
  if (input.direction === "forward") return (input.currentIndex + 1) % input.focusableCount;
  return (input.currentIndex - 1 + input.focusableCount) % input.focusableCount;
};
