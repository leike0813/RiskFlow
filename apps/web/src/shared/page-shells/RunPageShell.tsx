import type { ReactNode } from "react";

import type { PageLoadStateV1 } from "../../app/state.js";
import type { WebActionV1 } from "../actions.js";
import { PageFrame, type PageRegionV1 } from "./PageFrame.js";

export type RunPageShellPropsV1<T> = Readonly<{
  title: string;
  state: PageLoadStateV1<T>;
  progress?: ReactNode;
  stages?: ReactNode;
  body?: ReactNode | ((value: T) => ReactNode);
  recovery?: ReactNode;
  actions?: readonly WebActionV1[];
  emptyMessage?: string;
  className?: string;
}>;

/** 单区域快捷组合：进度、阶段、正文与恢复合成一个 run 区域。 */
export const RunPageShell = <T,>(props: RunPageShellPropsV1<T>): ReactNode => {
  const regions: readonly PageRegionV1<T>[] = [
    {
      descriptor: { key: "run", kind: "run" },
      content: (value: T) => (
        <>
          {props.progress}
          {props.stages}
          {props.body === undefined
            ? null
            : typeof props.body === "function"
              ? props.body(value)
              : props.body}
          {props.recovery}
        </>
      ),
    },
  ];
  return (
    <PageFrame
      title={props.title}
      state={props.state}
      regions={regions}
      {...(props.actions === undefined ? {} : { actions: props.actions })}
      {...(props.emptyMessage === undefined ? {} : { emptyMessage: props.emptyMessage })}
      {...(props.className === undefined ? {} : { className: props.className })}
    />
  );
};
