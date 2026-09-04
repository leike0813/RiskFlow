import type { ReactNode } from "react";

import { PageFrame, type PageFramePropsV1 } from "./PageFrame.js";

export type GovernancePageShellPropsV1<T> = Readonly<
  Omit<PageFramePropsV1<T>, "variant"> & {
    revisions?: ReactNode;
    diff?: ReactNode | ((value: T) => ReactNode);
    governanceActions?: ReactNode;
  }
>;

export const GovernancePageShell = <T,>(props: GovernancePageShellPropsV1<T>): ReactNode => (
  <PageFrame
    {...props}
    variant="governance"
    content={(value: T) => (
      <>
        {props.revisions}
        {props.diff !== undefined
          ? typeof props.diff === "function"
            ? props.diff(value)
            : props.diff
          : typeof props.content === "function"
            ? props.content(value)
            : props.content}
        {props.governanceActions}
      </>
    )}
  />
);
