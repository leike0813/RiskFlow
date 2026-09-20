// 审阅控制台（#/__review）：页面总览台 / 状态矩阵 / 角色切换 / 缺口台账，
// 外加视口宽度预设与 Electron 可拖拽安全区叠加开关。
// 本路由属内部审阅设施：不属于 57 页、不进导航、不出现在截图产物。

import { useMemo, useState } from 'react';
import { capabilityStateFor } from '../app/capabilities';
import {
  PRESET_ROLES,
  ROLE_LABELS,
  capabilitiesForRoles,
  type PresetRole,
} from '../app/contract-mirror';
import { PAGE_STATE_VALUES } from '../app/state';
import { DOMAIN_LABELS, PAGES, type PageManifestEntry } from '../pages/manifest';
import { NAVIGATION_ITEMS } from '../shell/navigation';
import { SKELETON_LABELS } from '../shell/skeletons/skeletons';
import { GAPS, GAP_CATEGORY_LABELS, gapCountForPage } from './gapLedger';
import './review.css';

export interface ReviewConsoleProps {
  /** 当前完整路径（含查询串），用于回读角色与开关状态。 */
  readonly currentPath: string;
  readonly roles: readonly PresetRole[] | null;
  readonly rolesInvalid: boolean;
  readonly viewport: string | null;
  readonly safeArea: boolean;
  readonly onNavigate: (path: string) => void;
}

const VIEWPORT_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: '1920', label: '1920' },
  { value: '1440', label: '1440' },
  { value: '1280', label: '1280' },
  { value: '1024', label: '64rem（1024）' },
  { value: 'min', label: '最小窗口 64rem×40rem' },
];

