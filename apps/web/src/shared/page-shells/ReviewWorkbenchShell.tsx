import type { ReactNode } from "react";

import { PageFrame, type PageFramePropsV1 } from "./PageFrame.js";

export type ReviewWorkbenchShellPropsV1<T> = Readonly<
  Omit<PageFramePropsV1<T>, "variant"> & {
    queue?: ReactNode;
    evidence?: ReactNode;
    decision?: ReactNode | ((value: T) => ReactNode);
  }
>;

export const ReviewWorkbenchShell = <T,>(props: ReviewWorkbenchShellPropsV1<T>): ReactNode => (
  <PageFrame
    {...props}
    variant="review"
    content={(value: T) => (
      <>
        {props.queue}
        {props.evidence}
        {props.decision !== undefined
          ? typeof props.decision === "function"
            ? props.decision(value)
            : props.decision
          : typeof props.content === "function"
            ? props.content(value)
            : props.content}
      </>
    )}
  />
);
