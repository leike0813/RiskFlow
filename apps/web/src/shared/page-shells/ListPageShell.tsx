import type { ReactNode } from "react";

import type { PageLoadStateV1 } from "../../app/state.js";
import type { WebActionV1 } from "../actions.js";
import { PageFrame, type PageFramePropsV1 } from "./PageFrame.js";

export type ListPageShellPropsV1<T> = Readonly<
  Omit<PageFramePropsV1<T>, "variant"> & {
    filters?: ReactNode;
    table?: ReactNode | ((value: T) => ReactNode);
    pagination?: ReactNode;
  }
>;

export const ListPageShell = <T,>(props: ListPageShellPropsV1<T>): ReactNode => (
  <PageFrame
    {...props}
    variant="list"
    content={(value: T) => (
      <>
        {props.filters}
        {props.table !== undefined
          ? typeof props.table === "function"
            ? props.table(value)
            : props.table
          : typeof props.content === "function"
            ? props.content(value)
            : props.content}
        {props.pagination}
      </>
    )}
  />
);

export type ListPageStateV1<T> = PageLoadStateV1<T>;
export type { WebActionV1 };
