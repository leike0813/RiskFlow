import type { ReactNode } from "react";

import type { PageLoadStateV1 } from "../../app/state.js";
import type { WebActionV1 } from "../actions.js";
import { PageFrame, type PageRegionV1 } from "./PageFrame.js";

export type GovernancePageShellPropsV1<T> = Readonly<{
  title: string;
  state: PageLoadStateV1<T>;
  revisions?: ReactNode;
  diff?: ReactNode | ((value: T) => ReactNode);
  governanceActions?: ReactNode;
  actions?: readonly WebActionV1[];
  emptyMessage?: string;
  className?: string;
}>;

/** 单区域快捷组合：修订、差异与治理动作合成一个 governance 区域。 */
export const GovernancePageShell = <T,>(props: GovernancePageShellPropsV1<T>): ReactNode => {
  const regions: readonly PageRegionV1<T>[] = [
    {
      descriptor: { key: "governance", kind: "governance" },
      content: (value: T) => (
        <>
          {props.revisions}
          {props.diff === undefined
            ? null
            : typeof props.diff === "function"
              ? props.diff(value)
              : props.diff}
          {props.governanceActions}
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
