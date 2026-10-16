import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { C09HttpError } from "../api/http";
import { useEngineering, useProjectPath } from "../api/engineering";
import {
  readEvidenceAccess,
  type EvidenceAccessItemView,
  type VersionRef,
} from "../api/operations";
import { Icon } from "./icons";
import "./EvidenceDrawer.css";

export interface EvidenceTarget {
  readonly segmentId: string;
  readonly name?: string;
  /** 真实来源版本引用：没有它就没有可查询的证据来源，按缺证据呈现而非回退静态样例。 */
  readonly sourceVersionRef?: VersionRef;
  /** 调用方业务对象标识：抽屉据此呈现"引用该证据的业务对象"。 */
  readonly referencedBy?: string;
}

interface EvidenceContextValue {
  openEvidence: (target: EvidenceTarget) => void;
  closeEvidence: () => void;
  current: EvidenceTarget | null;
}

const EvidenceContext = createContext<EvidenceContextValue | null>(null);

/** 在任何"证据定位信息"入口内使用：打开右侧证据抽屉 */
export function useEvidence(): EvidenceContextValue {
  const ctx = useContext(EvidenceContext);
  if (!ctx) throw new Error("useEvidence 必须在 EvidenceProvider 内使用");
  return ctx;
}

type DrawerDataState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly item: EvidenceAccessItemView }
  | { readonly kind: "redacted" }
  | { readonly kind: "error"; readonly code: string };

/**
 * 证据抽屉 Provider（AppShell 内挂载）。
 * 真实路径经 evidence-access 查询 + 结果再读取：有授权呈现段结构定位（资料段标识、章节
 * 路径、资料版本与段集引用）；无授权呈现固定脱敏提示，不发起替代取数、不呈现段正文原文。
 */
export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<EvidenceTarget | null>(null);
  const [dataState, setDataState] = useState<DrawerDataState>({ kind: "idle" });
  const { selector } = useEngineering();
  const projectPath = useProjectPath();

  const openEvidence = useCallback((target: EvidenceTarget) => {
    setCurrent(target);
  }, []);

  const closeEvidence = useCallback(() => {
    setCurrent(null);
    setDataState({ kind: "idle" });
  }, []);

  useEffect(() => {
    if (current === null || selector.projectId === null) {
      setDataState({ kind: "idle" });
      return;
    }
    const sourceVersionRef = current.sourceVersionRef;
    if (sourceVersionRef === undefined) {
      setDataState({ kind: "idle" });
      return;
    }
    const projectId = selector.projectId;
    const target = current;
    const controller = new AbortController();
    setDataState({ kind: "loading" });
    readEvidenceAccess(
      projectId,
      [
        {
          sourceSegmentId: target.segmentId,
          sourceVersionRef,
        },
      ],
      controller.signal,
    )
      .then((items) => {
        const item = items[0];
        if (item === undefined) {
          setDataState({ kind: "redacted" });
          return;
        }
        setDataState({ kind: "ready", item });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (
          error instanceof C09HttpError &&
          (error.error.code === "NOT_FOUND" || error.error.code === "AUTHENTICATION_REQUIRED")
        ) {
          setDataState({ kind: "redacted" });
          return;
        }
        setDataState({
          kind: "error",
          code: error instanceof C09HttpError ? error.error.code : "TERMINAL_FAILURE",
        });
      });
    return () => controller.abort();
  }, [current, selector.projectId]);

  const value = useMemo(
    () => ({ openEvidence, closeEvidence, current }),
    [openEvidence, closeEvidence, current],
  );

  // C37 D-17：删除静态原型回退。缺来源版本引用时不查询、不取静态样例，
  // 按真实缺证据状态呈现，避免用原型数据冒充业务事实。
  const withoutSourceRef = current !== null && current.sourceVersionRef === undefined;

  return (
    <EvidenceContext.Provider value={value}>
      {children}
      {current && (
        <aside className="evidence-drawer">
          <header className="evidence-drawer-header">
            <span className="evidence-drawer-title">
              <Icon name="doc" size={16} />
              证据定位
            </span>
            <button
              type="button"
              className="evidence-drawer-close"
              onClick={closeEvidence}
              aria-label="关闭证据抽屉"
            >
              <Icon name="close" size={16} />
            </button>
          </header>
          <div className="evidence-drawer-body">
            <div className="evidence-field">
              <div className="evidence-field-label">资料段标识</div>
              <div className="evidence-field-value mono">{current.segmentId}</div>
            </div>
            {current.name !== undefined && (
              <div className="evidence-field">
                <div className="evidence-field-label">名称</div>
                <div className="evidence-field-value">{current.name}</div>
              </div>
            )}

            {withoutSourceRef && (
              <div className="evidence-field">
                <div className="evidence-field-label">证据定位</div>
                <div className="evidence-field-value">该证据没有可查询的来源版本，未发起取数</div>
              </div>
            )}

            {current.sourceVersionRef !== undefined && (
              <>
                {dataState.kind === "loading" && (
                  <div className="evidence-field">
                    <div className="evidence-field-value">证据定位加载中…</div>
                  </div>
                )}
                {dataState.kind === "redacted" && (
                  <div className="evidence-field">
                    <div className="evidence-field-label">定位摘要</div>
                    <div className="evidence-field-value">
                      当前会话无该资料来源版本的访问授权，仅呈现定位摘要，不提供段正文。
                    </div>
                  </div>
                )}
                {dataState.kind === "error" && (
                  <div className="evidence-field">
                    <div className="evidence-field-value">
                      证据定位读取失败（{dataState.code}），请关闭后重试。
                    </div>
                  </div>
                )}
                {dataState.kind === "ready" && (
                  <>
                    <div className="evidence-field">
                      <div className="evidence-field-label">章节路径</div>
                      <div className="evidence-field-value">
                        {dataState.item.segment.headingPath.join(" / ")}
                      </div>
                    </div>
                    <div className="evidence-field">
                      <div className="evidence-field-label">资料版本</div>
                      <div className="evidence-field-value mono">
                        {dataState.item.sourceVersionRef.reference.entityId} ·{" "}
                        {dataState.item.sourceVersionRef.reference.versionId}
                      </div>
                    </div>
                    <div className="evidence-field">
                      <div className="evidence-field-value">
                        <Link
                          to={projectPath(
                            `/projects/documents/${encodeURIComponent(
                              dataState.item.sourceVersionRef.reference.entityId,
                            )}?version=${encodeURIComponent(dataState.item.sourceVersionRef.reference.versionId)}&segment=${encodeURIComponent(current.segmentId)}${dataState.item.segment.pageNumber === undefined ? "" : `&page=${dataState.item.segment.pageNumber}`}`,
                          )}
                          onClick={closeEvidence}
                        >
                          打开资料详情并定位该段
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {current.referencedBy !== undefined && (
              <div className="evidence-field">
                <div className="evidence-field-label">引用该证据的业务对象</div>
                <div className="evidence-refs">
                  <span className="evidence-ref mono">{current.referencedBy}</span>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </EvidenceContext.Provider>
  );
}
