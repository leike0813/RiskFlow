<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock

## canvas
- viewBox: 0 0 1280 720
- format: PPT 16:9

## communication
- primary_language: zh-CN
- audience: 中国铁建项目管理层、课题评审专家，以及甲方业务与技术负责人
- objective: 汇报 RiskFlow 系统设计与演示原型进展，使听众认可机理驱动识别、确定性评估和人工审核边界，并确认正式验证所需输入与工作顺序。
- core_message: RiskFlow 已形成贯通风险识别、评估、预警、处置和追溯的设计基线与演示原型，下一阶段应以甲方审核配置和脱敏工程样例进入可核对、可重放的正式验证。

## mode
- mode: custom
- mode_references: briefing, instructional
- mode_behavior: 以 briefing 为主，按用户标注合并重复架构页后保持 18 页顺序；每页先呈现结论层级，再用一至两个证据区承载原文。一体化架构、Agent 边界、双引擎和内网部署四页使用 instructional 的分步阅读逻辑。

## visual_style
- visual_style: custom
- visual_style_references: swiss-minimal, soft-rounded
- visual_style_behavior: swiss-minimal 负责精确栅格、留白和清晰的标题层级；soft-rounded 仅用于关键结论卡、状态标签与截图放大窗。保持白底和深蓝标题，青绿色只标记已形成能力，橙色只标记风险、待确认条件或下一步。

## colors
- background: #FFFFFF
- secondary_bg: #F4F7FA
- primary: #163B63
- accent: #2F8F7A
- secondary_accent: #F2994A
- body_text: #1C2733
- surface: #FFFFFF
- grid: #D5DCE4

## typography
- font_family: Microsoft YaHei, Arial, sans-serif
- title_family: Microsoft YaHei, Arial, sans-serif
- body_family: Microsoft YaHei, Arial, sans-serif
- body: 14
- title: 25
- subtitle: 19
- annotation: 11

## header_and_pagination
- content_header: Microsoft YaHei | left 13/700 | right 11/400 | baseline y=47 | divider y=70
- numbering: two-digit Arabic section hierarchy and page numbers

## icons
- library: tabler-outline
- inventory: tabler-outline/layers-linked, tabler-outline/database-search, tabler-outline/shield-check, tabler-outline/file-text, tabler-outline/search, tabler-outline/network, tabler-outline/alert-circle, tabler-outline/user-check, tabler-outline/device-desktop-analytics, tabler-outline/server, tabler-outline/chart-bar, tabler-outline/checklist, tabler-outline/map-route, tabler-outline/robot, tabler-outline/brain, tabler-outline/timeline
- stroke_width: 2

## images
- logo: images/image5.png | source=user | pattern=小型标识置于封面和结束页安全区，与标题主视觉分离 | crop=no-crop
- p12-overview: images/image13.png | source=user | pattern=保留完整总览，右侧只呈现三项业务结论，不再重复局部缩略图 | crop=no-crop
- p13-agent: images/image14.png | source=user | pattern=与 image15.png 并列为双证据面板，保留完整界面且不叠加局部缩略图 | crop=no-crop
- p13-recognition: images/image15.png | source=user | pattern=与 image14.png 并列为双证据面板，保留完整界面且不叠加局部缩略图 | crop=no-crop
- p14-assessment: images/image16.png | source=user | pattern=与 image17.png 并列，保留完整界面且不叠加局部缩略图 | crop=no-crop
- p14-response: images/image17.png | source=user | pattern=与 image16.png 并列，保留完整界面且不叠加局部缩略图 | crop=no-crop

## page_rhythm
- P01: anchor
- P02: anchor
- P03: breathing
- P04: breathing
- P05: dense
- P06: dense
- P07: anchor
- P08: anchor
- P09: anchor
- P10: dense
- P11: anchor
- P12: anchor
- P13: dense
- P14: dense
- P15: dense
- P16: breathing
- P17: dense
- P18: breathing

## pptx_structure
- mode: flat

## forbidden
- `mask`, `<style>`, `class`, external CSS, `<foreignObject>`, `textPath`, `@font-face`, `<animate*>`, `<set>`, `<script>` / event attributes, `<iframe>`
- HTML named entities in text; write typography as raw Unicode and escape XML reserved characters
