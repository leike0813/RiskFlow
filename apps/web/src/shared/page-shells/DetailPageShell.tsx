import type { ReactNode } from "react";

import type { PageLoadStateV1 } from "../../app/state.js";
import type { WebActionV1 } from "../actions.js";
import { PageFrame, type PageRegionV1 } from "./PageFrame.js";

export type DetailPageShellPropsV1<T> = Readonly<{
  title: string;
  state: PageLoadStateV1<T>;
  identity?: ReactNode;
  sections?: ReactNode | ((value: T) => ReactNode);
  audit?: ReactNode;
  actions?: readonly WebActionV1[];
  emptyMessage?: string;
  className?: string;
}>;

/** 单区域快捷组合：身份、正文与审计合成一个 detail 区域。 */
export const DetailPageShell = <T,>(props: DetailPageShellPropsV1<T>): ReactNode => {
  const regions: readonly PageRegionV1<T>[] = [
    {
      descriptor: { key: "detail", kind: "detail" },
      content: (value: T) => (
        <>
          {props.identity}
          {props.sections === undefined
            ? null
            : typeof props.sections === "function"
              ? props.sections(value)
              : props.sections}
          {props.audit}
        </>
      ),
    },
  ];
  return (
    <PageFrame
      title={props.title}
      state={props.state}
      regions={regions}
      {...(props.actions === undefined ? {} : { actions: props.actions.slice(0, 3) })}
      {...(props.emptyMessage === undefined ? {} : { emptyMessage: props.emptyMessage })}
      {...(props.className === undefined ? {} : { className: props.className })}
    />
  );
};
