import { describe, expect, it } from "vitest";

import {
  dockTabIndexForKey,
  focusElement,
  focusTargetAfterNavigation,
  nextDialogFocusIndex,
  shouldCloseOnEscape,
} from "../src/shared/focus.js";

describe("C10 focus helpers", () => {
  it("maps navigation and dock keys predictably", () => {
    expect(focusTargetAfterNavigation()).toBe("main-heading");
    expect(dockTabIndexForKey(0, "ArrowRight")).toBe(1);
    expect(dockTabIndexForKey(1, "ArrowRight")).toBe(0);
    expect(dockTabIndexForKey(0, "ArrowLeft")).toBe(1);
    expect(dockTabIndexForKey(1, "Home")).toBe(0);
    expect(dockTabIndexForKey(0, "End", 3)).toBe(2);
    expect(dockTabIndexForKey(0, "PageDown")).toBeUndefined();
    expect(
      nextDialogFocusIndex({ currentIndex: 0, direction: "backward", focusableCount: 2 }),
    ).toBe(1);
    expect(nextDialogFocusIndex({ currentIndex: 1, direction: "forward", focusableCount: 2 })).toBe(
      0,
    );
  });

  it("only closes on Escape outside submission and focuses the target", () => {
    expect(shouldCloseOnEscape("Escape", false)).toBe(true);
    expect(shouldCloseOnEscape("Escape", true)).toBe(false);
    let focused = false;
    const element = {
      focus: (options?: FocusOptions) => {
        focused = options?.preventScroll === true;
      },
    };
    expect(focusElement(element)).toBe(true);
    expect(focused).toBe(true);
    expect(focusElement(null)).toBe(false);
  });
});
