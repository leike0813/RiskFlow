/**
 * 备份与恢复（v2 P-OP-05 的范围 + 恢复分区视觉结构）。
 *
 * 整项能力当前为未接入：没有备份策略、恢复点、校验、幂等与执行端口，
 * 因此本页只呈现缺席事实与返回入口。不渲染样例策略、样例恢复点，
 * 不提供任何恢复或危险动作按钮，也不发备份恢复相关的 HTTP 请求。
 */
import { Link } from 'react-router-dom'
import { Card } from '../../components/Card'
import { Field, OpsPage } from './opsShared'
import './ops.css'

export default function BackupPage() {
  return (
    <OpsPage title="备份与恢复" subtitle="备份与恢复能力尚未接入">
      <p className="op-context">备份策略 0 项 · 恢复点 0 项 · 执行入口未接入</p>

      <Card title="备份策略" style={{ marginBottom: 16 }}>
        <dl className="op-field-grid">
          <Field label="策略版本">
            <span className="op-muted">未接入：当前部署没有备份策略登记。</span>
          </Field>
          <Field label="覆盖范围">
            <span className="op-muted">未接入</span>
          </Field>
          <Field label="频率与保留">
            <span className="op-muted">未接入</span>
          </Field>
          <Field label="发布审计">
            <span className="op-muted">未接入</span>
          </Field>
        </dl>
      </Card>

      <Card title="恢复点">
        <p className="op-muted">
          恢复点、校验、幂等、执行与系统审计尚未接入，因此本页没有可列出的恢复点，也不提供恢复入口。
        </p>
        <p className="op-note">
          在该能力正式接入并获得授权之前，本页不会对系统产生任何写入或执行副作用。
        </p>
      </Card>

      <p className="op-note">
        <Link to="/ops/health">返回运行健康</Link>：可先确认当前部署登记的组件状态。
      </p>
    </OpsPage>
  )
}