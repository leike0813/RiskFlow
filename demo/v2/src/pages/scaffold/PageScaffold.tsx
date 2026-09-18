// 通用脚手架页：57 页在页面铺量批次（M4）前统一渲染本组件。
// 展示页面 ID / 中文名 / 所属骨架 / 数据来源 branch / 所需能力位，七态由
// PageFrame 承载，页面状态由框架层注入（input.pageState），本组件不读取 URL 参数。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import { SKELETON_LABELS } from '../../shell/skeletons/skeletons';
import { DOMAIN_LABELS, type PageManifestEntry } from '../manifest';
import './page-scaffold.css';

export function PageScaffold({
  page,
  input,
}: {
  readonly page: PageManifestEntry;
  readonly input: RouteRenderInput;
}) {
  const params = Object.entries(input.params);
  return (
    <PageFrame
      title={page.title}
      state={input.pageState}
      skeleton={page.skeleton}
      content={
        <div className="page-scaffold">
          <dl className="page-scaffold-meta">
            <div>
              <dt>页面 ID</dt>
              <dd className="mono">{page.pageId}</dd>
            </div>
            <div>
              <dt>中文名</dt>
              <dd>{page.title}</dd>
            </div>
            <div>
              <dt>所属域</dt>
              <dd>{DOMAIN_LABELS[page.domain]}</dd>
            </div>
            <div>
              <dt>所属骨架</dt>
              <dd>{SKELETON_LABELS[page.skeleton]}</dd>
            </div>
            <div>
              <dt>归属 change</dt>
              <dd className="mono">{page.change}</dd>
            </div>
            <div>
              <dt>数据来源 branch</dt>
              <dd className="mono">{page.branch ?? '无（设施域页面）'}</dd>
            </div>
            <div>
              <dt>所需能力位</dt>
              <dd className="mono">{page.capability ?? '无页面级门控'}</dd>
            </div>
            <div>
              <dt>路由模板</dt>
              <dd className="mono">{page.path}</dd>
            </div>
            {params.length > 0 ? (
              <div>
                <dt>路由参数</dt>
                <dd className="mono">
                  {params.map(([key, value]) => `${key}=${value}`).join('，')}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="page-scaffold-note">
            本页为设计脚手架：布局、数据与交互将在页面铺量批次按 docs/PAGE-GUIDE.md 的约定实现。
          </p>
        </div>
      }
    />
  );
}
