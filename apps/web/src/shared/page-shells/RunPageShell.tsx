import type { ReactNode } from "react";

import { PageFrame, type PageFramePropsV1 } from "./PageFrame.js";

export type RunPageShellPropsV1<T> = Readonly<
  Omit<PageFramePropsV1<T>, "variant"> & {
    progress?: ReactNode;
    stages?: ReactNode;
    recovery?: ReactNode;
  }
>;

export const RunPageShell = <T,>(props: RunPageShellPropsV1<T>): ReactNode => (
  <PageFrame
    {...props}
    variant="run"
    content={(value: T) => (
      <>
        {props.progress}
        {props.stages}
        {typeof props.content === "function" ? props.content(value) : props.content}
        {props.recovery}
      </>
    )}
  />
);
