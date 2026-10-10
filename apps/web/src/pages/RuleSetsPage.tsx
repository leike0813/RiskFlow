import AppShell from "../components/AppShell";
import { AssociatedObjects } from "../components/AssociatedObjects";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { EvidenceLink } from "../components/EvidenceLink";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery } from "../api/engineering";
import {
  listKnowledgeDefinitions,
  readCurrentReleaseSet,
  readKnowledgeRelease,
  type GovernanceReleaseView,
  type ScoringRuleMemberView,
} from "../api/operations";
import { LifecycleTag, knowledgeTabs, lifecycleStatusOf } from "./knowledgeShared";
import "./RuleSetsPage.css";

interface RuleSetFacts {
  readonly ruleSetRelease: GovernanceReleaseView | null;
  readonly scoringRules: ScoringRuleMemberView[];
  readonly scoringRulesRelease: GovernanceReleaseView | null;
}

const ruleColumns: DataTableColumn[] = [
  {
    key: "ruleId",
    title: "规则标识",
    width: 180,
    render: (row) => <span className="mono">{row.ruleId as string}</span>,
  },
  { key: "indicatorItem", title: "指标项", width: 160 },
  {
    key: "applicability",
    title: "适用条件",
    render: (row) => {
      const applicability = row.applicability as {
        constructionMethod: string[];
        stratumCondition: string[];
        engineeringStage: string[];
      };
      return [
        ...applicability.constructionMethod,
        ...applicability.stratumCondition,
        ...applicability.engineeringStage,
      ].join("、");
    },
  },
  {
    key: "reviewStatus",
    title: "审核状态",
    width: 110,
    render: (row) => <span>{row.reviewStatus as string}</span>,
  },
  {
    key: "ruleVersion",
    title: "规则版本",
    width: 120,
    render: (row) => (
      <VersionTag>
        {(row.ruleVersion as { entityId: string; versionId: string }).versionId}
      </VersionTag>
    ),
  },
  {
    key: "evidenceReferences",
    title: "证据",
    width: 220,
    render: (row) => {
      const references = row.evidenceReferences as {
        sourceSegmentId: string;
        sourceVersionRef: { entityId: string; versionId: string };
      }[];
      return (
        <>
          {references.slice(0, 2).map((reference) => (
            <EvidenceLink
              key={reference.sourceSegmentId}
              segmentId={reference.sourceSegmentId}
              sourceVersionRef={reference.sourceVersionRef}
              referencedBy={row.ruleId as string}
            />
          ))}
        </>
      );
    },
  },
];

