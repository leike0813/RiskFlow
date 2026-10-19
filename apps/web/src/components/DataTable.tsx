import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Table, type TableColumnsType } from "antd";

import "./DataTable.css";

export interface DataTableColumn {
  key: string;
  title: string;
  width?: number | string;
  align?: "left" | "center" | "right";
  render?: (row: Record<string, unknown>) => ReactNode;
}

type DataTableRow = Record<string, unknown>;

/**
 * 行本身是激活目标时，焦点和 Enter/Space 落在行上；行内的链接、按钮、输入各自
 * 已是可聚焦控件，它们的键盘事件必须继续只触发自己，不能同时触发行操作。
 */
const INTERACTIVE_SELECTOR =
  'a[href], button, input, select, textarea, [role="button"], [role="link"]';

const originatedInInteractive = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;

/**
 * 数据表格：无斑马纹，行 hover 浅灰，可选行点击。
 *
 * 组件只负责呈现调用方给出的当前页 rows：分页、排序、筛选、选择与数据变换都由原查询
 * 拥有，这里显式关闭 AntD 的内置分页，避免切出第二套客户端分页。
 */
export function DataTable({
  columns,
  rows,
  onRowClick,
}: {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  onRowClick?: (row: DataTableRow) => void;
}) {
  const antdColumns: TableColumnsType<DataTableRow> = columns.map((col) => ({
    key: col.key,
    title: col.title,
    align: col.align ?? "left",
    ...(col.width === undefined ? {} : { width: col.width }),
    // 列的 render 继续收到原 row；未提供时按原 ReactNode 语义直接显示该字段。
    render: (_value, row) =>
      col.render === undefined ? (row[col.key] as ReactNode) : col.render(row),
  }));

  const rowProps = (row: DataTableRow) => {
    if (onRowClick === undefined) return {};
    return {
      className: "data-table-row--clickable",
      tabIndex: 0,
      onClick: (event: MouseEvent) => {
        if (originatedInInteractive(event.target)) return;
        onRowClick(row);
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (originatedInInteractive(event.target)) return;
        event.preventDefault();
        onRowClick(row);
      },
    };
  };

  return (
    <div className="data-table-host">
      <Table<DataTableRow>
        columns={antdColumns}
        dataSource={rows}
        // 沿用既有按输入顺序的行身份，不猜测业务主键字段。
        rowKey={(_row, index) => String(index ?? 0)}
        pagination={false}
        locale={{ emptyText: null }}
        onRow={rowProps}
      />
    </div>
  );
}
