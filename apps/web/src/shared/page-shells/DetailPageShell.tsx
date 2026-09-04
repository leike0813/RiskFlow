import type { ReactNode } from "react";

import { PageFrame, type PageFramePropsV1 } from "./PageFrame.js";

export type DetailPageShellPropsV1<T> = Readonly<
  Omit<PageFramePropsV1<T>, "variant"> & {
    identity?: ReactNode;
    sections?: ReactNode | ((value: T) => ReactNode);
    audit?: ReactNode;
  }
>;

export const DetailPageShell = <T,>(props: DetailPageShellPropsV1<T>): ReactNode => (
  <PageFrame
    {...props}
    {...(props.actions === undefined ? {} : { actions: props.actions.slice(0, 3) })}
    variant="detail"
    content={(value: T) => (
      <>
        {props.identity}
        {props.sections !== undefined
          ? typeof props.sections === "function"
            ? props.sections(value)
            : props.sections
          : typeof props.content === "function"
            ? props.content(value)
            : props.content}
        {props.audit}
      </>
    )}
  />
);