function consoleQuery(input: {
  roles: readonly PresetRole[] | null;
  viewport: string | null;
  safeArea: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.roles !== null) params.set('roles', input.roles.join(','));
  if (input.viewport !== null) params.set('vp', input.viewport);
  if (input.safeArea) params.set('safearea', 'on');
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

function pageHref(
  samplePath: string,
  roles: readonly PresetRole[] | null,
  state?: string,
): string {
  const params = new URLSearchParams();
  if (state !== undefined) params.set('state', state);
  if (roles !== null) params.set('roles', roles.join(','));
  const query = params.toString();
  return `#${samplePath}${query === '' ? '' : `?${query}`}`;
}

function PageCard({
  page,
  roles,
}: {
  readonly page: PageManifestEntry;
  readonly roles: readonly PresetRole[] | null;
}) {
  const gapCount = gapCountForPage(page.pageId);
  return (
    <a className="rv-card" href={pageHref(page.samplePath, roles)}>
      <p className="rv-card-head">
        <span className="mono">{page.pageId}</span>
        <span className="rv-card-skeleton">{page.skeleton}</span>
      </p>
      <p className="rv-card-title">{page.title}</p>
      <p className="rv-card-meta">
        {DOMAIN_LABELS[page.domain]} · {SKELETON_LABELS[page.skeleton]} · {page.change}
      </p>
      <p className="rv-card-meta">{gapCount === 0 ? '无页面级缺口' : `${gapCount} 条已登记缺口`}</p>
    </a>
  );
}

function StateMatrix({ roles }: { readonly roles: readonly PresetRole[] | null }) {
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const domains = [...new Set(PAGES.map((page) => page.domain))];
  const pages = domainFilter === 'all' ? PAGES : PAGES.filter((page) => page.domain === domainFilter);
  return (
    <section className="rv-section" aria-labelledby="rv-matrix">
      <h2 id="rv-matrix">状态矩阵（57 × 7）</h2>
      <p className="rv-hint">
        单元格即直达链接：以强制状态打开对应页面（当前角色选择会随链接携带）。
      </p>
      <label className="rv-filter">
        按域过滤
        <select value={domainFilter} onChange={(event) => setDomainFilter(event.currentTarget.value)}>
          <option value="all">全部域</option>
          {domains.map((domain) => (
            <option key={domain} value={domain}>
              {DOMAIN_LABELS[domain as PageManifestEntry['domain']]}
            </option>
          ))}
        </select>
      </label>
      <div className="rv-matrix-wrap">
        <table className="rv-matrix">
          <thead>
            <tr>
              <th scope="col">页面</th>
              {PAGE_STATE_VALUES.map((state) => (
                <th key={state} scope="col">
                  {state}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.pageId}>
                <th scope="row">
                  <span className="mono">{page.pageId}</span> {page.title}
                </th>
                {PAGE_STATE_VALUES.map((state) => (
                  <td key={state}>
                    <a href={pageHref(page.samplePath, roles, state)}>{state.slice(0, 2)}</a>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RoleSwitcher({
  roles,
  rolesInvalid,
  viewport,
  safeArea,
  onNavigate,
}: Pick<ReviewConsoleProps, 'roles' | 'rolesInvalid' | 'viewport' | 'safeArea' | 'onNavigate'>) {
  const selected = roles ?? ['project-risk-manager' as PresetRole];
  const granted = rolesInvalid ? null : capabilitiesForRoles(selected);
  const toggle = (role: PresetRole) => {
    const next = selected.includes(role)
      ? selected.filter((item) => item !== role)
      : [...selected, role];
    onNavigate(`/__review${consoleQuery({ roles: next, viewport, safeArea })}`);
  };
  const onlySystemAdmin =
    selected.length === 1 && selected[0] === 'system-administrator' && !rolesInvalid;
  return (
    <section className="rv-section" aria-labelledby="rv-roles">
      <h2 id="rv-roles">角色切换（五角色，多选取并集）</h2>
      <p className="rv-hint">
        能力集镜像 packages/core 角色策略：分支并集 → 能力位推导，非手写常量。
        切换写回当前 URL 的 ?roles=，之后打开的页面按并集重算导航可达性。
      </p>
      <div className="rv-role-list" role="group" aria-label="角色选择">
        {PRESET_ROLES.map((role) => (
          <label key={role} className="rv-role">
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={() => toggle(role)}
            />
            <span>
              {ROLE_LABELS[role]} <code className="mono">{role}</code>
            </span>
          </label>
        ))}
      </div>
      {rolesInvalid ? (
        <p className="rv-warning">URL 中含未识别角色，能力集按未知处理（导航显示「权限检查中」）。</p>
      ) : null}
      {onlySystemAdmin ? (
        <p className="rv-warning">
          验证点：system-administrator 的分支集为空集——不自动可见任何业务数据（区别于「管理员看全部」），
          下方导航全部呈现 denied。
        </p>
      ) : null}
      <p className="rv-hint">
        当前选择：<code className="mono">{selected.join(', ') || '（空）'}</code>
        ，能力位 {granted === null ? '未知' : `${granted.size} 个`}。
      </p>
      <ul className="rv-nav-preview" aria-label="导航可达性预览">
        {NAVIGATION_ITEMS.map((item) => {
          const permission = capabilityStateFor(item.requiredCapability, granted);
          return (
            <li key={item.id} data-state={permission}>
              <span>{item.label}</span>
              <span className="rv-nav-state">{permission}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GapPanel({ roles }: { readonly roles: readonly PresetRole[] | null }) {
  const [pageFilter, setPageFilter] = useState<string>('all');
  const gaps =
    pageFilter === 'all'
      ? GAPS
      : GAPS.filter((gap) => (gap.pageIds ?? []).includes(pageFilter));
  return (
    <section className="rv-section" aria-labelledby="rv-gaps">
      <h2 id="rv-gaps">缺口台账（{GAPS.length} 条）</h2>
      <p className="rv-hint">
        每条五字段：缺口 / 依据 / 预设 / 待确认 / 风险。文档视图见 docs/GAP-LEDGER.md 与 docs/gaps/。
      </p>
      <label className="rv-filter">
        按页面过滤
        <select value={pageFilter} onChange={(event) => setPageFilter(event.currentTarget.value)}>
          <option value="all">全部页面</option>
          {PAGES.map((page) => (
            <option key={page.pageId} value={page.pageId}>
              {page.pageId} {page.title}
            </option>
          ))}
        </select>
      </label>
      <div className="rv-gap-list">
        {gaps.map((gap) => (
          <article key={gap.id} className="rv-gap">
            <h3>
              <span className="mono">{gap.id}</span> [{gap.category} {GAP_CATEGORY_LABELS[gap.category]}]{' '}
              {gap.title}
            </h3>
            <dl>
              <div>
                <dt>依据</dt>
                <dd>{gap.basis}</dd>
              </div>
              <div>
                <dt>预设</dt>
                <dd>{gap.preset}</dd>
              </div>
              <div>
                <dt>待确认</dt>
                <dd>{gap.pending}</dd>
              </div>
              <div>
                <dt>风险</dt>
                <dd>{gap.risk}</dd>
              </div>
              {(gap.pageIds ?? []).length > 0 ? (
                <div>
                  <dt>相关页面</dt>
                  <dd>
                    {(gap.pageIds ?? []).map((pageId) => {
                      const page = PAGES.find((item) => item.pageId === pageId);
                      return page ? (
                        <a key={pageId} href={pageHref(page.samplePath, roles)}>
                          {pageId}
                        </a>
                      ) : (
                        <span key={pageId} className="mono">
                          {pageId}
                        </span>
                      );
                    })}
                  </dd>
                </div>
              ) : null}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function ViewportPanel({
  roles,
  viewport,
  safeArea,
  onNavigate,
}: Pick<ReviewConsoleProps, 'roles' | 'viewport' | 'safeArea' | 'onNavigate'>) {
  return (
    <section className="rv-section" aria-labelledby="rv-viewport">
      <h2 id="rv-viewport">视口与 Electron 安全区</h2>
      <p className="rv-hint">
        视口预设以虚线参考线叠加在当前窗口（参数 ?vp= 可书签化）；安全区开关高亮顶部 28px 可拖拽区。
        窗口最小声明尺寸 64rem × 40rem。
      </p>
      <div className="rv-viewport-btns" role="group" aria-label="视口宽度预设">
        {VIEWPORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={viewport === option.value}
            onClick={() =>
              onNavigate(
                `/__review${consoleQuery({
                  roles,
                  viewport: viewport === option.value ? null : option.value,
                  safeArea,
                })}`,
              )
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="rv-role">
        <input
          type="checkbox"
          checked={safeArea}
          onChange={() =>
            onNavigate(`/__review${consoleQuery({ roles, viewport, safeArea: !safeArea })}`)
          }
        />
        <span>显示 Electron 可拖拽安全区叠加（?safearea=on）</span>
      </label>
    </section>
  );
}

export function ReviewConsole(props: ReviewConsoleProps) {
  const { roles } = props;
  const pagesByDomainList = useMemo(() => {
    const domains = [...new Set(PAGES.map((page) => page.domain))];
    return domains.map((domain) => ({
      domain,
      pages: PAGES.filter((page) => page.domain === domain),
    }));
  }, []);
  return (
    <main className="rv-console">
      <header className="rv-header">
        <h1>RiskFlow v2 审阅控制台</h1>
        <p className="rv-hint">
          内部审阅设施：不属于 57 页、不进导航、不进入截图产物。所有审阅参数走 URL，可书签化。
          示例：<code className="mono">#/identification/runs/RUN-001?state=empty</code>、
          <code className="mono">#/knowledge/mechanisms?roles=reviewer,field-responder&gaps=on</code>
        </p>
      </header>
      <section className="rv-section" aria-labelledby="rv-pages">
        <h2 id="rv-pages">页面总览台（57 页）</h2>
        {pagesByDomainList.map(({ domain, pages }) => (
          <div key={domain} className="rv-domain">
            <h3>
              {DOMAIN_LABELS[domain as PageManifestEntry['domain']]}{' '}
              <span className="rv-domain-count">{pages.length} 页</span>
            </h3>
            <div className="rv-card-grid">
              {pages.map((page) => (
                <PageCard key={page.pageId} page={page} roles={roles} />
              ))}
            </div>
          </div>
        ))}
      </section>
      <StateMatrix roles={roles} />
      <RoleSwitcher {...props} />
      <ViewportPanel {...props} />
      <GapPanel roles={roles} />
      <p className="visually-hidden" role="status" aria-live="polite">
        审阅控制台
      </p>
    </main>
  );
}