export default function RuleSetsPage() {
  const { selector } = useEngineering();
  const { state, retry } = usePageQuery<RuleSetFacts>(async (projectId, signal) => {
    const releaseSet = await readCurrentReleaseSet(projectId, signal);
    const ruleSetMember = releaseSet.find(
      (member) => member.definitionType === "applicable-rule-set",
    );
    const ruleSetRelease =
      ruleSetMember === undefined
        ? null
        : await readKnowledgeRelease(projectId, ruleSetMember.releaseRef, signal);

    const scoringDefinitions = await listKnowledgeDefinitions(
      projectId,
      { definitionType: "structured-scoring-rule", lifecycleStatus: "published" },
      signal,
    );
    const scoringDefinition = scoringDefinitions.items.find(
      (item) => item.currentReleaseRef !== undefined,
    );
    const scoringRulesRelease =
      scoringDefinition?.currentReleaseRef === undefined
        ? null
        : await readKnowledgeRelease(projectId, scoringDefinition.currentReleaseRef, signal);
    const scoringRules =
      scoringRulesRelease !== null &&
      scoringRulesRelease.body.definitionType === "structured-scoring-rule"
        ? scoringRulesRelease.body.members
        : [];
    return { ruleSetRelease, scoringRules, scoringRulesRelease };
  }, []);

  return (
    <AppShell
      activeNav="knowledge"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">评分规则</h1>
            <p className="page-subtitle">结构化评分规则与适用规则集版本（只读）</p>
          </div>
        </header>

        <SectionTabs items={knowledgeTabs} />

        <PageStateView
          state={state}
          title="评分规则"
          emptyMessage="当前工程尚无已发布适用规则集"
          forbiddenHint="当前角色不具备知识库读取权限"
          onRetry={retry}
        >
          {(facts) => (
            <>
              {facts.ruleSetRelease === null ||
              facts.ruleSetRelease.body.definitionType !== "applicable-rule-set" ? (
                <Card title="适用规则集">
                  <div className="krs-empty">当前工程无已发布适用规则集（治理空态）</div>
                </Card>
              ) : (
                <Card
                  title={`适用规则集 ${facts.ruleSetRelease.definitionRef.reference.entityId}`}
                  extra={
                    <>
                      <LifecycleTag status={lifecycleStatusOf(facts.ruleSetRelease)} />
                      <VersionTag>{facts.ruleSetRelease.releaseRef.reference.versionId}</VersionTag>
                    </>
                  }
                  style={{ marginBottom: 16 }}
                >
                  <div className="krs-ruleset-grid">
                    <div className="krs-field">
                      <div className="krs-field-label">生效时间</div>
                      <div className="krs-field-value mono">
                        {facts.ruleSetRelease.effectiveFrom}
                      </div>
                    </div>
                    <div className="krs-field">
                      <div className="krs-field-label">适用性元数据快照</div>
                      <div className="krs-tags">
                        <span className="krs-tag">
                          工法：{facts.ruleSetRelease.body.applicability.constructionMethod}
                        </span>
                        <span className="krs-tag">
                          地层：{facts.ruleSetRelease.body.applicability.stratumCondition}
                        </span>
                        <span className="krs-tag">
                          阶段：{facts.ruleSetRelease.body.applicability.engineeringStage}
                        </span>
                      </div>
                    </div>
                    <div className="krs-field">
                      <div className="krs-field-label">成员规则版本清单（发布时冻结）</div>
                      <div className="krs-member-list">
                        {facts.ruleSetRelease.body.includedMembers.map((member) => (
                          <span
                            key={`${member.ruleId}@${member.ruleVersion}`}
                            className="krs-member"
                          >
                            <span className="mono">{member.ruleId}</span>
                            <VersionTag>{member.ruleVersion}</VersionTag>
                          </span>
                        ))}
                        {facts.ruleSetRelease.body.includedMembers.length === 0 && (
                          <span className="krs-conflict-note">无入选成员</span>
                        )}
                      </div>
                    </div>
                    <div className="krs-field">
                      <div className="krs-field-label">适用性筛除决定</div>
                      <div className="krs-member-list">
                        {facts.ruleSetRelease.body.decisions
                          .filter((decision) => decision.decision !== "included")
                          .map((decision) => (
                            <span
                              key={`${decision.ruleId}@${decision.ruleVersion}`}
                              className="krs-member"
                            >
                              <span className="mono">{decision.ruleId}</span>
                              <span className="krs-conflict-note">
                                {decision.decision} · {decision.reasonCode}
                              </span>
                            </span>
                          ))}
                        {facts.ruleSetRelease.body.decisions.filter(
                          (decision) => decision.decision !== "included",
                        ).length === 0 && <span className="krs-conflict-note">无筛除决定</span>}
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              <Card
                title="结构化评分规则"
                extra={
                  facts.scoringRulesRelease !== null ? (
                    <VersionTag>
                      {facts.scoringRulesRelease.releaseRef.reference.versionId}
                    </VersionTag>
                  ) : undefined
                }
              >
                {facts.scoringRules.length === 0 ? (
                  <div className="krs-empty">当前工程无已发布结构化评分规则</div>
                ) : (
                  <DataTable
                    columns={ruleColumns}
                    rows={facts.scoringRules.map((member) => ({
                      ruleId: member.rule.ruleId,
                      indicatorItem: member.rule.indicatorItem,
                      applicability: member.rule.applicability,
                      reviewStatus: member.rule.reviewStatus,
                      ruleVersion: member.rule.ruleVersion,
                      evidenceReferences: member.evidenceReferences,
                    }))}
                  />
                )}
              </Card>

              {facts.ruleSetRelease !== null && (
                <AssociatedObjects subjectRef={facts.ruleSetRelease.releaseRef} />
              )}
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
