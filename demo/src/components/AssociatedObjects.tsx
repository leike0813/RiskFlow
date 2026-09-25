import { Link } from 'react-router-dom'
import { Card } from './Card'
import { PageStateView } from './PageStateView'
import { usePageQuery, useProjectPath } from '../api/context'
import { readTraceChain, type KindRef } from '../api/operations'
import './AssociatedObjects.css'

/** 已知关联对象种类的深链目标；未识别种类只呈现标识，不编造链接。 */
const DEEP_LINKS: Record<string, (entityId: string) => string> = {
  'standardized-risk-record': () => '/identification/records',
  'risk-assessment-record': () => '/assessment/records',
  'warning-record': () => '/warnings',
}

interface TraceLinkItem {
  readonly fromRef: KindRef
  readonly toRef: KindRef
  readonly relation: string
}

const asKindRefView = (value: unknown): KindRef | null => {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const reference = record.reference as Record<string, unknown> | undefined
  if (
    typeof record.kind !== 'string' ||
    typeof reference?.entityId !== 'string' ||
    typeof reference?.versionId !== 'string'
  ) {
    return null
  }
  return {
    kind: record.kind,
    reference: { entityId: reference.entityId, versionId: reference.versionId },
  }
}

/**
 * 关联对象区：治理条目/业务对象经 trace-chain 投影查询与结果读取呈现引用它的对象。
 * 投影不可用或失败时呈现结构化原因与重试，不降级为编造链接。
 */
export function AssociatedObjects({ subjectRef }: { subjectRef: KindRef }) {
  const projectPath = useProjectPath()
  const { state, retry } = usePageQuery(
    (projectId, signal) => readTraceChain(projectId, subjectRef, signal),
    [subjectRef.reference.entityId, subjectRef.reference.versionId],
  )

  return (
    <PageStateView
      state={state}
      title="关联对象"
      emptyMessage="暂无关联对象"
      forbiddenHint="当前角色不具备追溯投影的读取权限"
      onRetry={retry}
    >
      {(page) => {
        const links: TraceLinkItem[] = page.items.flatMap((item) => {
          if (item.kind !== 'trace-link') return []
          const fromRef = asKindRefView(item.fromRef)
          const toRef = asKindRefView(item.toRef)
          if (fromRef === null || toRef === null) return []
          return [{ fromRef, toRef, relation: String(item.relation ?? '') }]
        })
        return (
          <Card title="关联对象">
            {links.length === 0 ? (
              <div className="ao-empty">暂无关联对象</div>
            ) : (
              <ul className="ao-list">
                {links.map((link, index) => {
                  const target =
                    link.fromRef.kind === subjectRef.kind &&
                    link.fromRef.reference.entityId === subjectRef.reference.entityId
                      ? link.toRef
                      : link.fromRef
                  const deepLink = DEEP_LINKS[target.kind]
                  const label = `${target.kind} · ${target.reference.entityId}`
                  return (
                    <li key={index} className="ao-item">
                      <span className="ao-relation">{link.relation}</span>
                      {deepLink === undefined ? (
                        <span className="mono">{label}</span>
                      ) : (
                        <Link className="mono" to={projectPath(deepLink(target.reference.entityId))}>
                          {label}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        )
      }}
    </PageStateView>
  )
}
