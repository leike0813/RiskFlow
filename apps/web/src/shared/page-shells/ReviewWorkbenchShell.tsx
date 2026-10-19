import type { ReactNode } from "react";

import type { PageLoadStateV1 } from "../../app/state.js";
import type { WebActionV1 } from "../actions.js";
import { PageFrame, type PageRegionV1 } from "./PageFrame.js";

export type ReviewWorkbenchShellPropsV1<T> = Readonly<{
  title: string;
  state: PageLoadStateV1<T>;
  queue?: ReactNode;
  evidence?: ReactNode;
  decision?: ReactNode | ((value: T) => ReactNode);
  actions?: readonly WebActionV1[];
  emptyMessage?: string;
  className?: string;
}>;

/** 单区域快捷组合：队列、证据与决定合成一个 review 区域。 */
export const ReviewWorkbenchShell = <T,>(props: ReviewWorkbenchShellPropsV1<T>): ReactNode => {
  const regions: readonly PageRegionV1<T>[] = [
    {
      descriptor: { key: "review", kind: "review" },
      content: (value: T) => (
        <>
          {props.queue}
          {props.evidence}
          {props.decision === undefined
            ? null
            : typeof props.decision === "function"
              ? props.decision(value)
              : props.decision}
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
