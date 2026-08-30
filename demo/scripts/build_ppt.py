#!/usr/bin/env python3
"""生成 RiskFlow 系统设计汇报优化版 PPT。

做法：复制当前汇报文件，保留第 1–6 页、章节过渡页和结束页，
重建第 7 页以后的系统设计内容，并嵌入 Graphviz / PlantUML 图表。

运行：
    uv run --project="$HOME/.ar" --locked -- python demo/scripts/build_ppt.py
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

# ---------------------------------------------------------------- 路径

REPO_ROOT = Path(__file__).resolve().parents[2]
SCREENSHOT_DIR = REPO_ROOT / "demo" / "screenshots"
DIAGRAM_DIR = REPO_ROOT / "demo" / "diagrams"
ONEDRIVE_DIR = Path.home() / "OneDrive" / "Project" / "变径盾构风险评估"
SOURCE_PPT = ONEDRIVE_DIR / "20260828变径盾构隧站一体化建造风险评估及安_系统设计汇报.pptx"
OUT_PPT = ONEDRIVE_DIR / "20260828变径盾构隧站一体化建造风险评估及安_系统设计汇报_优化版.pptx"

# ---------------------------------------------------------------- 设计常量

FONT = "Microsoft YaHei"
DEEP_BLUE = RGBColor(0x16, 0x3B, 0x63)
ACCENT_BLUE = RGBColor(0x1F, 0x5E, 0x96)
SKY_BLUE = RGBColor(0xE8, 0xF0, 0xF9)
TEAL = RGBColor(0x2F, 0x8F, 0x7A)
TEAL_BG = RGBColor(0xEE, 0xF8, 0xF4)
CARD_BG = RGBColor(0xF4, 0xF7, 0xFB)
GRAY = RGBColor(0x4A, 0x55, 0x68)
LIGHT_GRAY = RGBColor(0x9A, 0xA5, 0xB1)
LINE_GRAY = RGBColor(0xD5, 0xDC, 0xE4)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
ORANGE = RGBColor(0xF2, 0x99, 0x4A)
ORANGE_BG = RGBColor(0xFF, 0xF6, 0xE4)
RED = RGBColor(0xC7, 0x4C, 0x4C)
RED_BG = RGBColor(0xFD, 0xEE, 0xEE)
PURPLE = RGBColor(0x6E, 0x55, 0xA5)
PURPLE_BG = RGBColor(0xF2, 0xEE, 0xFA)

SLIDE_W = 10.0
SLIDE_H = 5.625
MARGIN = 0.42
CONTENT_TOP = 1.43
CONTENT_BOTTOM = 5.08
CONTENT_W = SLIDE_W - 2 * MARGIN

SECTION_PROGRESS = "2.4 各子课题工作进展  ·  子课题一（站隧一体化建造风险智能识别与评估技术）"
SECTION_NEXT = "四、下一步工作计划"

BUILD_ASSETS: dict[str, Path] = {}


# ---------------------------------------------------------------- 基础辅助

def _set_run_font(run, size, bold, color, name=FONT):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = name
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = rPr.makeelement(qn("a:ea"), {})
        rPr.append(ea)
    ea.set("typeface", name)


def add_rect(slide, x, y, w, h, fill=None, line=None, line_w=0.75,
             shape=MSO_SHAPE.RECTANGLE):
    sp = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid()
        sp.fill.fore_color.rgb = fill
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line
        sp.line.width = Pt(line_w)
    sp.shadow.inherit = False
    return sp


def add_text(slide, x, y, w, h, text, size=12, bold=False, color=GRAY,
             align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, line_spacing=1.06,
             wrap=True):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    lines = text.split("\n")
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line_spacing
        run = p.add_run()
        run.text = line
        _set_run_font(run, size, bold, color)
    return tb


def add_shape_text(shape, text, size=12, bold=False, color=WHITE,
                   align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE):
    tf = shape.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.04)
    tf.margin_top = tf.margin_bottom = Inches(0.02)
    for i, line in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        run = p.add_run()
        run.text = line
        _set_run_font(run, size, bold, color)
    return shape


def add_picture_fit(slide, path, x, y, w, border=True):
    """按 16:9 截图原始比例放置图片，返回 (图片高度, picture)。"""
    with Image.open(path) as im:
        iw, ih = im.size
    h = w * ih / iw
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))
    if border:
        pic.line.color.rgb = LINE_GRAY
        pic.line.width = Pt(1)
    return h, pic


def add_picture_contain(slide, path, x, y, w, h, border=False):
    """在指定区域内等比居中放置图片，不裁切。"""
    with Image.open(path) as im:
        iw, ih = im.size
    scale = min(w / iw, h / ih)
    pw, ph = iw * scale, ih * scale
    px, py = x + (w - pw) / 2, y + (h - ph) / 2
    pic = slide.shapes.add_picture(
        str(path), Inches(px), Inches(py), Inches(pw), Inches(ph)
    )
    if border:
        pic.line.color.rgb = LINE_GRAY
        pic.line.width = Pt(1)
    return pic


def render_diagrams(output_dir: Path):
    """使用 Graphviz 与 PlantUML 渲染专业图表。"""
    specs = {
        "architecture": ("system-architecture.dot", "dot"),
        "agent_boundary": ("agent-boundary.puml", "plantuml"),
        "dual_engine": ("dual-engine.dot", "dot"),
        "deployment": ("deployment.puml", "plantuml"),
    }
    for key, (filename, renderer) in specs.items():
        source = DIAGRAM_DIR / filename
        target = output_dir / f"{source.stem}.png"
        if renderer == "dot":
            subprocess.run(
                ["dot", "-Tpng", "-Gdpi=220", str(source), "-o", str(target)],
                check=True,
            )
        else:
            result = subprocess.run(
                ["plantuml", "-charset", "UTF-8", "-tpng", "-pipe"],
                input=source.read_bytes(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
            target.write_bytes(result.stdout)
        with Image.open(target) as im:
            im.verify()
        BUILD_ASSETS[key] = target


def extract_logo(prs, output_dir: Path):
    """复用第 5 页右上角的企业标识，保持与旧版页面一致。"""
    for shape in prs.slides[4].shapes:
        if shape.shape_type == 13:
            target = output_dir / f"header-logo.{shape.image.ext}"
            target.write_bytes(shape.image.blob)
            BUILD_ASSETS["logo"] = target
            return


# ---------------------------------------------------------------- 页面骨架

def new_page(prs, blank_layout, section, title, page_no, notes):
    slide = prs.slides.add_slide(blank_layout)
    # 白底与旧版页眉
    add_rect(slide, 0, 0, SLIDE_W, SLIDE_H, fill=WHITE)
    major_no = "四" if section == SECTION_NEXT else "2"
    major_title = "四 下一步工作计划" if section == SECTION_NEXT else "2 项目研发进展"
    add_text(slide, 0.04, 0.00, 5.4, 0.46, major_title,
             size=24, bold=True, color=DEEP_BLUE)
    add_rect(slide, 0.03, 0.55, 0.23, 0.36, fill=ACCENT_BLUE)
    add_shape_text(slide.shapes[-1], major_no, size=14, bold=True, color=WHITE)
    add_rect(slide, 0.28, 0.55, 7.65, 0.36, fill=ACCENT_BLUE)
    add_text(slide, 0.38, 0.60, 7.42, 0.25, section,
             size=10.5, bold=True, color=WHITE)
    if "logo" in BUILD_ASSETS:
        slide.shapes.add_picture(
            str(BUILD_ASSETS["logo"]), Inches(9.45), Inches(0.09),
            Inches(0.41), Inches(0.33)
        )
    add_text(slide, MARGIN, 0.98, CONTENT_W, 0.38, title,
             size=18, bold=True, color=DEEP_BLUE)
    add_rect(slide, MARGIN, 1.36, CONTENT_W, 0.012, fill=LINE_GRAY)
    # 页脚
    add_rect(slide, MARGIN, 5.15, CONTENT_W, 0.01, fill=LINE_GRAY)
    add_text(slide, MARGIN, 5.20, 7.5, 0.22,
             "变径盾构站隧一体化建造风险智能识别与评估系统（RiskFlow）",
             size=8, color=LIGHT_GRAY)
    add_text(slide, SLIDE_W - MARGIN - 0.6, 5.20, 0.6, 0.22, str(page_no),
             size=8, color=LIGHT_GRAY, align=PP_ALIGN.RIGHT)
    slide.notes_slide.notes_text_frame.text = notes
    return slide


def add_number_badge(slide, x, y, n, d=0.26, fill=ACCENT_BLUE):
    badge = add_rect(slide, x, y, d, d, fill=fill, shape=MSO_SHAPE.OVAL)
    add_shape_text(badge, str(n), size=11, bold=True)
    return badge


# ---------------------------------------------------------------- 新第 1 页：总体思路

def build_page_approach(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "总体思路：机理驱动识别，规则约束评估", 7,
        "变径盾构站隧一体化施工缺少同类型工程先例，风险识别不能只依赖历史清单。"
        "系统以施工工序和风险机理为识别依据，以版本化规则、指标和风险矩阵完成量化评估。"
        "监测更新、预警处置和效果反馈进入同一业务闭环，所有结论保留证据与版本信息。",
    )
    challenges = [
        ("同类型案例不足", "新装备、新工法难以直接套用历史风险清单", ACCENT_BLUE, SKY_BLUE),
        ("规则适用条件复杂", "工法、地层和工程阶段变化会影响规则选用", ORANGE, ORANGE_BG),
        ("人工排查难追溯", "资料分散，识别依据和复核过程不易沉淀", TEAL, TEAL_BG),
    ]
    cw, gap = 2.94, 0.17
    for i, (t, d, color, bg) in enumerate(challenges):
        x = MARGIN + i * (cw + gap)
        add_rect(slide, x, CONTENT_TOP + 0.02, cw, 0.76, fill=bg, line=LINE_GRAY,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_rect(slide, x, CONTENT_TOP + 0.02, 0.07, 0.76, fill=color)
        add_text(slide, x + 0.18, CONTENT_TOP + 0.12, cw - 0.34, 0.24, t,
                 size=11.5, bold=True, color=color)
        add_text(slide, x + 0.18, CONTENT_TOP + 0.39, cw - 0.34, 0.30, d,
                 size=9.5, color=GRAY)

    add_text(slide, MARGIN, 2.33, 4.0, 0.26, "风险管理业务闭环",
             size=11.5, bold=True, color=DEEP_BLUE)
    steps = ["资料接入", "智能识别", "智能评估", "动态预警", "处置反馈"]
    colors = [ACCENT_BLUE, TEAL, ORANGE, RED, PURPLE]
    sw, sh, sy = 1.72, 0.50, 2.65
    for i, s in enumerate(steps):
        x = MARGIN + i * (sw + 0.14)
        chev = add_rect(slide, x, sy, sw, sh, fill=colors[i],
                        shape=MSO_SHAPE.CHEVRON)
        add_shape_text(chev, s, size=11.5, bold=True)
    back = add_rect(slide, MARGIN + 0.65, 3.22, CONTENT_W - 1.3, 0.27,
                    fill=CARD_BG, line=LINE_GRAY, shape=MSO_SHAPE.LEFT_ARROW)
    add_shape_text(back, "反馈复核：形成知识更新或校准建议，审核后发布新版本",
                   size=9.5, color=DEEP_BLUE)

    summaries = [
        ("风险在哪里", "按工序节点检索机理与证据，形成标准化风险记录", ACCENT_BLUE),
        ("风险有多大", "按适用规则计算 P/C 分值，再映射版本化风险矩阵", TEAL),
        ("风险如何处置", "根据触发指标形成预警和处置建议，跟踪实际效果", PURPLE),
    ]
    for i, (title, desc, color) in enumerate(summaries):
        x = MARGIN + i * (cw + gap)
        add_rect(slide, x, 3.70, cw, 1.20, fill=WHITE, line=color, line_w=1.4,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, x + 0.17, 3.84, cw - 0.34, 0.27, title,
                 size=12, bold=True, color=color)
        add_text(slide, x + 0.17, 4.18, cw - 0.34, 0.55, desc,
                 size=10, color=GRAY, line_spacing=1.12)


# ---------------------------------------------------------------- 新第 2 页：总体架构

def build_page_architecture(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "识别与评估一体化系统架构", 8,
        "系统沿数据接入、知识建模、智能推理和应用输出四层组织。识别与评估共享工程对象、"
        "版本信息和证据链，但各自保持独立流程。智能推理负责流程编排和人工复核路由，"
        "评分公式、风险矩阵、阈值判断和业务入库由确定性领域模块执行。",
    )
    add_picture_contain(
        slide, BUILD_ASSETS["architecture"], MARGIN, 1.48, 6.32, 3.47
    )
    callouts = [
        ("共享事实源", "工序、机理、证据和版本信息在各层之间按统一契约传递", ACCENT_BLUE, SKY_BLUE),
        ("确定性边界", "P/C 评分、矩阵映射、阈值判断和业务入库不由大模型决定", TEAL, TEAL_BG),
        ("人工复核", "字段不完整、规则冲突、校准发布等场景显式暂停等待审核", ORANGE, ORANGE_BG),
    ]
    x, w = 6.83, 2.75
    for i, (title, desc, color, bg) in enumerate(callouts):
        y = 1.53 + i * 1.13
        add_rect(slide, x, y, w, 0.98, fill=bg, line=color, line_w=1.2,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, x + 0.15, y + 0.10, w - 0.30, 0.25, title,
                 size=11.5, bold=True, color=color)
        add_text(slide, x + 0.15, y + 0.39, w - 0.30, 0.49, desc,
                 size=9.5, color=GRAY, line_spacing=1.10)


# ---------------------------------------------------------------- 新第 3 页：Agent 原生设计

def build_page_agent_native(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "Agent 参与边界：语义判断、确定性计算与人工决策", 9,
        "Agent 只参与需要语义判断、证据取舍或受限工具行动的环节。字段校验、规则校验、"
        "P/C 评分、风险矩阵映射、阈值判断和业务入库由确定性模块完成。规则冲突、知识发布、"
        "处置采纳和校准生效仍由人决定。",
    )
    add_rect(slide, MARGIN, 1.48, CONTENT_W, 0.34, fill=CARD_BG, line=LINE_GRAY,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(slide, MARGIN + 0.16, 1.56, CONTENT_W - 0.32, 0.20,
             "五类必经 Agent 任务聚焦语义判断；计算、校验、发布和采纳均由受控模块或人工完成。",
             size=9.5, color=DEEP_BLUE, align=PP_ALIGN.CENTER)
    add_picture_contain(
        slide, BUILD_ASSETS["agent_boundary"], MARGIN, 1.88, CONTENT_W, 2.04
    )
    rules = [
        ("固定任务边界", "发起者、工程和输入版本在任务创建时确定", ACCENT_BLUE, SKY_BLUE),
        ("限定工具范围", "按任务类型配置领域工具白名单", TEAL, TEAL_BG),
        ("执行资源预算", "模型、工具、并发和墙钟时间设硬预算", ORANGE, ORANGE_BG),
        ("保留审计证据", "记录输入、工具行动、校验和正式结果，不展示思维链", PURPLE, PURPLE_BG),
    ]
    gap = 0.12
    w = (CONTENT_W - 3 * gap) / 4
    for i, (title, desc, color, bg) in enumerate(rules):
        x = MARGIN + i * (w + gap)
        add_rect(slide, x, 4.05, w, 0.86, fill=bg, line=color, line_w=1.1,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, x + 0.12, 4.14, w - 0.24, 0.22, title,
                 size=10.5, bold=True, color=color, align=PP_ALIGN.CENTER)
        add_text(slide, x + 0.12, 4.39, w - 0.24, 0.39, desc,
                 size=8.8, color=GRAY, align=PP_ALIGN.CENTER, line_spacing=1.05)


# ---------------------------------------------------------------- 新第 4 页：识别与评估双引擎

def build_page_engines(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "识别与评估双引擎：从工程证据到预警处置", 10,
        "风险智能识别按识别专利 S1 至 S6 处理工程资料、构建工序模型和风险机理库，"
        "再通过检索增强与启发式推理形成标准化风险记录。风险智能评估按评估专利 S1 至 S7"
        "完成规则适配、P/C 评分、风险矩阵映射、预警和处置反馈。两条流程通过标准化风险记录衔接。",
    )
    add_picture_contain(
        slide, BUILD_ASSETS["dual_engine"], MARGIN, 1.47, CONTENT_W, 3.02
    )
    points = [
        ("识别依据", "工序模型、风险机理条目和检索证据共同约束推理", ACCENT_BLUE, SKY_BLUE),
        ("评估依据", "适用规则集、指标实际取值、权重和版本化风险矩阵", TEAL, TEAL_BG),
        ("反馈边界", "偏差超限只生成校准建议，审核通过后形成新版本", ORANGE, ORANGE_BG),
    ]
    gap = 0.16
    w = (CONTENT_W - 2 * gap) / 3
    for i, (title, desc, color, bg) in enumerate(points):
        x = MARGIN + i * (w + gap)
        add_rect(slide, x, 4.48, w, 0.48, fill=bg, line=color,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, x + 0.12, 4.57, 0.72, 0.22, title,
                 size=9.8, bold=True, color=color)
        add_text(slide, x + 0.88, 4.56, w - 1.00, 0.28, desc,
                 size=8.6, color=GRAY, line_spacing=1.0)


# ---------------------------------------------------------------- 新第 5 页：技术栈与软件工程

def build_page_engineering(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "技术实现与工程保障", 11,
        "技术实现分为流程编排、模型与检索、应用与领域工具三个部分。流程支持暂停、恢复、"
        "失败重试和人工复核；模型推理受工程上下文与证据约束；现场数据仍通过文件上传、"
        "数据库直连或 API 接入，领域工具接口用于约束 Agent 可执行的操作。工程侧通过规格、"
        "版本、审计和重放四项机制保证结果可核对。",
    )
    stack = [
        ("流程编排", "LangGraph", "统一组织识别和评估流程，支持检查点、重试、暂停与人工复核", ACCENT_BLUE, SKY_BLUE),
        ("模型与检索", "开源模型、LoRA、向量检索与 BM25", "模型用于工程文本抽取和受约束推理；双索引独立打分后融合", TEAL, TEAL_BG),
        ("应用与领域工具", "React、ECharts 与受限工具接口", "界面承载业务闭环；Agent 只能调用按任务授权的领域操作", PURPLE, PURPLE_BG),
    ]
    gap = 0.18
    w = (CONTENT_W - 2 * gap) / 3
    for i, (title, tech, desc, color, bg) in enumerate(stack):
        x = MARGIN + i * (w + gap)
        add_rect(slide, x, 1.53, w, 1.84, fill=bg, line=color, line_w=1.2,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_rect(slide, x, 1.53, w, 0.36, fill=color,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_shape_text(slide.shapes[-1], title, size=12, bold=True)
        add_text(slide, x + 0.16, 2.03, w - 0.32, 0.44, tech,
                 size=11, bold=True, color=DEEP_BLUE, align=PP_ALIGN.CENTER)
        add_text(slide, x + 0.18, 2.56, w - 0.36, 0.62, desc,
                 size=9.5, color=GRAY, align=PP_ALIGN.CENTER, line_spacing=1.10)

    add_text(slide, MARGIN, 3.55, 2.4, 0.25, "工程保障机制",
             size=11.5, bold=True, color=DEEP_BLUE)
    practices = [
        ("规格驱动", "能力变更先形成可核对的规格", ACCENT_BLUE),
        ("配置版本化", "指标、权重、矩阵和阈值不写死", TEAL),
        ("全链路审计", "来源、规则、版本和审核过程可追溯", ORANGE),
        ("结果可重放", "以输入快照和配置版本重现计算结果", PURPLE),
    ]
    gap = 0.12
    w = (CONTENT_W - 3 * gap) / 4
    for i, (title, desc, color) in enumerate(practices):
        x = MARGIN + i * (w + gap)
        add_rect(slide, x, 3.88, w, 0.98, fill=WHITE, line=color, line_w=1.2,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, x + 0.12, 3.99, w - 0.24, 0.24, title,
                 size=10.5, bold=True, color=color, align=PP_ALIGN.CENTER)
        add_text(slide, x + 0.12, 4.30, w - 0.24, 0.40, desc,
                 size=8.8, color=GRAY, align=PP_ALIGN.CENTER, line_spacing=1.05)


# ---------------------------------------------------------------- 新第 6 页：硬件部署

def build_page_deployment(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "项目内网部署建议：数据、模型与业务服务分区", 12,
        "建议将现场数据采集、应用服务、流程编排、模型推理和数据存储部署在项目内网。"
        "工程资料可通过文件上传、数据库直连或 API 接入，监测数据通过内网数据接口接入。"
        "模型规模、GPU 数量、主备与备份策略在实施设计阶段根据数据量和并发需求确定。",
    )
    add_picture_contain(
        slide, BUILD_ASSETS["deployment"], MARGIN, 1.50, CONTENT_W, 2.22
    )
    callouts = [
        ("数据边界", "工程资料和监测数据保留在项目内网，外部通知在结果可靠入库后执行", ACCENT_BLUE, SKY_BLUE),
        ("服务分区", "业务应用、流程编排、模型推理和数据存储各自承担明确职责", TEAL, TEAL_BG),
        ("按需配置", "模型规模、算力、主备和备份方案依据实施条件确定，不在设计页固定型号", ORANGE, ORANGE_BG),
    ]
    gap = 0.16
    w = (CONTENT_W - 2 * gap) / 3
    for i, (title, desc, color, bg) in enumerate(callouts):
        x = MARGIN + i * (w + gap)
        y = 3.90
        add_rect(slide, x, y, w, 0.96, fill=bg, line=color, line_w=1.2,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, x + 0.15, y + 0.10, w - 0.30, 0.23, title,
                 size=11.5, bold=True, color=color)
        add_text(slide, x + 0.15, y + 0.38, w - 0.30, 0.48, desc,
                 size=9.2, color=GRAY, line_spacing=1.08)


# ---------------------------------------------------------------- 新第 7–8 页：系统演示

def _caption(slide, x, y, w, title, lines, color=ACCENT_BLUE):
    add_rect(slide, x, y, w, 0.84, fill=WHITE, line=color, line_w=1.1,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(slide, x + 0.13, y + 0.08, w - 0.26, 0.23, title,
             size=10.5, bold=True, color=color)
    add_text(slide, x + 0.13, y + 0.34, w - 0.26, 0.42, "\n".join(lines),
             size=8.8, color=GRAY, line_spacing=1.02)


def build_page_demo1(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "系统演示（一）：风险态势总览（演示原型）", 13,
        "风险态势总览汇集当前风险数量、预警等级、工序分布、监测趋势和待处置事项。"
        "管理人员可按项目、阶段和风险等级筛选，定位越限趋势后进入风险评估记录、预警信息"
        "或证据追溯页面。该页面用于日常巡检和汇报，不替代具体风险记录的审核。",
    )
    add_picture_contain(
        slide, SCREENSHOT_DIR / "01-risk-overview.png", MARGIN, 1.48, 6.15, 3.47,
        border=True
    )
    items = [
        ("数据入口", "风险评估记录、预警信息和监测摘要按当前版本汇总", ACCENT_BLUE, SKY_BLUE),
        ("重点操作", "筛选项目与工程阶段，查看风险分布、监测趋势和待处置事项", TEAL, TEAL_BG),
        ("业务输出", "定位风险集中工序和越限指标，并进入评估、预警或证据详情", ORANGE, ORANGE_BG),
    ]
    x, w = 6.78, 2.80
    for i, (title, desc, color, bg) in enumerate(items):
        y = 1.51 + i * 1.13
        add_rect(slide, x, y, w, 0.98, fill=bg, line=color, line_w=1.2,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, x + 0.15, y + 0.10, w - 0.30, 0.24, title,
                 size=11.5, bold=True, color=color)
        add_text(slide, x + 0.15, y + 0.39, w - 0.30, 0.48, desc,
                 size=9.3, color=GRAY, line_spacing=1.08)


def build_page_demo2(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "系统演示（二）：智能 Agent 与智能识别（演示原型）", 14,
        "智能 Agent 工作台承接有边界的分析任务，展示任务状态、结论、指标和证据引用。"
        "智能识别中心按工序节点呈现识别步骤，模型输出经过字段与完整性校验后形成标准化风险记录。"
        "低置信度、证据不足或字段不完整的结果进入人工复核。",
    )
    pw, gap = 4.42, 0.16
    add_picture_contain(slide, SCREENSHOT_DIR / "02-agent-workbench.png",
                        MARGIN, 1.48, pw, 2.48, border=True)
    add_picture_contain(slide, SCREENSHOT_DIR / "03-identification-center.png",
                        MARGIN + pw + gap, 1.48, pw, 2.48, border=True)
    _caption(slide, MARGIN, 4.05, pw, "智能 Agent 工作台", [
        "输入：工程问题、关联项目和资料版本",
        "输出：评估结论、P/C 分值、触发指标及证据引用",
    ], ACCENT_BLUE)
    _caption(slide, MARGIN + pw + gap, 4.05, pw, "智能识别中心", [
        "过程：按工序节点展示检索、推理和确定性校验状态",
        "输出：标准化风险记录、综合置信度和人工复核路由",
    ], TEAL)


def build_page_demo3(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "系统演示（三）：风险评估、预警与处置追溯（演示原型）", 15,
        "风险评估页面保存适用性元数据快照、指标评分明细、P/C 分值、风险等级和所用版本。"
        "风险等级超过风险可接受阈值，或监测数值、趋势及联合规则越限时生成预警信息。"
        "处置建议在候选措施集内组合排序，通过触发指标一致性、规范合规性和现场可执行性校验后供人员采纳。",
    )
    pw, gap = 4.42, 0.16
    add_picture_contain(slide, SCREENSHOT_DIR / "04-assessment-warning.png",
                        MARGIN, 1.48, pw, 2.48, border=True)
    add_picture_contain(slide, SCREENSHOT_DIR / "05-risk-response-trace.png",
                        MARGIN + pw + gap, 1.48, pw, 2.48, border=True)
    _caption(slide, MARGIN, 4.05, pw, "风险评估与预警", [
        "计算：指标实际取值形成 P/C 分值，映射当前风险矩阵版本",
        "预警：记录触发类型、触发指标、证据和通知状态",
    ], ORANGE)
    _caption(slide, MARGIN + pw + gap, 4.05, pw, "处置与证据追溯", [
        "处置：候选措施组合经过三项约束校验后提交采纳",
        "追溯：资料段、工序、机理、评估、预警和处置连续关联",
    ], PURPLE)


# ---------------------------------------------------------------- 新第 9 页：阶段成果与验证重点

def build_page_results(prs, layout):
    slide = new_page(
        prs, layout, SECTION_PROGRESS,
        "阶段成果与近期验证重点", 16,
        "当前成果主要分为设计基线和演示原型。设计基线已统一识别与评估的领域术语、字段契约、"
        "流程边界和追溯要求；演示原型覆盖态势总览、智能 Agent、识别、评估、预警处置等主要界面。"
        "下一阶段需要使用甲方资料、指标体系、风险矩阵和脱敏监测样例验证数据转换、检索、评分和闭环联调。",
    )
    states = [
        ("已形成设计基线", ["统一领域术语与字段契约", "对应两项专利的方法步骤", "明确 Agent、确定性计算和人工审核边界"], ACCENT_BLUE, SKY_BLUE),
        ("已完成演示原型", ["风险态势与监测趋势", "智能 Agent 与智能识别", "风险评估、预警处置与证据追溯"], TEAL, TEAL_BG),
        ("进入样例验证", ["多源资料结构化转换", "检索与评分结果核对", "预警处置闭环联调"], ORANGE, ORANGE_BG),
    ]
    gap = 0.18
    w = (CONTENT_W - 2 * gap) / 3
    for i, (title, items, color, bg) in enumerate(states):
        x = MARGIN + i * (w + gap)
        add_rect(slide, x, 1.53, w, 2.05, fill=bg, line=color, line_w=1.2,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_rect(slide, x, 1.53, w, 0.38, fill=color,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_shape_text(slide.shapes[-1], title, size=12, bold=True)
        for j, item in enumerate(items):
            add_number_badge(slide, x + 0.18, 2.10 + j * 0.45, j + 1,
                             d=0.23, fill=color)
            add_text(slide, x + 0.50, 2.09 + j * 0.45, w - 0.68, 0.35, item,
                     size=9.0, color=DEEP_BLUE)

    add_text(slide, MARGIN, 3.78, 2.4, 0.24, "近期验证路径",
             size=11.5, bold=True, color=DEEP_BLUE)
    verifies = [
        ("样例资料到位", ACCENT_BLUE),
        ("结构化与检索核对", TEAL),
        ("P/C 与矩阵结果核对", ORANGE),
        ("预警处置闭环联调", PURPLE),
    ]
    gap = 0.14
    w = (CONTENT_W - 3 * gap) / 4
    for i, (text, color) in enumerate(verifies):
        x = MARGIN + i * (w + gap)
        shape = add_rect(slide, x, 4.15, w, 0.56, fill=color,
                         shape=MSO_SHAPE.CHEVRON)
        add_shape_text(shape, text, size=10.5, bold=True)
    add_text(slide, MARGIN, 4.79, CONTENT_W, 0.22,
             "验证使用甲方提供或审核的配置与脱敏样例；当前演示数据不作为正式评估结果。",
             size=9, color=RED, align=PP_ALIGN.CENTER)


# ---------------------------------------------------------------- 新第 10 页：下一步计划与关键问题

def build_page_next(prs, layout):
    slide = new_page(
        prs, layout, SECTION_NEXT,
        "下一步研究计划与关键条件", 18,
        "下一阶段先固化流程编排的语言版本、检查点持久化和部署形态，再实现多源资料解析、"
        "模型选型与检索验证，最后结合现场监测数据开展系统联调。甲方指标体系、风险矩阵、"
        "量化标准和脱敏监测样例是正式验证的必要输入；合并规则和识别评价指标需与专家复核机制同步确定。",
    )
    plans = [
        ("固化架构基线", "确定语言版本、检查点持久化和部署形态", ACCENT_BLUE),
        ("实现资料解析", "完成文本、表格、图纸标注和监测数据转换", TEAL),
        ("验证模型与检索", "完成模型选型、检索排序和识别结果复核", ORANGE),
        ("开展系统联调", "接入现场数据，验证评估、预警和处置闭环", PURPLE),
    ]
    add_text(slide, MARGIN, 1.50, 2.4, 0.24, "研究工作顺序",
             size=11.5, bold=True, color=DEEP_BLUE)
    gap = 0.12
    w = (CONTENT_W - 3 * gap) / 4
    for i, (title, desc, color) in enumerate(plans):
        x = MARGIN + i * (w + gap)
        shape = add_rect(slide, x, 1.84, w, 1.12, fill=color,
                         shape=MSO_SHAPE.CHEVRON)
        add_text(slide, x + 0.20, 2.00, w - 0.34, 0.25, f"{i + 1}  {title}",
                 size=10.8, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        add_text(slide, x + 0.22, 2.34, w - 0.38, 0.42, desc,
                 size=8.7, color=WHITE, align=PP_ALIGN.CENTER, line_spacing=1.02)

    add_text(slide, MARGIN, 3.22, 3.0, 0.24, "正式验证所需条件",
             size=11.5, bold=True, color=DEEP_BLUE)
    issues = [
        ("甲方业务配置", "风险源清单、指标体系、量化标准和风险矩阵", RED, RED_BG),
        ("脱敏工程样例", "设计资料、专项方案、施工日志和监测数据", ACCENT_BLUE, SKY_BLUE),
        ("合并与入库规则", "多来源风险记录的判重、合并和综合置信度规则", TEAL, TEAL_BG),
        ("识别评价指标", "准确性、完整性、可解释性与可追溯性评价方法", ORANGE, ORANGE_BG),
    ]
    for i, (title, desc, color, bg) in enumerate(issues):
        x = MARGIN + i * (w + gap)
        add_rect(slide, x, 3.57, w, 1.25, fill=bg, line=color, line_w=1.2,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, x + 0.14, 3.70, w - 0.28, 0.25, title,
                 size=10.5, bold=True, color=color, align=PP_ALIGN.CENTER)
        add_text(slide, x + 0.15, 4.04, w - 0.30, 0.55, desc,
                 size=8.8, color=GRAY, align=PP_ALIGN.CENTER, line_spacing=1.05)


# ---------------------------------------------------------------- 合并与重排

def reorder_and_trim(prs, n_old=18, n_new=11):
    """保留旧 1–6、章节过渡页和结束页，替换其余系统设计页。"""
    sldIdLst = prs.slides._sldIdLst
    ids = list(sldIdLst)
    assert len(ids) == n_old + n_new, f"期望 {n_old + n_new} 页，实际 {len(ids)} 页"
    old, new = ids[:n_old], ids[n_old:]
    obsolete = old[6:15] + [old[16]]
    for el in obsolete:
        prs.part.drop_rel(el.get(qn("r:id")))
        sldIdLst.remove(el)
    order = old[0:6] + new[0:10] + [old[15], new[10], old[17]]
    for el in order:
        sldIdLst.remove(el)
    for el in order:
        sldIdLst.append(el)


def main():
    assert SOURCE_PPT.exists(), f"找不到当前汇报文件：{SOURCE_PPT}"
    shutil.copy2(SOURCE_PPT, OUT_PPT)
    BUILD_ASSETS.clear()
    with tempfile.TemporaryDirectory(prefix="riskflow-ppt-") as temp_dir:
        temp_path = Path(temp_dir)
        prs = Presentation(str(OUT_PPT))
        blank_layout = prs.slide_layouts[2]
        extract_logo(prs, temp_path)
        render_diagrams(temp_path)

        builders = [
            build_page_approach, build_page_architecture, build_page_agent_native,
            build_page_engines, build_page_engineering, build_page_deployment,
            build_page_demo1, build_page_demo2, build_page_demo3,
            build_page_results, build_page_next,
        ]
        for build in builders:
            build(prs, blank_layout)

        reorder_and_trim(prs)
        prs.save(str(OUT_PPT))
    print(f"已生成：{OUT_PPT}（{len(Presentation(str(OUT_PPT)).slides)} 页）")


if __name__ == "__main__":
    main()
