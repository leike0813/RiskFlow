import type { ReactNode } from "react";

import type { PageLoadStateV1 } from "../../app/state.js";
import type { WebActionV1 } from "../actions.js";
import { PageFrame, type PageRegionV1 } from "./PageFrame.js";

export type ListPageShellPropsV1<T> = Readonly<{
  title: string;
  state: PageLoadStateV1<T>;
  filters?: ReactNode;
  table?: ReactNode | ((value: T) => ReactNode);
  pagination?: ReactNode;
  actions?: readonly WebActionV1[];
  emptyMessage?: string;
  className?: string;
}>;

/** 单区域快捷组合：筛选、表格与分页合成一个 list 区域，不是旧枚举适配器。 */
export const ListPageShell = <T,>(props: ListPageShellPropsV1<T>): ReactNode => {
  const regions: readonly PageRegionV1<T>[] = [
    {
      descriptor: { key: "list", kind: "list" },
      content: (value: T) => (
        <>
          {props.filters}
          {props.table === undefined
            ? null
            : typeof props.table === "function"
              ? props.table(value)
              : props.table}
          {props.pagination}
        </>
      ),
    },
  ];
  return <PageFrame {...props} regions={regions} />;
};

export type ListPageStateV1<T> = PageLoadStateV1<T>;
export type { WebActionV1 };
