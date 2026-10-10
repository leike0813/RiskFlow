"""合成材料包 sources 与多格式投影的生成/自检工具（IP-01）。

scenarios.json 是内容唯一事实源；本脚本只做三件事：

1. --write-sources：按显式合成表格写出材料包 JSON（一次性可复现）。
2. 默认：把 scenarios.json 投影为 DOCX / 文本 PDF / 扫描 PDF / PNG / JPEG /
   XLSX / CSV / Markdown 工程资料。
3. --check：读回全部文件并断言内容与数量，同时调用生产 Schema（Node 导入
   packages/*/dist）校验配置、规则、知识与监测/反馈载荷。

候选预期由本脚本内的显式合成量化区间手工算式生成，不调用任何被测评估函数。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PACK_DIR = REPO_ROOT / "references" / "acceptance" / "synthetic-v1"

SCHEMA_VERSION = "1"
PACK_ID = "riskflow-synthetic-v1"
PACK_VERSION = "1"
LABEL = "合成样本，待甲方复核"
LABEL_STATUS = "candidate"

PROJECT_ID = "synthetic-station-tunnel-project"
PROJECT_NAME = "合成·岚江站站隧一体化工程"
PROJECT_REVISION = {"entityId": "project-revision-synthetic-v1", "versionId": "1"}
CONFIGURATION_SET = {"entityId": "configuration-set-synthetic-v1", "versionId": "1"}
SPATIAL_SCOPE = {"entityId": "spatial-scope-synthetic-v1", "versionId": "1"}

PROCESS_NODES = ["扩径准备", "变径空间扩挖", "刀盘扩径", "盾体扩径", "缩径转换"]
MONITORING_INDICATORS = [
    "地表沉降",
    "支护结构变形",
    "地下水位",
    "泥水压力",
    "注浆压力",
    "盾构姿态参数",
]
MECHANISMS = [
    ("掌子面稳定性失效", "掌子面失稳与塌方", "开挖面控制压力低于自稳能力时土体抗剪不足，局部塌方并伴随地表塌陷"),
    ("支护结构失效", "初支侵限与支护失效", "扩挖段支护时机与刚度不匹配，管片拼装偏差累积后侵限"),
    ("渗流突涌", "渗流涌砂涌泥", "承压水沿盾尾密封或开挖面薄弱带突破，携砂涌入舱内"),
    ("过挖与地表沉降", "过挖与地表沉降超标", "扩挖量超出设计控制值，地表累计沉降与变化速率同步增大"),
    ("施工装备故障", "施工装备故障", "变径驱动或制动回路异常，装备在坡道段失去动力或制停能力"),
    ("装配连接失效", "装配连接失效", "狭小空间内拼装构件错位、连接件未紧固，接缝承载能力不足"),
]

STRATA = ["完整岩体", "中硬岩", "粉质黏土", "上软下硬复合地层", "富水中砂层", "岩溶发育灰岩"]
STRATUM_SCORE = {
    "完整岩体": 1.0,
    "中硬岩": 2.0,
    "粉质黏土": 3.0,
    "上软下硬复合地层": 3.5,
    "富水中砂层": 4.0,
    "岩溶发育灰岩": 4.5,
}

# 显式合成分值区间（P/C 计算的唯一依据，非规范阈值）
PRESSURE_SCORE = [
    ((None, 80.0), 1.0),
    ((80.0, 120.0), 2.0),
    ((120.0, 160.0), 4.0),
    ((160.0, None), 5.0),
]
SETTLEMENT_SCORE = [
    ((None, 5.0), 1.0),
    ((5.0, 10.0), 2.0),
    ((10.0, 20.0), 4.0),
    ((20.0, 30.0), 6.0),
    ((30.0, None), 8.0),
]

SPLITS = {
    "development": {
        "sourceFamily": "development-family-v1",
        "templateFamily": "dev-templates-v1",
        "sourceVersion": "synthetic-source-development-v1",
        "prefix": "SYN-DEV",
        "perVariant": 1,
        "date": "2026-03-02",
        "site": "DK12+300 工点",
        "shift": "白班",
        "kind": "施工日志",
        "pressure": [78.0, 92.0, 126.0, 158.0, 172.0, 186.0],
        "settlement": [7.1, 11.4, 16.2, 21.5, 27.3, 31.8],
        "pressureNormal": [58.0, 66.0, 71.0, 76.0, 63.0, 69.0],
        "settlementNormal": [1.6, 2.3, 2.9, 3.4, 4.1, 4.6],
    },
    "trial-run": {
        "sourceFamily": "trial-run-family-v1",
        "templateFamily": "trial-templates-v1",
        "sourceVersion": "synthetic-source-trial-run-v1",
        "prefix": "SYN-TRIAL",
        "perVariant": 5,
        "date": "2026-04-18",
        "site": "DK12+480 工点",
        "shift": "夜班",
        "kind": "巡检与交班记录",
        "pressure": [84.0, 104.0, 132.0, 171.0, 194.0],
        "settlement": [6.2, 11.8, 17.4, 25.1, 33.6],
        "pressureNormal": [54.0, 62.0, 70.0, 73.0, 79.0],
        "settlementNormal": [1.1, 1.9, 2.7, 3.5, 4.3],
    },
}

INDICATOR_STRATUM = "indicator-possibility-stratum"
INDICATOR_EXCAVATION = "indicator-possibility-excavation"
INDICATOR_SETTLEMENT = "indicator-consequence-settlement"

MONITORING_PARAMETERS = {
    "地表沉降": ("ground-settlement", "mm"),
    "支护结构变形": ("lining-deformation", "mm"),
    "地下水位": ("groundwater-level", "m"),
    "泥水压力": ("slurry-chamber-pressure", "kPa"),
    "注浆压力": ("grouting-pressure", "kPa"),
    "盾构姿态参数": ("shield-attitude-frequency", "deg"),
}

# 六类监测各自独立的合成实测序列（不做跨指标折算）
INDICATOR_SERIES = {
    "地表沉降": {
        "unit": "mm",
        "devPositive": [6.4],
        "devNegative": [1.8],
        "trialPositive": [4.6, 12.7, 18.3, 26.4, 34.2],
        "trialNegative": [0.8, 1.6, 2.4, 3.1, 3.9],
    },
    "支护结构变形": {
        "unit": "mm",
        "devPositive": [9.2],
        "devNegative": [2.2],
        "trialPositive": [5.4, 10.8, 14.1, 19.6, 23.8],
        "trialNegative": [1.1, 2.4, 3.6, 4.9, 6.2],
    },
    "地下水位": {
        "unit": "m",
        "devPositive": [-0.42],
        "devNegative": [0.03],
        "trialPositive": [-0.28, -0.66, -1.05, -1.62, -2.15],
        "trialNegative": [0.06, 0.04, 0.02, 0.05, 0.01],
    },
    "泥水压力": {
        "unit": "kPa",
        "devPositive": [392.0],
        "devNegative": [214.0],
        "trialPositive": [352.0, 386.0, 401.0, 418.0, 436.0],
        "trialNegative": [188.0, 203.0, 219.0, 236.0, 252.0],
    },
    "注浆压力": {
        "unit": "kPa",
        "devPositive": [486.0],
        "devNegative": [196.0],
        "trialPositive": [441.0, 463.0, 478.0, 505.0, 522.0],
        "trialNegative": [172.0, 189.0, 207.0, 224.0, 238.0],
    },
    "盾构姿态参数": {
        "unit": "deg",
        "devPositive": [0.062],
        "devNegative": [0.035],
        "trialPositive": [0.048, 0.071, 0.083, 0.096, 0.112],
        "trialNegative": [0.035, 0.042, 0.051, 0.058, 0.066],
    },
}

# 六类机理的可观察原始现象（只写可量测/可观察内容，不写归类结论）
MECHANISM_OBSERVATIONS = [
    "开挖面顶部掉块，出土含水率升高，出土量与推进量偏差扩大",
    "管片拼装错台增大，扩挖段喷层出现纵向裂缝",
    "刀盘前方涌水量增大，出渣泥浆比重升高，舱内水位上升",
    "地表监测点持续下沉，测量棱线断裂后重新布设",
    "变径推进中驱动电流波动，坡道段设备溜车后重新定位",
    "狭小空间内拼装构件错位，连接螺栓复紧扭矩低于记录值",
]

MECHANISM_NORMAL_OBSERVATIONS = [
    "开挖面无掉块，出土含水率与出土量平稳",
    "管片拼装错台在允许范围内，喷层未见裂缝",
    "涌水量与出渣泥浆比重平稳，舱内水位无上升",
    "地表沉降点在连续三个观测周期内无累积下沉",
    "驱动电流平稳，坡道段设备未出现失动力",
    "拼装构件对位偏差未扩大，连接螺栓复紧扭矩达标",
]

TRIAL_TEMPLATES = [
    "巡检单 {index}：{site} {process} 巡检发现{observation}；当班量测 {indicator} {value}{unit}。",
    "交班记录 {index}：{site} {process} 交接时复核{observation}；地表沉降累计 {settlement} mm，{indicator} 读数 {value}{unit}。",
    "异常调查初判 {index}：{site} {process} 现场{observation}；{indicator} 实测 {value}{unit}，地层 {stratum}。",
]
# 显式合成监测预警阈值（单位与边界全部写明；不引用规范控制值）
WARNING_THRESHOLDS = [
    {
        "thresholdId": "threshold-ground-settlement-value",
        "monitoringIndicator": "地表沉降",
        "parameterCode": "ground-settlement",
        "metric": "value",
        "unit": "mm",
        "comparison": {"operator": "gte", "boundary": "5"},
        "warningLevelId": "level-3",
    },
    {
        "thresholdId": "threshold-groundwater-level-value",
        "monitoringIndicator": "地下水位",
        "parameterCode": "groundwater-level",
        "metric": "value",
        "unit": "m",
        "comparison": {"operator": "lt", "boundary": "0"},
        "warningLevelId": "level-3",
    },
    {
        "thresholdId": "threshold-grouting-pressure-value",
        "monitoringIndicator": "注浆压力",
        "parameterCode": "grouting-pressure",
        "metric": "value",
        "unit": "kPa",
        "comparison": {"operator": "gt", "boundary": "450"},
        "warningLevelId": "level-3",
    },
    {
        "thresholdId": "threshold-lining-deformation-value",
        "monitoringIndicator": "支护结构变形",
        "parameterCode": "lining-deformation",
        "metric": "value",
        "unit": "mm",
        "comparison": {"operator": "gte", "boundary": "8"},
        "warningLevelId": "level-3",
    },
    {
        "thresholdId": "threshold-settlement-slope",
        "monitoringIndicator": "地表沉降",
        "parameterCode": "ground-settlement",
        "metric": "short-term-slope",
        "unit": "mm/s",
        "comparison": {"operator": "gte", "boundary": "0.5"},
        "warningLevelId": "level-4",
    },
    {
        "thresholdId": "threshold-shield-attitude-value",
        "monitoringIndicator": "盾构姿态参数",
        "parameterCode": "shield-attitude-frequency",
        "metric": "value",
        "unit": "deg",
        "comparison": {"operator": "outside", "lower": "0.02", "upper": "0.08"},
        "warningLevelId": "level-3",
    },
    {
        "thresholdId": "threshold-shield-attitude-frequency",
        "monitoringIndicator": "盾构姿态参数",
        "parameterCode": "shield-attitude-frequency",
        "metric": "dominant-frequency",
        "unit": "Hz",
        "comparison": {"operator": "outside", "lower": "1", "upper": "80"},
        "warningLevelId": "level-2",
    },
    {
        "thresholdId": "threshold-slurry-pressure-value",
        "monitoringIndicator": "泥水压力",
        "parameterCode": "slurry-chamber-pressure",
        "metric": "value",
        "unit": "kPa",
        "comparison": {"operator": "gt", "boundary": "380"},
        "warningLevelId": "level-3",
    },
]

VALUE_THRESHOLD_BY_INDICATOR = {
    "地表沉降": "threshold-ground-settlement-value",
    "地下水位": "threshold-groundwater-level-value",
    "注浆压力": "threshold-grouting-pressure-value",
    "支护结构变形": "threshold-lining-deformation-value",
    "盾构姿态参数": "threshold-shield-attitude-value",
    "泥水压力": "threshold-slurry-pressure-value",
}


def half_away_from_zero(value: float, scale: int) -> float:
    factor = 10**scale
    scaled = value * factor
    rounded = int(scaled + 0.5) if scaled >= 0 else -int(-scaled + 0.5)
    return rounded / factor


def band_score(value: float, table) -> float:
    for (lower, upper), score in table:
        if (lower is None or value >= lower) and (upper is None or value < upper):
            return score
    raise ValueError(f"value outside synthetic interval table: {value}")


def likelihood_score(stratum: str, pressure: float) -> float:
    weighted = STRATUM_SCORE[stratum] * 4000 / 10000 + band_score(pressure, PRESSURE_SCORE) * 6000 / 10000
    return half_away_from_zero(weighted, 2)


def consequence_score(settlement: float) -> float:
    return band_score(settlement, SETTLEMENT_SCORE)


def risk_level(likelihood: float, consequence: float) -> str:
    p_band = "p-band-1" if likelihood < 1 else ("p-band-2" if likelihood < 2 else "p-band-3")
    c_band = "c-band-1" if consequence < 10 else "c-band-2"
    cells = {
        ("p-band-1", "c-band-1"): "level-1",
        ("p-band-1", "c-band-2"): "level-2",
        ("p-band-2", "c-band-1"): "level-2",
        ("p-band-2", "c-band-2"): "level-3",
        ("p-band-3", "c-band-1"): "level-3",
        ("p-band-3", "c-band-2"): "level-4",
    }
    return cells[(p_band, c_band)]


def threshold_breached(indicator: str, value: float) -> bool:
    threshold_id = VALUE_THRESHOLD_BY_INDICATOR[indicator]
    comparison = next(t for t in WARNING_THRESHOLDS if t["thresholdId"] == threshold_id)["comparison"]
    operator = comparison["operator"]
    if operator == "gte":
        return value >= float(comparison["boundary"])
    if operator == "gt":
        return value > float(comparison["boundary"])
    if operator == "lt":
        return value < float(comparison["boundary"])
    if operator == "lte":
        return value <= float(comparison["boundary"])
    return not (float(comparison["lower"]) <= value <= float(comparison["upper"]))


def build_cases() -> list[dict]:
    """12 开发例 + 60 试运行例；两个集合使用独立措辞、参数与工点。"""
    cases: list[dict] = []
    counter = 0
    for split_name, split in SPLITS.items():
        is_trial = split_name == "trial-run"
        for mech_index, (mechanism, event, _phenomenon) in enumerate(MECHANISMS):
            for variant in range(split["perVariant"]):
                for polarity in ("positive", "negative"):
                    index = variant if polarity == "positive" else variant + split["perVariant"]
                    counter += 1
                    allowed = MECHANISM_NODES[mechanism]
                    offset = variant + (split["perVariant"] if polarity == "negative" else 0)
                    process = allowed[(mech_index + offset) % len(allowed)].split("-", 2)[2]
                    indicator = MONITORING_INDICATORS[(mech_index + index) % len(MONITORING_INDICATORS)]
                    series = INDICATOR_SERIES[indicator]
                    if polarity == "positive":
                        stratum = STRATA[(mech_index + variant + (1 if is_trial else 0)) % len(STRATA)]
                        pressure = split["pressure"][mech_index if not is_trial else variant]
                        settlement = split["settlement"][mech_index if not is_trial else variant]
                        value = (series["trialPositive"] if is_trial else series["devPositive"])[variant]
                        observation = MECHANISM_OBSERVATIONS[mech_index]
                    else:
                        stratum = STRATA[(mech_index + variant) % 2]
                        pressure = split["pressureNormal"][mech_index if not is_trial else variant]
                        settlement = split["settlementNormal"][mech_index if not is_trial else variant]
                        value = (series["trialNegative"] if is_trial else series["devNegative"])[variant]
                        observation = MECHANISM_NORMAL_OBSERVATIONS[mech_index]
                    settlement_value = INDICATOR_SERIES["地表沉降"][
                        "trialPositive" if is_trial else "devPositive"
                    ][variant] if polarity == "positive" else INDICATOR_SERIES["地表沉降"][
                        "trialNegative" if is_trial else "devNegative"
                    ][variant]
                    unit = series["unit"]
                    if is_trial:
                        description = TRIAL_TEMPLATES[(mech_index + variant) % len(TRIAL_TEMPLATES)].format(
                            index=f"{index + 1:02d}",
                            site=split["site"],
                            process=process,
                            observation=observation,
                            indicator=indicator,
                            value=value,
                            unit=unit,
                            settlement=settlement_value,
                            stratum=stratum,
                        )
                    else:
                        description = (
                            f"{split['kind']} {index + 1:02d}（{split['date']} {split['shift']}）："
                            f"{split['site']} {process} 段现场{observation}；"
                            f"当班记录地层{stratum}、开挖面控制压力 {pressure} kPa、"
                            f"地表沉降累计 {settlement_value} mm、{indicator}读数 {value}{unit}。"
                        )
                    series_ids = [f"{split['prefix']}-MS-ground-settlement"]
                    if indicator != "地表沉降":
                        series_ids.append(f"{split['prefix']}-MS-{MONITORING_PARAMETERS[indicator][0]}")
                    cases.append(
                        {
                            "caseId": f"{split['prefix']}-{counter:03d}",
                            "split": split_name,
                            "sourceFamily": split["sourceFamily"],
                            "templateFamily": split["templateFamily"],
                            "processNode": process,
                            "applicability": {
                                "constructionMethod": "原位变径盾构",
                                "stratumCondition": stratum,
                                "engineeringStage": process,
                            },
                            "monitoringIndicator": indicator,
                            "inputs": {
                                "documentRefs": [
                                    f"{split['prefix']}-DOC-LOG-{process}",
                                    f"{split['prefix']}-DOC-GEOLOGY",
                                    f"{split['prefix']}-DOC-LEDGER",
                                ],
                                "monitoringSeriesIds": series_ids,
                                "sourceSegmentIds": [
                                    f"{split['prefix']}-SEG-{counter:03d}-LOG",
                                    f"{split['prefix']}-SEG-{counter:03d}-GEO",
                                    f"{split['prefix']}-SEG-{counter:03d}-LEDGER",
                                ],
                                "observedValues": {
                                    "stratumGrade": stratum,
                                    "facePressureKpa": pressure,
                                    "groundSettlementMm": settlement_value,
                                    "scenarioMonitoringValue": value,
                                },
                                "inputDescription": description,
                            },
                            "polarity": polarity,
                            "riskEvent": event,
                            "mechanismType": mechanism,
                            "settlement": settlement,
                        }
                    )
    return cases


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def versioned(kind: str, entity_id: str, version_id: str = "1") -> dict:
    return {"kind": kind, "reference": {"entityId": entity_id, "versionId": version_id}}


def conditions(*pairs: tuple[str, list[str]]) -> list[dict]:
    return sorted(
        [{"dimension": dimension, "values": sorted(values)} for dimension, values in pairs],
        key=lambda item: item["dimension"],
    )


def configuration_document(definition_type: str, content: dict) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "definitionType": definition_type,
        "projectRevisionRef": versioned("project-revision", PROJECT_REVISION["entityId"], PROJECT_REVISION["versionId"]),
        "configurationSetRef": CONFIGURATION_SET,
        "content": content,
    }


def build_configurations() -> list[tuple[str, dict]]:
    quantization = {"entityId": "quantization-interval-synthetic-v1", "versionId": "1"}
    matrix_ref = {"entityId": "risk-matrix-synthetic-v1", "versionId": "1"}

    indicator_system = configuration_document(
        "indicator-system",
        {
            "indicators": [
                {
                    "indicatorId": INDICATOR_SETTLEMENT,
                    "indicatorType": "后果严重性评估指标",
                    "group": "监测量测与周边环境",
                    "valueKind": "numeric",
                    "applicabilityConditions": conditions(("施工工法数据", ["原位变径盾构"])),
                    "quantizationIntervalRef": quantization,
                    "canonicalUnit": "mm",
                },
                {
                    "indicatorId": INDICATOR_EXCAVATION,
                    "indicatorType": "发生可能性评估指标",
                    "group": "开挖与支护参数",
                    "valueKind": "numeric",
                    "applicabilityConditions": conditions(("施工工法数据", ["原位变径盾构"])),
                    "quantizationIntervalRef": quantization,
                    "canonicalUnit": "kPa",
                },
                {
                    "indicatorId": INDICATOR_STRATUM,
                    "indicatorType": "发生可能性评估指标",
                    "group": "地质与围岩条件",
                    "valueKind": "ordinal",
                    "applicabilityConditions": conditions(("地层条件数据", STRATA)),
                    "quantizationIntervalRef": quantization,
                },
            ]
        },
    )

    field_mapping = configuration_document(
        "indicator-field-mapping",
        {
            "mappings": [
                {
                    "mappingId": "mapping-face-pressure",
                    "targetIndicatorId": INDICATOR_EXCAVATION,
                    "origin": {
                        "kind": "source-field",
                        "documentType": "construction-log",
                        "fieldPath": ["support", "facePressureKpa"],
                    },
                    "sourceUnit": "kPa",
                    "targetUnit": "kPa",
                    "conversion": {"kind": "identity"},
                },
                {
                    "mappingId": "mapping-settlement-value",
                    "targetIndicatorId": INDICATOR_SETTLEMENT,
                    "origin": {
                        "kind": "monitoring-value",
                        "monitoringIndicator": "地表沉降",
                        "parameterCode": "ground-settlement",
                        "metric": "value",
                    },
                    "sourceUnit": "mm",
                    "targetUnit": "mm",
                    "conversion": {"kind": "identity"},
                },
                {
                    "mappingId": "mapping-stratum-grade",
                    "targetIndicatorId": INDICATOR_STRATUM,
                    "origin": {
                        "kind": "source-field",
                        "documentType": "geology-report",
                        "fieldPath": ["strata", "layer", "grade"],
                    },
                    "sourceUnit": "1",
                    "targetUnit": "1",
                    "conversion": {"kind": "identity"},
                },
            ]
        },
    )

    weight_set = configuration_document(
        "weight-set",
        {
            "weightSetId": "weight-set-synthetic-v1",
            "weightSetVersion": "1",
            "sourceRef": {"entityId": "weight-source-synthetic-v1", "versionId": "1"},
            "possibilityWeights": [
                {"indicatorId": INDICATOR_EXCAVATION, "basisPoints": 6000},
                {"indicatorId": INDICATOR_STRATUM, "basisPoints": 4000},
            ],
            "consequenceWeights": [{"indicatorId": INDICATOR_SETTLEMENT, "basisPoints": 10000}],
        },
    )

    scoring_strategy = configuration_document(
        "scoring-strategy",
        {
            "possibility": {
                "kind": "weighted-average",
                "weightSetRef": {"entityId": "weight-set-synthetic-v1", "versionId": "1"},
                "rounding": {"mode": "half-away-from-zero", "decimalScale": 2},
            },
            "consequence": {"kind": "maximum"},
        },
    )

    risk_matrix = configuration_document(
        "risk-matrix",
        {
            "matrixId": "risk-matrix-synthetic-v1",
            "matrixVersion": "1",
            "possibilityAxis": {
                "bands": [
                    {"bandId": "p-band-1", "lower": "0", "upper": "1"},
                    {"bandId": "p-band-2", "lower": "1", "upper": "2"},
                    {"bandId": "p-band-3", "lower": "2", "upper": "5"},
                ]
            },
            "consequenceAxis": {
                "bands": [
                    {"bandId": "c-band-1", "lower": "0", "upper": "10"},
                    {"bandId": "c-band-2", "lower": "10", "upper": "100"},
                ]
            },
            "riskLevels": [
                {"levelId": "level-1", "ordinal": 1},
                {"levelId": "level-2", "ordinal": 2},
                {"levelId": "level-3", "ordinal": 3},
                {"levelId": "level-4", "ordinal": 4},
            ],
            "cells": [
                {"possibilityBandId": "p-band-1", "consequenceBandId": "c-band-1", "riskLevelId": "level-1"},
                {"possibilityBandId": "p-band-1", "consequenceBandId": "c-band-2", "riskLevelId": "level-2"},
                {"possibilityBandId": "p-band-2", "consequenceBandId": "c-band-1", "riskLevelId": "level-2"},
                {"possibilityBandId": "p-band-2", "consequenceBandId": "c-band-2", "riskLevelId": "level-3"},
                {"possibilityBandId": "p-band-3", "consequenceBandId": "c-band-1", "riskLevelId": "level-3"},
                {"possibilityBandId": "p-band-3", "consequenceBandId": "c-band-2", "riskLevelId": "level-4"},
            ],
        },
    )

    acceptance_threshold = configuration_document(
        "risk-acceptance-threshold",
        {
            "riskMatrixRef": matrix_ref,
            "thresholds": [
                {
                    "thresholdId": "acceptance-default",
                    "applicabilityConditions": conditions(("施工工法数据", ["原位变径盾构"])),
                    "maximumAcceptedLevelId": "level-2",
                },
                {
                    "thresholdId": "acceptance-expansion-stage",
                    "applicabilityConditions": conditions(("工程阶段数据", ["刀盘扩径", "盾体扩径", "缩径转换"])),
                    "maximumAcceptedLevelId": "level-3",
                },
            ],
        },
    )

    monitoring_threshold = configuration_document(
        "monitoring-warning-threshold",
        {"riskMatrixRef": matrix_ref, "thresholds": sorted(WARNING_THRESHOLDS, key=lambda item: item["thresholdId"])},
    )

    joint_policy = configuration_document(
        "joint-trigger-policy",
        {
            "rules": [
                {
                    "ruleId": "joint-face-emergency",
                    "applicabilityConditions": conditions(("工程阶段数据", ["变径空间扩挖", "刀盘扩径"])),
                    "operator": "all-of",
                    "monitoringThresholdIds": ["threshold-groundwater-level-value", "threshold-slurry-pressure-value"],
                },
                {
                    "ruleId": "joint-groundwater-settlement",
                    "applicabilityConditions": conditions(("工程阶段数据", PROCESS_NODES)),
                    "operator": "any-of",
                    "monitoringThresholdIds": ["threshold-ground-settlement-value", "threshold-groundwater-level-value"],
                },
                {
                    "ruleId": "joint-pressure-pair",
                    "applicabilityConditions": conditions(("工程阶段数据", ["刀盘扩径", "盾体扩径"])),
                    "operator": "at-least",
                    "count": 2,
                    "monitoringThresholdIds": ["threshold-grouting-pressure-value", "threshold-slurry-pressure-value"],
                },
                {
                    "ruleId": "joint-support-attitude",
                    "applicabilityConditions": conditions(("工程阶段数据", ["盾体扩径", "缩径转换"])),
                    "operator": "all-of",
                    "monitoringThresholdIds": ["threshold-lining-deformation-value", "threshold-shield-attitude-value"],
                },
            ]
        },
    )

    measures = []
    for index, (mechanism, _event, _phenomenon) in enumerate(MECHANISMS, start=1):
        measures.append(
            {
                "measureId": f"measure-{index:02d}",
                "riskEventCategory": mechanism,
                "applicabilityConditions": conditions(
                    ("工程阶段数据", [PROCESS_NODES[(index - 1) % len(PROCESS_NODES)]]),
                    ("施工工法数据", ["原位变径盾构"]),
                ),
                "triggerTypes": ["多指标联合规则命中", "监测指标越限"],
                "steps": [
                    {"stepOrdinal": 1, "instruction": "按合成处置流程第一步复核触发指标并暂停变径作业"},
                    {"stepOrdinal": 2, "instruction": "按合成处置流程第二步实施措施并保留处置前后量测记录"},
                ],
                "resourceRequirements": ["inspection-crew", "synthetic-material-kit"],
                "targetIndicatorIds": sorted([INDICATOR_SETTLEMENT, INDICATOR_EXCAVATION, INDICATOR_STRATUM]),
                "evidenceRequirements": ["monitoring-record", "shift-log"],
                "contraindications": ["unverified-trigger-indicator"],
            }
        )
    measure_library = configuration_document("measure-library", {"measures": measures})

    forecast_policy = configuration_document(
        "forecast-policy",
        {
            "policies": [
                {
                    "policyId": "forecast-monitoring-trend",
                    "method": "monitoring-trend",
                    "inputIndicatorIds": [INDICATOR_SETTLEMENT, INDICATOR_EXCAVATION],
                    "targetIndicatorId": INDICATOR_SETTLEMENT,
                    "horizonSteps": 3,
                    "unit": "mm",
                    "requiredRef": {"entityId": "forecast-trend-model-synthetic-v1", "versionId": "1"},
                },
                {
                    "policyId": "forecast-statistics",
                    "method": "historical-statistics",
                    "inputIndicatorIds": [INDICATOR_SETTLEMENT, INDICATOR_STRATUM],
                    "targetIndicatorId": INDICATOR_SETTLEMENT,
                    "horizonSteps": 5,
                    "unit": "mm",
                    "requiredRef": {"entityId": "forecast-statistics-model-synthetic-v1", "versionId": "1"},
                },
            ]
        },
    )

    deviation_policy = configuration_document(
        "deviation-policy",
        {
            "policies": [
                {
                    "policyId": "deviation-absolute",
                    "basis": "absolute",
                    "threshold": "2",
                    "evidenceRequirements": ["monitoring-record"],
                },
                {
                    "policyId": "deviation-level-step",
                    "basis": "risk-level-step",
                    "levelStep": 1,
                    "riskMatrixRef": matrix_ref,
                    "evidenceRequirements": ["assessment-record"],
                },
                {
                    "policyId": "deviation-relative",
                    "basis": "relative",
                    "threshold": "0.1",
                    "minimumBaseline": "0.01",
                    "evidenceRequirements": ["monitoring-record"],
                },
            ]
        },
    )

    return [
        ("indicator-system", indicator_system),
        ("indicator-field-mapping", field_mapping),
        ("weight-set", weight_set),
        ("scoring-strategy", scoring_strategy),
        ("risk-matrix", risk_matrix),
        ("risk-acceptance-threshold", acceptance_threshold),
        ("monitoring-warning-threshold", monitoring_threshold),
        ("joint-trigger-policy", joint_policy),
        ("measure-library", measure_library),
        ("forecast-policy", forecast_policy),
        ("deviation-policy", deviation_policy),
    ]


def numeric_thresholds(prefix: str, table, unit: str) -> list[dict]:
    """把显式合成分段区间展开成评分阈值（顺序即区间自低到高）。"""
    thresholds = []
    for index, ((lower, upper), score) in enumerate(table, start=1):
        if lower is None:
            thresholds.append(
                {"thresholdId": f"{prefix}-t{index:02d}", "score": score, "operator": "lt", "value": upper}
            )
        elif upper is None:
            thresholds.append(
                {"thresholdId": f"{prefix}-t{index:02d}", "score": score, "operator": "gte", "value": lower}
            )
        else:
            thresholds.append(
                {
                    "thresholdId": f"{prefix}-t{index:02d}",
                    "score": score,
                    "operator": "between",
                    "value": lower,
                    "upperValue": upper,
                }
            )
    assert unit
    return thresholds


GRADE_INTERVALS = [
    {"grade": "grade-a", "lowerBound": 0, "upperBound": 2},
    {"grade": "grade-b", "lowerBound": 2, "upperBound": 4},
    {"grade": "grade-c", "lowerBound": 4, "upperBound": 6},
    {"grade": "grade-d", "lowerBound": 6, "upperBound": 8},
    {"grade": "grade-e", "lowerBound": 8, "upperBound": 12},
]

AGENT_TASK_REF = {
    "kind": "agent-task",
    "reference": {"entityId": "agent-task-synthetic-knowledge-authoring", "versionId": "1"},
    "taskType": "knowledge-authoring",
    "triggerMode": "embedded",
    "modelDeploymentRef": {"entityId": "model-deployment-synthetic-v1", "versionId": "1"},
    "promptTemplateRef": {"entityId": "prompt-template-synthetic-v1", "versionId": "1"},
    "toolPolicyRef": {"entityId": "tool-policy-synthetic-v1", "versionId": "1"},
    "budgetPolicyRef": {"entityId": "budget-policy-synthetic-v1", "versionId": "1"},
    "incrementSchemaRef": {"entityId": "increment-schema-synthetic-v1", "versionId": "1"},
    "validationPolicyRef": {"entityId": "validation-policy-synthetic-v1", "versionId": "1"},
}


def build_rules() -> dict:
    stratum_thresholds = [
        {
            "thresholdId": f"rule-stratum-grade-score-t{index:02d}",
            "score": STRATUM_SCORE[stratum],
            "operator": "eq",
            "value": stratum,
        }
        for index, stratum in enumerate(STRATA, start=1)
    ]

    def member(rule_id: str, indicator: str, thresholds: list[dict], source_version: str, segment: str) -> dict:
        rule = {
            "ruleId": rule_id,
            "applicabilityConditions": {
                "constructionMethod": ["原位变径盾构"],
                "stratumCondition": sorted(STRATA),
                "engineeringStage": sorted(PROCESS_NODES),
            },
            "indicatorItem": indicator,
            "scoringThresholds": thresholds,
            "gradeIntervals": GRADE_INTERVALS,
            "exceptionClauses": [],
            "evidenceLocator": {"sourceSegmentId": segment},
            "ruleVersion": {"entityId": f"{rule_id}-synthetic-v1", "versionId": "1"},
            "reviewStatus": "pending",
        }
        binding = {
            "sourceVersionRef": versioned("source-version", source_version),
            "cleaningResultArtifactRef": versioned("content-artifact", f"cleaning-result-{rule_id}"),
            "evidenceReferences": [
                {"locator": {"sourceSegmentId": segment}, "sourceVersion": {"entityId": source_version, "versionId": "1"}}
            ],
            "agentTaskRef": AGENT_TASK_REF,
        }
        return {"rule": rule, "binding": binding}

    return {
        "schemaVersion": SCHEMA_VERSION,
        "projectRevisionRef": versioned(
            "project-revision", PROJECT_REVISION["entityId"], PROJECT_REVISION["versionId"]
        ),
        "configurationSetRef": CONFIGURATION_SET,
        "compatibilityRef": {"entityId": "scoring-rule-compatibility-synthetic-v1", "versionId": "1"},
        "scoringPolicyRef": {"entityId": "scoring-policy-synthetic-v1", "versionId": "1"},
        "cleaningResultArtifactRef": versioned("content-artifact", "cleaning-result-synthetic-v1"),
        "agentTaskRef": AGENT_TASK_REF,
        "members": [
            member(
                "rule-face-pressure-score",
                INDICATOR_EXCAVATION,
                numeric_thresholds("rule-face-pressure-score", PRESSURE_SCORE, "kPa"),
                "synthetic-quantization-safety-v1",
                "SYN-KB-RULE-FACE-PRESSURE-01",
            ),
            member(
                "rule-settlement-score",
                INDICATOR_SETTLEMENT,
                numeric_thresholds("rule-settlement-score", SETTLEMENT_SCORE, "mm"),
                "synthetic-quantization-settlement-v1",
                "SYN-KB-RULE-SETTLEMENT-01",
            ),
            member(
                "rule-stratum-grade-score",
                INDICATOR_STRATUM,
                stratum_thresholds,
                "synthetic-quantization-stratum-v1",
                "SYN-KB-RULE-STRATUM-01",
            ),
        ],
    }


KNOWLEDGE_HEADER = {
    "schemaVersion": SCHEMA_VERSION,
    "projectId": PROJECT_ID,
    "validationPolicyRef": {"entityId": "validation-policy-synthetic-v1", "versionId": "1"},
    "preparationSnapshotRef": versioned(
        "identification-preparation-snapshot", "identification-preparation-snapshot-synthetic-v1"
    ),
    "generatedAt": "2026-03-01T00:00:00+08:00",
}

EVIDENCE_SOURCE = "synthetic-knowledge-evidence-v1"


def synthetic_evidence(segment_id: str) -> list[dict]:
    return [
        {
            "locator": {"sourceSegmentId": segment_id},
            "sourceVersion": {"entityId": EVIDENCE_SOURCE, "versionId": "1"},
        }
    ]


def build_process_model() -> dict:
    node_inputs = {
        "扩径准备": ["盾构机组装验收记录", "始发井结构验收记录"],
        "变径空间扩挖": ["扩挖范围设计参数", "地层条件勘察成果"],
        "刀盘扩径": ["刀盘扩径作业参数", "开挖面控制压力记录"],
        "盾体扩径": ["盾体拼装作业记录", "管片拼装质量记录"],
        "缩径转换": ["缩径作业参数", "后续区间掘进计划"],
    }
    node_outputs = {
        "扩径准备": ["设备具备始发条件结论"],
        "变径空间扩挖": ["扩挖段初始支护状态"],
        "刀盘扩径": ["刀盘直径变径结果"],
        "盾体扩径": ["盾体直径变径结果"],
        "缩径转换": ["缩径段连续掘进条件"],
    }
    state_parameters = {
        "扩径准备": ["盾体直径", "刀盘直径", "反力体系状态"],
        "变径空间扩挖": ["支护状态", "土仓/泥水压力"],
        "刀盘扩径": ["刀盘直径", "土仓/泥水压力", "主驱动伸出量"],
        "盾体扩径": ["盾体直径", "焊接/拼装状态", "支护状态"],
        "缩径转换": ["盾体直径", "注浆参数", "主驱动伸出量"],
    }
    indicators = {
        "扩径准备": ["地下水位", "盾构姿态参数"],
        "变径空间扩挖": ["地表沉降", "地下水位"],
        "刀盘扩径": ["泥水压力", "地表沉降"],
        "盾体扩径": ["支护结构变形", "盾构姿态参数"],
        "缩径转换": ["注浆压力", "地表沉降"],
    }
    nodes = []
    for index, process in enumerate(PROCESS_NODES, start=1):
        nodes.append(
            {
                "nodeId": f"node-{index:02d}-{process}",
                "processKind": process,
                "inputs": node_inputs[process],
                "outputs": node_outputs[process],
                "equipmentRefs": ["小盾构", "扩径模块"],
                "structuralComponentRefs": ["钢管片"],
                "stateParameters": state_parameters[process],
                "monitoringIndicators": indicators[process],
                "applicability": {
                    "constructionMethod": ["原位变径盾构"],
                    "stratumCondition": sorted(STRATA),
                    "engineeringStage": [process],
                },
                "evidence": synthetic_evidence(f"SYN-KB-PROCESS-{index:02d}"),
            }
        )
    edges = []
    for index in range(len(PROCESS_NODES) - 1):
        edges.append(
            {
                "edgeId": f"edge-sequence-{index + 1:02d}",
                "fromNodeId": f"node-{index + 1:02d}-{PROCESS_NODES[index]}",
                "toNodeId": f"node-{index + 2:02d}-{PROCESS_NODES[index + 1]}",
                "relationType": "时间先后关系",
                "evidence": synthetic_evidence(f"SYN-KB-PROCESS-EDGE-{index + 1:02d}"),
            }
        )
    edges.append(
        {
            "edgeId": "edge-force-shield-to-cutter",
            "fromNodeId": "node-03-刀盘扩径",
            "toNodeId": "node-04-盾体扩径",
            "relationType": "受力依赖关系",
            "evidence": synthetic_evidence("SYN-KB-PROCESS-EDGE-FORCE"),
        }
    )
    return {**KNOWLEDGE_HEADER, "definitionType": "process-model", "nodes": nodes, "dependencyEdges": edges}


# 机理适用工序（与 risk-mechanism 知识包的 nodeIds 保持同一事实源）；
# 轮换只在该列表内进行，五工序覆盖由六类机理合起来保证。
MECHANISM_NODES = {
    "掌子面稳定性失效": ["node-02-变径空间扩挖", "node-03-刀盘扩径", "node-05-缩径转换"],
    "支护结构失效": ["node-02-变径空间扩挖", "node-04-盾体扩径", "node-05-缩径转换"],
    "渗流突涌": ["node-03-刀盘扩径", "node-04-盾体扩径", "node-01-扩径准备"],
    "过挖与地表沉降": ["node-03-刀盘扩径", "node-04-盾体扩径", "node-05-缩径转换"],
    "施工装备故障": ["node-01-扩径准备", "node-04-盾体扩径", "node-05-缩径转换"],
    "装配连接失效": ["node-04-盾体扩径", "node-05-缩径转换", "node-01-扩径准备"],
}

MECHANISM_INDICATORS = {
    "掌子面稳定性失效": ["地下水位", "泥水压力"],
    "支护结构失效": ["支护结构变形", "地表沉降"],
    "渗流突涌": ["地下水位", "泥水压力"],
    "过挖与地表沉降": ["地表沉降", "注浆压力"],
    "施工装备故障": ["盾构姿态参数", "注浆压力"],
    "装配连接失效": ["盾构姿态参数", "支护结构变形"],
}


def build_risk_mechanism() -> dict:
    mechanisms = []
    for index, (mechanism, _event, phenomenon) in enumerate(MECHANISMS, start=1):
        mechanisms.append(
            {
                "mechanismId": f"mechanism-{index:02d}",
                "mechanismType": mechanism,
                "nodeIds": MECHANISM_NODES[mechanism],
                "stateParameters": ["土仓/泥水压力", "支护状态"],
                "monitoringIndicators": MECHANISM_INDICATORS[mechanism],
                "applicability": {
                    "constructionMethod": ["原位变径盾构"],
                    "stratumCondition": sorted(STRATA),
                    "engineeringStage": sorted(PROCESS_NODES),
                },
                "preconditions": ["变径段支护与开挖参数已确认"],
                "triggeringFactors": [phenomenon],
                "evolutionPath": ["征兆出现", "工况偏离", "量测值越限"],
                "consequences": ["结构损伤或功能受损", "工期与成本影响"],
                "evidence": synthetic_evidence(f"SYN-KB-MECHANISM-{index:02d}"),
            }
        )
    return {
        **KNOWLEDGE_HEADER,
        "definitionType": "risk-mechanism",
        "processModelReleaseRef": versioned("process-model-release", "process-model-release-synthetic-v1"),
        "mechanisms": mechanisms,
    }


def build_standard_library() -> dict:
    entries = [
        {
            "entryId": "standard-01-risk-management",
            "level": "national",
            "standardIdentity": "GB 50652-2011 城市轨道交通地下工程建设风险管理规范",
            "standardVersion": "GB50652-2011",
            "clauseRefs": ["3.2.4 风险等级标准划分依据", "4.3.1 风险等级四级划分", "表4.3.2 风险接受准则"],
            "applicability": {
                "constructionMethod": ["原位变径盾构", "常规盾构"],
                "stratumCondition": sorted(STRATA),
                "engineeringStage": sorted(PROCESS_NODES),
            },
            "evidence": synthetic_evidence("SYN-KB-STANDARD-01"),
        },
        {
            "entryId": "standard-02-monitoring",
            "level": "national",
            "standardIdentity": "GB 50911-2013 城市轨道交通工程监测技术规范",
            "standardVersion": "GB50911-2013",
            "clauseRefs": ["4.2.2 盾构法隧道管片结构和周围岩土体监测项目", "9.2.2 管片结构竖向位移、净空收敛和地表沉降控制值"],
            "applicability": {
                "constructionMethod": ["常规盾构"],
                "stratumCondition": sorted(STRATA),
                "engineeringStage": sorted(PROCESS_NODES),
            },
            "evidence": synthetic_evidence("SYN-KB-STANDARD-02"),
        },
        {
            "entryId": "standard-03-shield-construction",
            "level": "national",
            "standardIdentity": "GB 50446-2017 盾构法隧道施工及验收规范",
            "standardVersion": "GB50446-2017",
            "clauseRefs": [
                "7.8.6 气压作业前开挖仓内气压须经计算和试验确定（该条自2023-03-01起废止，仅作历史参考）",
                "15.5.3 达到预警标准或实测变形值大于允许变形的2/3时警情报送",
            ],
            "applicability": {
                "constructionMethod": ["原位变径盾构", "常规盾构"],
                "stratumCondition": sorted(STRATA),
                "engineeringStage": sorted(PROCESS_NODES),
            },
            "evidence": synthetic_evidence("SYN-KB-STANDARD-03"),
        },
    ]
    return {**KNOWLEDGE_HEADER, "definitionType": "standard-library", "entries": entries}


def build_case_library() -> dict:
    entries = []
    for index, (mechanism, event, phenomenon) in enumerate(MECHANISMS, start=1):
        entries.append(
            {
                "entryId": f"case-entry-{index:02d}",
                "constructionMethod": "原位变径盾构",
                "engineeringConditions": [MECHANISM_INDICATORS[mechanism][0], STRATA[index % len(STRATA)]],
                "process": sorted(MECHANISM_NODES[mechanism]),
                "events": [event],
                "outcomes": [f"{phenomenon}后的处置结果为合成记录"],
                "treatments": ["暂停变径作业并复核触发指标", "实施合成处置措施并留存量测证据"],
                "applicability": {
                    "constructionMethod": ["原位变径盾构"],
                    "stratumCondition": sorted(STRATA),
                    "engineeringStage": sorted(PROCESS_NODES),
                },
                "evidence": synthetic_evidence(f"SYN-KB-CASE-{index:02d}"),
            }
        )
    return {**KNOWLEDGE_HEADER, "definitionType": "case-library", "entries": entries}


def iso_at(date: str, minutes: int) -> str:
    hour, minute = divmod(8 * 60 + minutes, 60)
    return f"{date}T{hour:02d}:{minute:02d}:00+08:00"


def build_monitoring(cases: list[dict]) -> dict:
    series_revisions = []
    artifacts = []
    batches = []
    samples = []
    for split_name, split in SPLITS.items():
        settlement_unit = INDICATOR_SERIES["地表沉降"]["unit"]
        readings: dict[str, list[dict]] = {}
        for case in cases:
            if case["split"] != split_name:
                continue
            values = case["inputs"]["observedValues"]
            settlement_segment = case["inputs"]["sourceSegmentIds"][2]
            readings.setdefault("ground-settlement", []).append(
                {
                    "sourceSampleKey": f"{case['caseId']}-GS",
                    "sampledAt": iso_at(split["date"], 30 + len(samples) % 600),
                    "value": values["groundSettlementMm"],
                    "unit": settlement_unit,
                    "evidenceReferences": [
                        {
                            "locator": {"sourceSegmentId": settlement_segment},
                            "sourceVersion": {"entityId": split["sourceVersion"], "versionId": "1"},
                        }
                    ],
                    "caseId": case["caseId"],
                }
            )
            if case["monitoringIndicator"] != "地表沉降":
                parameter = MONITORING_PARAMETERS[case["monitoringIndicator"]][0]
                readings.setdefault(parameter, []).append(
                    {
                        "sourceSampleKey": f"{case['caseId']}-SCENARIO",
                        "sampledAt": iso_at(split["date"], 45 + len(samples) % 600),
                        "value": values["scenarioMonitoringValue"],
                        "unit": INDICATOR_SERIES[case["monitoringIndicator"]]["unit"],
                        "evidenceReferences": [
                            {
                                "locator": {"sourceSegmentId": settlement_segment},
                                "sourceVersion": {"entityId": split["sourceVersion"], "versionId": "1"},
                            }
                        ],
                        "caseId": case["caseId"],
                    }
                )
        for indicator in MONITORING_INDICATORS:
            parameter, unit = MONITORING_PARAMETERS[indicator]
            series_id = f"{split['prefix']}-MS-{parameter}"
            if indicator == "地表沉降":
                series_id = f"{split['prefix']}-MS-ground-settlement"
            case_readings = sorted(readings.get(parameter, []), key=lambda item: item["sourceSampleKey"])
            if not case_readings:
                continue
            series_ref = versioned("monitoring-series", series_id)
            source_segment_set = versioned("source-segment-set", f"{split['prefix']}-SEGMENT-SET-01")
            series_revisions.append(
                {
                    "monitoringSeriesRef": series_ref,
                    "seriesId": series_id,
                    "projectId": PROJECT_ID,
                    "projectRevisionRef": versioned(
                        "project-revision", PROJECT_REVISION["entityId"], PROJECT_REVISION["versionId"]
                    ),
                    "spatialScopeRef": versioned(
                        "spatial-scope", SPATIAL_SCOPE["entityId"], SPATIAL_SCOPE["versionId"]
                    ),
                    "monitoringObject": f"{split['site']} {indicator}测点",
                    "monitoringIndicator": indicator,
                    "parameterCode": parameter,
                    "canonicalUnit": unit,
                    "unitConversions": [],
                    "effectivePeriod": {"validFrom": f"{split['date']}T00:00:00+08:00"},
                    "recordedAt": f"{split['date']}T23:00:00+08:00",
                    "audit": {
                        "actorId": "synthetic-materials-builder",
                        "action": "monitoring-series-revision-created",
                        "recordedAt": f"{split['date']}T23:00:00+08:00",
                    },
                }
            )
            clean_samples = [
                {key: value for key, value in reading.items() if key != "caseId"} for reading in case_readings
            ]
            samples.extend(clean_samples)
            artifact_id = f"{series_id}-A01"
            artifacts.append(
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "mediaType": "application/x-ndjson",
                    "monitoringSeriesRef": series_ref,
                    "projectRevisionRef": versioned(
                        "project-revision", PROJECT_REVISION["entityId"], PROJECT_REVISION["versionId"]
                    ),
                    "spatialScopeRef": versioned(
                        "spatial-scope", SPATIAL_SCOPE["entityId"], SPATIAL_SCOPE["versionId"]
                    ),
                    "sourceVersionRef": versioned("source-version", split["sourceVersion"]),
                    "sourceSegmentSetRef": source_segment_set,
                    "productionStrategyRef": {"entityId": "monitoring-production-strategy-v1", "versionId": "1"},
                    "sampleCount": len(clean_samples),
                }
            )
            fingerprint = hashlib.sha256(
                json.dumps(clean_samples, ensure_ascii=False, sort_keys=True).encode("utf-8")
            ).hexdigest()
            batches.append(
                {
                    "monitoringBatchRef": versioned("monitoring-batch", f"{series_id}-B01"),
                    "projectId": PROJECT_ID,
                    "monitoringSeriesRef": series_ref,
                    "projectRevisionRef": versioned(
                        "project-revision", PROJECT_REVISION["entityId"], PROJECT_REVISION["versionId"]
                    ),
                    "spatialScopeRef": versioned(
                        "spatial-scope", SPATIAL_SCOPE["entityId"], SPATIAL_SCOPE["versionId"]
                    ),
                    "deliveryKey": f"{series_id}-2026-01",
                    "deliveryFingerprint": fingerprint,
                    "sampleArtifactRef": versioned("content-artifact", artifact_id),
                    "sourceVersionRef": versioned("source-version", split["sourceVersion"]),
                    "sourceSegmentSetRef": source_segment_set,
                    "window": {
                        "from": f"{split['date']}T00:00:00+08:00",
                        "to": f"{split['date']}T23:59:00+08:00",
                    },
                    "relation": {"kind": "original"},
                    "sampleCount": len(clean_samples),
                    "occurredAt": f"{split['date']}T23:00:00+08:00",
                    "recordedAt": f"{split['date']}T23:30:00+08:00",
                    "audit": {
                        "actorId": "synthetic-materials-builder",
                        "action": "monitoring-batch-recorded",
                        "recordedAt": f"{split['date']}T23:30:00+08:00",
                    },
                }
            )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "seriesRevisions": series_revisions,
        "sampleArtifacts": artifacts,
        "batches": batches,
        "samples": samples,
    }


def build_feedback() -> dict:
    rows = []
    for index, (mechanism, _event, _observation) in enumerate(MECHANISMS, start=1):
        snapshot = {
            "schemaVersion": SCHEMA_VERSION,
            "executionRecordRef": versioned("execution-record", f"execution-record-synthetic-{index:02d}"),
            "feedbackRef": versioned("feedback", f"feedback-synthetic-{index:02d}"),
            "effectForecastRef": versioned("effect-forecast", f"effect-forecast-synthetic-{index:02d}"),
            "deviationPolicyRef": {"entityId": "deviation-policy-synthetic-v1", "versionId": "1"},
            "calibrationAgentPolicyRef": {"entityId": "calibration-agent-policy-synthetic-v1", "versionId": "1"},
            "authorizationContextRef": versioned(
                "authorization-context", f"authorization-context-synthetic-{index:02d}"
            ),
            "auditTrailRef": versioned("audit-trail", f"audit-trail-synthetic-{index:02d}"),
            "createdBy": "synthetic-materials-builder",
            "createdAt": "2026-05-06T10:00:00+08:00",
        }
        digest = hashlib.sha256(
            json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        rows.append(
            {
                "schemaVersion": SCHEMA_VERSION,
                "projectId": PROJECT_ID,
                "feedbackInputSnapshotRef": versioned(
                    "response-feedback-input-snapshot", f"feedback-input-snapshot-synthetic-{index:02d}"
                ),
                "commandKind": "warning-response.record-feedback",
                "commandId": f"feedback-command-synthetic-{index:02d}",
                "idempotencyKey": f"feedback-idempotency-synthetic-{index:02d}",
                "inputDigest": digest,
                "snapshot": snapshot,
                "spatialScopeRef": versioned(
                    "spatial-scope", SPATIAL_SCOPE["entityId"], SPATIAL_SCOPE["versionId"]
                ),
                "actualAssessmentRecordRef": versioned(
                    "risk-assessment-record", f"assessment-record-synthetic-{index:02d}"
                ),
                "executionRecordRef": versioned("execution-record", f"execution-record-synthetic-{index:02d}"),
                "state": "prepared",
                "preparedAt": "2026-05-06T10:00:00+08:00",
                "effectForecastRef": versioned("effect-forecast", f"effect-forecast-synthetic-{index:02d}"),
                "auditTrailRef": versioned("audit-trail", f"audit-trail-synthetic-{index:02d}"),
            }
        )
    coverage = [
        {
            "feedbackInputSnapshotId": f"feedback-input-snapshot-synthetic-{index:02d}",
            "mechanismType": mechanism,
        }
        for index, (mechanism, _event, _observation) in enumerate(MECHANISMS, start=1)
    ]
    return {"schemaVersion": SCHEMA_VERSION, "feedbackInputs": rows, "mechanismCoverage": coverage}


SOURCES = [
    {
        "id": "STD-001",
        "title": "城市轨道交通地下工程建设风险管理规范 GB 50652-2011",
        "path": "parse/standards/STD-001.txt",
        "locator": "§3.2.4（L163）、§4.3.1—4.3.2（L40）、附录A—E（L4 目录）；review/ocr_review.md §4.1",
        "explicitFact": "3.2.4 工程建设风险等级标准应按风险发生可能性及其损失进行划分；4.3.1 风险等级宜分为四级；表4.3.2 各等级风险的接受准则。",
        "applicability": "等级与接受准则框架可用于变径工程；具体分级矩阵须由甲方发布版本给出。",
        "uncertainty": "PDF 为扫描图像版无文本层，镜像文本条款号存在 OCR 噪声（3 2、4。）；1.0.3、1.0.4、9.1.2 自 2023-03-01 起废止。",
    },
    {
        "id": "STD-002",
        "title": "城市轨道交通工程监测技术规范 GB 50911-2013",
        "path": "parse/standards/STD-002.txt",
        "locator": "§4.2.2 表4.2.2（L727）、§9.2.2（L2111）、表9.2.2-2 注（L2243）；review/THRESHOLDS-compendium.md",
        "explicitFact": "4.2.2 盾构法隧道管片结构和周围岩土体监测项目应根据表4.2.2 确定；9.2.2 控制值当无地方经验时可按表9.2.2-1、表9.2.2-2 确定。",
        "applicability": "表9.2.2-2 注明确主要适用于标准断面的盾构法隧道，不得直接作为变径段阈值。",
        "uncertainty": "表4.2.1~4.2.5 的应测/选测符号在文本提取中丢失；3.1.1、9.1.1、9.1.5 自 2023-03-01 起废止。",
    },
    {
        "id": "STD-003",
        "title": "盾构法隧道施工及验收规范 GB 50446-2017",
        "path": "parse/standards/STD-003.txt",
        "locator": "§7.8.6（L1196）、§15.5.3（L1829）、§15.5.5（L1834）",
        "explicitFact": "7.8.6 气压作业前开挖仓内气压必须通过计算和试验确定；15.5.3 达到预警标准或实测变形值大于允许变形的2/3时应进行警情报送。",
        "applicability": "开仓与监测警情流程适用于变径段；控制值仍须按 GB 50911 与甲方口径确定。",
        "uncertainty": "3.0.3、7.8.6 自 2023-03-01 起废止，引用前须核对现行条文。",
    },
    {
        "id": "ENG-001",
        "title": "全球首台可变径盾构机顺利始发（中国中铁，2025-11-24）",
        "path": "parse/engineering/ENG-001.md",
        "locator": "正文第2—3段",
        "explicitFact": "变径一号在芳白城际广白区间始发，掘进长度2056米，盾构机长145米、宽8.83米、重1950吨，可实现8.83米至12.45米变径。",
        "applicability": "用于工序链条与装备构成的可观察事实；不构成风险阈值。",
        "uncertainty": "新闻稿口径，未给出监测控制值与分级准则。",
    },
    {
        "id": "ENG-003",
        "title": "全球首台原位连续大尺寸可变径盾构机顺利下线（科学网，2025-09-30）",
        "path": "parse/engineering/ENG-003.md",
        "locator": "正文第5段及技术难点段落",
        "explicitFact": "变径过程中开挖面积扩大约98%，变径前后隧道成型内径面积扩大约89%；攻克多刀梁同步伸缩、狭小空间重载变径拼装与系统集成。",
        "applicability": "支持变径段开挖量与拼装工序的量级判断。",
        "uncertainty": "新闻稿无工程量测明细与分级依据。",
    },
    {
        "id": "ENG-177",
        "title": "芳村至白云机场城际环境影响报告书（2021 年第三次公示）",
        "path": "parse/engineering/ENG-177.txt",
        "locator": "五、工程概况（L1263）",
        "explicitFact": "报告书（2021 年 7 月）载明广州火车站主体及出入口采用明挖法施工。",
        "applicability": "仅可作为该线 2021 年方案的工法事实。",
        "uncertainty": "版本早于 2025 年可变径盾构方案，工法与装备口径已不匹配，不得用于现行工序判定。",
    },
    {
        "id": "ENG-201",
        "title": "佛山轨道交通2号线一期工程2·7透水坍塌重大事故调查报告（2018）",
        "path": "parse/engineering/ENG-201.txt",
        "locator": "盾尾密封情况分析（L305—L312）",
        "explicitFact": "事故段中砂层透水性中至强且含承压水；盾构机采用2道钢丝刷+1道密封脂，盾尾密封设计最大耐压为1.0MPa。",
        "applicability": "支撑承压水条件下密封与突涌机理的触发条件描述。",
        "uncertainty": "事故调查报告，参数不可直接作为设计或阈值取值。",
    },
    {
        "id": "ENG-212",
        "title": "深圳地铁12号线二工区8·15车辆伤害事故调查报告（2020）",
        "path": "parse/engineering/ENG-212.md",
        "locator": "事故直接原因（L242—L244）",
        "explicitFact": "报告认定变频器可能因接触不良、外界干扰或环境湿热变化导致元件误检测、突发技术故障并切断电源；防溜车钩等紧急制动装置制动功能失效，坡道坡度28.2‰未能有效制停。",
        "applicability": "支撑装备驱动与制动回路失效的触发条件描述。",
        "uncertainty": "事故调查报告；变频器故障在报告中为可能性推断而非实测结论，坡度与设备型号不可直接作为本项目阈值。",
    },
]


def build_acceptance_cases() -> dict:
    cases = [
        {
            "acceptanceCaseId": "SYN-ACC-001",
            "title": "资料文件缺失",
            "category": "pack-contract",
            "precondition": "manifest.documents 中存在指向不存在文件的条目。",
            "mutation": {"target": "manifest.json", "operation": "set-document-file-missing", "value": "SYN-DEV-DOC-LEDGER"},
            "expectedOutcome": "rejected",
            "detailCode": "pack-document-missing",
            "note": "缺文件必须非零退出，不能以文件数量代替材料合格。",
        },
        {
            "acceptanceCaseId": "SYN-ACC-002",
            "title": "评估配置非法",
            "category": "pack-contract",
            "precondition": "risk-matrix 的可能性轴分段边界不连续。",
            "mutation": {
                "target": "configurations/risk-matrix.json",
                "operation": "break-band-adjacency",
                "value": "p-band-3",
            },
            "expectedOutcome": "rejected",
            "detailCode": "configuration-schema-invalid",
            "note": "11 类配置须逐个通过 AssessmentConfigurationDocumentV1Schema。",
        },
        {
            "acceptanceCaseId": "SYN-ACC-003",
            "title": "同一资料家族跨集合",
            "category": "split-isolation",
            "precondition": "试运行集合引用开发集合的 documentId 或 sourceFamily。",
            "mutation": {"target": "scenarios.json", "operation": "share-document-across-splits", "value": "SYN-DEV-DOC-LEDGER"},
            "expectedOutcome": "rejected",
            "detailCode": "split-source-family-leaked",
            "note": "开发与试运行必须使用互不相交的资料家族与模板家族。",
        },
        {
            "acceptanceCaseId": "SYN-ACC-004",
            "title": "来源定位缺失",
            "category": "provenance",
            "precondition": "sources 中某条缺少 locator 或 explicitFact。",
            "mutation": {"target": "sources.json", "operation": "remove-locator", "value": "STD-002"},
            "expectedOutcome": "rejected",
            "detailCode": "source-locator-missing",
            "note": "来源只登记标识与短摘录，缺定位即不合格。",
        },
        {
            "acceptanceCaseId": "SYN-ACC-005",
            "title": "关键覆盖不足",
            "category": "coverage",
            "precondition": "试运行集合中某类机理正例少于五个。",
            "mutation": {"target": "expected.json", "operation": "remove-positive-cases", "value": "掌子面稳定性失效"},
            "expectedOutcome": "rejected",
            "detailCode": "coverage-insufficient",
            "note": "每类机理试运行至少五正五负，未知项不得充作负例。",
        },
        {
            "acceptanceCaseId": "SYN-ACC-006",
            "title": "输入文件混入候选答案",
            "category": "label-isolation",
            "precondition": "scenarios.json 出现 candidateLabel、riskEvent 或 mechanismType 字段。",
            "mutation": {"target": "scenarios.json", "operation": "inject-expected-field", "value": "candidateLabel"},
            "expectedOutcome": "rejected",
            "detailCode": "label-leaked-into-inputs",
            "note": "被测模型消费的文件不得包含候选预期。",
        },
        {
            "acceptanceCaseId": "SYN-ACC-007",
            "title": "同指标双映射或单位不一致",
            "category": "configuration-consistency",
            "precondition": "indicator-field-mapping 中同一 targetIndicatorId 出现两条映射。",
            "mutation": {
                "target": "configurations/indicator-field-mapping.json",
                "operation": "duplicate-target-indicator",
                "value": "indicator-consequence-settlement",
            },
            "expectedOutcome": "rejected",
            "detailCode": "configuration-mapping-conflict",
            "note": "单一有效字段映射，且单位保持物理语义。",
        },
        {
            "acceptanceCaseId": "SYN-ACC-008",
            "title": "资料段标识冲突",
            "category": "evidence",
            "precondition": "两个用例声明同一 sourceSegmentId。",
            "mutation": {"target": "scenarios.json", "operation": "duplicate-source-segment", "value": "SEG"},
            "expectedOutcome": "rejected",
            "detailCode": "source-segment-duplicated",
            "note": "资料段标识按用例唯一生成，冲突会破坏证据定位。",
        },
    ]
    for case in cases:
        case["executionStatus"] = "not-executed"
    return {"schemaVersion": SCHEMA_VERSION, "acceptanceCases": cases}


MATRIX_SAMPLES = [
    ("1", 0.8, 4.0, "p-band-1", "c-band-1", "level-1"),
    ("2", 0.8, 12.0, "p-band-1", "c-band-2", "level-2"),
    ("3", 1.6, 4.0, "p-band-2", "c-band-1", "level-2"),
    ("4", 1.6, 12.0, "p-band-2", "c-band-2", "level-3"),
    ("5", 3.2, 4.0, "p-band-3", "c-band-1", "level-3"),
    ("6", 4.8, 100.0, "p-band-3", "c-band-2", "level-4"),
    ("7", 1.0, 10.0, "p-band-2", "c-band-2", "level-3"),
    ("8", 0.999, 9.999, "p-band-1", "c-band-1", "level-1"),
    ("9", 2.0, 9.99, "p-band-3", "c-band-1", "level-3"),
    ("10", 5.0, 4.0, "p-band-3", "c-band-1", "level-3"),
]


def build_business_acceptance_cases() -> list[dict]:
    """业务与边界验收表：候选、未执行，确定性预期由显式输入与算式给出。"""
    rows: list[dict] = []
    for index, likelihood, consequence, p_band, c_band, level in MATRIX_SAMPLES:
        rows.append(
            {
                "acceptanceCaseId": f"SYN-BIZ-MATRIX-{int(index):02d}",
                "title": f"风险矩阵映射 {likelihood}/{consequence}",
                "category": "risk-matrix",
                "input": {"likelihoodScore": likelihood, "consequenceScore": consequence},
                "deterministicExpectation": {
                    "possibilityBandId": p_band,
                    "consequenceBandId": c_band,
                    "riskLevelId": level,
                },
                "evidence": "configurations/risk-matrix.json",
                "executionStatus": "not-executed",
            }
        )
    rows.append(
        {
            "acceptanceCaseId": "SYN-BIZ-MATRIX-11",
            "title": "可能性分值高于末带上界",
            "category": "risk-matrix",
            "input": {"likelihoodScore": 5.001, "consequenceScore": 4.0},
            "deterministicExpectation": {"outcome": "rejected", "reasonCode": "matrix-axis-out-of-range"},
            "evidence": "configurations/risk-matrix.json",
            "executionStatus": "not-executed",
        }
    )
    rows.append(
        {
            "acceptanceCaseId": "SYN-BIZ-PC-01",
            "title": "P/C 手算对照",
            "category": "scoring",
            "input": {
                "stratumGrade": "上软下硬复合地层",
                "stratumScore": 3.5,
                "facePressureKpa": 72.0,
                "facePressureScore": 1.0,
                "groundSettlementMm": 24.0,
                "groundSettlementScore": 6.0,
            },
            "deterministicExpectation": {
                "likelihoodScore": 2.0,
                "likelihoodFormula": "3.5*4000/10000 + 1.0*6000/10000 = 2.00",
                "consequenceScore": 6.0,
                "riskLevelId": "level-3",
            },
            "evidence": "rules/structured-scoring-rules.json; configurations/weight-set.json",
            "executionStatus": "not-executed",
        }
    )
    remaining = [
        (
            "unit-conversion-identity",
            "单位换算保持物理语义",
            "field-mapping",
            {"sourceUnit": "mm", "targetUnit": "mm", "conversion": "identity", "actualValue": 24.0},
            {"outcome": "accepted", "indicatorValue": 24.0, "reasonCode": None},
            "configurations/indicator-field-mapping.json",
        ),
        (
            "missing-indicator-value",
            "指标实际值缺失",
            "scoring",
            {"indicatorId": INDICATOR_STRATUM, "actualValue": None},
            {"outcome": "rejected", "reasonCode": "scoring-value-type-mismatch"},
            "rules/structured-scoring-rules.json",
        ),
        (
            "applicability-filter-conflict",
            "适用性筛除",
            "rule-set",
            {"ruleStratumCondition": "富水中砂层", "metadataStratumCondition": "完整岩体"},
            {"outcome": "excluded", "reasonCode": "stratum-condition-mismatch"},
            "configurations/risk-acceptance-threshold.json",
        ),
        (
            "monitoring-metric-coverage",
            "value/slope/frequency 三特征与联合规则",
            "monitoring",
            {
                "metrics": ["value", "short-term-slope", "dominant-frequency"],
                "breached": ["value", "short-term-slope"],
            },
            {
                "triggerIndicators": [
                    "threshold-ground-settlement-value",
                    "threshold-settlement-slope",
                ],
                "jointRuleOutcome": "hit",
            },
            "configurations/monitoring-warning-threshold.json; configurations/joint-trigger-policy.json",
        ),
        (
            "monitoring-sample-dedup",
            "重复样本去重",
            "monitoring",
            {"sourceSampleKey": "SYN-DEV-001-GS", "deliveries": 2},
            {"outcome": "deduplicated", "effectiveSampleCount": 1},
            "monitoring.json",
        ),
        (
            "monitoring-correction-batch",
            "修正批次",
            "monitoring",
            {"relation": "correction", "priorBatchRef": "monitoring-batch"},
            {"outcome": "corrected", "priorStatus": "superseded", "historyPreserved": True},
            "monitoring.json",
        ),
        (
            "agent-task-failure-human-review",
            "必经 Agent 失败转人工",
            "agent",
            {"budgetExhausted": True, "fallbackAllowed": False},
            {"outcome": "waiting-human-review", "silentlySkipped": False},
            "references/acceptance/synthetic-v1/reports",
        ),
        (
            "permission-denied",
            "授权不足",
            "access",
            {"spatialScopeRef": "unauthorized-scope"},
            {"outcome": "rejected", "reasonCode": "AUTHORIZATION_DENIED"},
            "references/acceptance/synthetic-v1/reports",
        ),
        (
            "historical-replay",
            "历史重放",
            "traceability",
            {"likelihoodScore": 2.0, "consequenceScore": 6.0, "riskMatrixVersion": "1"},
            {"outcome": "level-3", "replayStable": True},
            "configurations/risk-matrix.json",
        ),
        (
            "calibration-rollback",
            "校准版本回滚",
            "calibration",
            {"publishedVersion": "2", "rollbackToVersion": "1"},
            {"outcome": "rolled-back", "historyPreserved": True, "autoOverwrite": False},
            "configurations/deviation-policy.json",
        ),
        (
            "risk-record-dedup",
            "识别结果合并",
            "identification",
            {"sameRiskAcrossProcesses": 2, "sameEvidenceLocator": 1},
            {"outcome": "merged", "duplicateSkipped": True},
            "knowledge/risk-mechanism.json",
        ),
    ]
    for slug, title, category, payload, expectation, evidence in remaining:
        rows.append(
            {
                "acceptanceCaseId": f"SYN-BIZ-{slug.upper()}",
                "title": title,
                "category": category,
                "input": payload,
                "deterministicExpectation": expectation,
                "evidence": evidence,
                "executionStatus": "not-executed",
            }
        )
    return rows


DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def document_plan(cases: list[dict]) -> list[dict]:
    """材料文件清单：每集合 17 个文件，覆盖七种文件形态与 Markdown 综合资料。"""
    plan: list[dict] = []
    for split_name, split in SPLITS.items():
        prefix = split["prefix"]
        split_cases = [case for case in cases if case["split"] == split_name]
        for order, process in enumerate(PROCESS_NODES, start=1):
            plan.append(
                {
                    "documentId": f"{prefix}-DOC-LOG-{process}",
                    "file": f"documents/{prefix}/construction-log-{order:02d}.docx",
                    "mediaType": DOCX_MEDIA_TYPE,
                    "format": "docx",
                    "sourceFamily": split["sourceFamily"],
                    "split": split_name,
                    "documentType": "construction-log",
                    "caseIds": sorted(
                        case["caseId"] for case in split_cases if case["processNode"] == process
                    ),
                }
            )
        plan.append(
            {
                "documentId": f"{prefix}-DOC-GEOLOGY",
                "file": f"documents/{prefix}/geology-report-scan.pdf",
                "mediaType": "application/pdf",
                "format": "pdf",
                "sourceFamily": split["sourceFamily"],
                "split": split_name,
                "documentType": "geology-report",
                "caseIds": sorted(case["caseId"] for case in split_cases),
            }
        )
        plan.append(
            {
                "documentId": f"{prefix}-DOC-METHOD",
                "file": f"documents/{prefix}/method-statement.pdf",
                "mediaType": "application/pdf",
                "format": "pdf",
                "sourceFamily": split["sourceFamily"],
                "split": split_name,
                "documentType": "method-statement",
                "caseIds": sorted(case["caseId"] for case in split_cases),
            }
        )
        plan.append(
            {
                "documentId": f"{prefix}-DOC-LEDGER",
                "file": f"documents/{prefix}/monitoring-ledger.xlsx",
                "mediaType": XLSX_MEDIA_TYPE,
                "format": "xlsx",
                "sourceFamily": split["sourceFamily"],
                "split": split_name,
                "documentType": "monitoring-ledger",
                "caseIds": sorted(case["caseId"] for case in split_cases),
            }
        )
        for indicator in MONITORING_INDICATORS:
            parameter = MONITORING_PARAMETERS[indicator][0]
            plan.append(
                {
                    "documentId": f"{prefix}-DOC-CSV-{parameter}",
                    "file": f"documents/{prefix}/monitoring-{parameter}.csv",
                    "mediaType": "text/csv",
                    "format": "csv",
                    "sourceFamily": split["sourceFamily"],
                    "split": split_name,
                    "documentType": "monitoring-series-export",
                    "caseIds": sorted(
                        case["caseId"]
                        for case in split_cases
                        if case["monitoringIndicator"] == indicator
                    ),
                }
            )
        plan.append(
            {
                "documentId": f"{prefix}-DOC-FIGURE",
                "file": f"documents/{prefix}/monitoring-section.png",
                "mediaType": "image/png",
                "format": "png",
                "sourceFamily": split["sourceFamily"],
                "split": split_name,
                "documentType": "figure",
                "caseIds": [],
            }
        )
        plan.append(
            {
                "documentId": f"{prefix}-DOC-PHOTO",
                "file": f"documents/{prefix}/site-photo.jpeg",
                "mediaType": "image/jpeg",
                "format": "jpeg",
                "sourceFamily": split["sourceFamily"],
                "split": split_name,
                "documentType": "photo",
                "caseIds": [],
            }
        )
        plan.append(
            {
                "documentId": f"{prefix}-DOC-SUMMARY",
                "file": f"documents/{prefix}/engineering-summary.md",
                "mediaType": "text/markdown",
                "format": "md",
                "sourceFamily": split["sourceFamily"],
                "split": split_name,
                "documentType": "engineering-summary",
                "caseIds": sorted(case["caseId"] for case in split_cases),
            }
        )
    return plan


def build_expected(cases: list[dict]) -> dict:
    expected_cases = []
    for case in cases:
        values = case["inputs"]["observedValues"]
        stratum = values["stratumGrade"]
        pressure = values["facePressureKpa"]
        settlement = values["groundSettlementMm"]
        likelihood = likelihood_score(stratum, pressure)
        consequence = consequence_score(settlement)
        warnings = []
        if threshold_breached("地表沉降", settlement):
            warnings.append(VALUE_THRESHOLD_BY_INDICATOR["地表沉降"])
        if threshold_breached(case["monitoringIndicator"], values["scenarioMonitoringValue"]):
            warnings.append(VALUE_THRESHOLD_BY_INDICATOR[case["monitoringIndicator"]])
        scores = {
            "stratumGrade": STRATUM_SCORE[stratum],
            "facePressure": band_score(pressure, PRESSURE_SCORE),
            "groundSettlement": band_score(settlement, SETTLEMENT_SCORE),
        }
        entry = {
            "caseId": case["caseId"],
            "candidateLabel": case["polarity"],
            "candidateExpectation": (
                "risk-record-present" if case["polarity"] == "positive" else
                "no-risk-record-for-target-mechanism"
            ),
            "candidateMechanismType": case["mechanismType"],
            "candidateProcessNode": case["processNode"],
            "candidateIndicatorScores": scores,
        }
        if case["polarity"] == "positive":
            entry |= {
                "candidateRiskEvent": case["riskEvent"],
                "candidateLikelihoodScore": likelihood,
                "candidateConsequenceScore": consequence,
                "candidateRiskLevel": risk_level(likelihood, consequence),
                "candidateWarningThresholdIds": sorted(set(warnings)),
                "note": "候选标签，未经甲方或专家复核；分值来自本包显式合成区间，非规范取值。",
            }
        else:
            entry |= {
                "candidateExternalRiskComparison": {
                    "likelihoodScore": likelihood,
                    "consequenceScore": consequence,
                    "riskLevel": risk_level(likelihood, consequence),
                },
                "candidateWarningThresholdIds": sorted(set(warnings)),
                "note": "负例只排除本类机理在该工序形成风险记录，不代表其它风险为零；"
                "外部风险评估对照分值不是识别产出。",
            }
        expected_cases.append(entry)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "packId": PACK_ID,
        "packVersion": PACK_VERSION,
        "label": LABEL,
        "labelStatus": LABEL_STATUS,
        "cases": expected_cases,
    }


def public_cases(cases: list[dict]) -> dict:
    """投影到 scenarios.json：只保留输入，剔除标签字段。"""
    keep = {
        "caseId",
        "split",
        "sourceFamily",
        "templateFamily",
        "processNode",
        "applicability",
        "monitoringIndicator",
        "inputs",
    }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "packId": PACK_ID,
        "packVersion": PACK_VERSION,
        "label": LABEL,
        "labelStatus": LABEL_STATUS,
        "cases": [{key: value for key, value in case.items() if key in keep} for case in cases],
    }


def write_sources() -> None:
    cases = build_cases()
    configurations = build_configurations()
    plan = document_plan(cases)

    write_json(PACK_DIR / "scenarios.json", public_cases(cases))
    write_json(PACK_DIR / "expected.json", build_expected(cases))
    write_json(
        PACK_DIR / "sources.json",
        {"schemaVersion": SCHEMA_VERSION, "libraryRoot": "Artifact/RiskFlow", "sources": SOURCES},
    )
    acceptance = build_acceptance_cases()
    acceptance["businessAcceptanceCases"] = build_business_acceptance_cases()
    write_json(PACK_DIR / "acceptance-cases.json", acceptance)
    write_json(PACK_DIR / "monitoring.json", build_monitoring(cases))
    write_json(PACK_DIR / "feedback.json", build_feedback())
    write_json(PACK_DIR / "rules" / "structured-scoring-rules.json", build_rules())
    write_json(PACK_DIR / "knowledge" / "process-model.json", build_process_model())
    write_json(PACK_DIR / "knowledge" / "risk-mechanism.json", build_risk_mechanism())
    write_json(PACK_DIR / "knowledge" / "standard-library.json", build_standard_library())
    write_json(PACK_DIR / "knowledge" / "case-library.json", build_case_library())
    for definition_type, document in configurations:
        write_json(PACK_DIR / "configurations" / f"{definition_type}.json", document)

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "packId": PACK_ID,
        "packVersion": PACK_VERSION,
        "label": LABEL,
        "labelStatus": LABEL_STATUS,
        "project": {
            "projectId": PROJECT_ID,
            "projectName": PROJECT_NAME,
            "projectRevisionRef": versioned(
                "project-revision", PROJECT_REVISION["entityId"], PROJECT_REVISION["versionId"]
            ),
            "spatialScopeRef": versioned(
                "spatial-scope", SPATIAL_SCOPE["entityId"], SPATIAL_SCOPE["versionId"]
            ),
            "sourceFamilies": sorted(split["sourceFamily"] for split in SPLITS.values()),
            "templateFamilies": sorted(split["templateFamily"] for split in SPLITS.values()),
            "synthetic": True,
        },
        "sources": "sources.json",
        "cases": "scenarios.json",
        "expected": "expected.json",
        "acceptanceCases": "acceptance-cases.json",
        "monitoring": "monitoring.json",
        "feedback": "feedback.json",
        "documents": plan,
        "configurations": [
            {"definitionType": definition_type, "file": f"configurations/{definition_type}.json"}
            for definition_type, _document in configurations
        ],
        "rules": [{"file": "rules/structured-scoring-rules.json"}],
        "knowledge": [
            {"file": "knowledge/process-model.json"},
            {"file": "knowledge/risk-mechanism.json"},
            {"file": "knowledge/standard-library.json"},
            {"file": "knowledge/case-library.json"},
        ],
    }
    write_json(PACK_DIR / "manifest.json", manifest)
    print(
        f"write-sources: cases={len(cases)} configurations={len(configurations)} documents={len(plan)}"
    )


LOG_COLUMNS = ["资料段ID", "记录时刻", "工序", "地层条件", "开挖面控制压力(kPa)", "地表沉降(mm)", "现场描述"]
LEDGER_COLUMNS = ["资料段ID", "监测指标", "参数编码", "采样时刻", "实测值", "单位"]


def log_rows(split_name: str, cases: list[dict], process: str) -> list[list[str]]:
    split = SPLITS[split_name]
    rows = []
    for case in cases:
        if case["split"] != split_name or case["processNode"] != process:
            continue
        values = case["inputs"]["observedValues"]
        rows.append(
            [
                case["inputs"]["sourceSegmentIds"][0],
                f"{split['date']}T08:00:00+08:00",
                case["processNode"],
                values["stratumGrade"],
                str(values["facePressureKpa"]),
                str(values["groundSettlementMm"]),
                case["inputs"]["inputDescription"],
            ]
        )
    return rows


def ledger_rows(split_name: str, cases: list[dict]) -> list[list[str]]:
    rows = []
    for case in cases:
        if case["split"] != split_name:
            continue
        values = case["inputs"]["observedValues"]
        indicator = case["monitoringIndicator"]
        rows.append(
            [
                case["inputs"]["sourceSegmentIds"][2],
                indicator,
                MONITORING_PARAMETERS[indicator][0],
                f"{SPLITS[split_name]['date']}T08:30:00+08:00",
                str(values["scenarioMonitoringValue"]),
                INDICATOR_SERIES[indicator]["unit"],
            ]
        )
        if indicator != "地表沉降":
            rows.append(
                [
                    case["inputs"]["sourceSegmentIds"][2],
                    "地表沉降",
                    "ground-settlement",
                    f"{SPLITS[split_name]['date']}T08:30:00+08:00",
                    str(values["groundSettlementMm"]),
                    "mm",
                ]
            )
    return rows


def write_docx(path: Path, title: str, columns: list[str], rows: list[list[str]]) -> None:
    import docx

    path.parent.mkdir(parents=True, exist_ok=True)
    document = docx.Document()
    document.add_heading(title, level=1)
    document.add_paragraph(f"{PROJECT_NAME} 合成材料，{LABEL}。本文件由 scenarios.json 投影生成。")
    table = document.add_table(rows=1, cols=len(columns))
    table.style = "Table Grid"
    for index, column in enumerate(columns):
        table.rows[0].cells[index].text = column
    for row in rows:
        cells = table.add_row().cells
        for index, value in enumerate(row):
            cells[index].text = value
    document.save(path)


def write_xlsx(path: Path, title: str, columns: list[str], rows: list[list[str]]) -> None:
    from openpyxl import Workbook

    path.parent.mkdir(parents=True, exist_ok=True)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "监测台账"
    sheet.append([title, LABEL])
    sheet.append(columns)
    for row in rows:
        sheet.append(row)
    workbook.save(path)


def write_csv(path: Path, columns: list[str], rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)
        writer.writerows(rows)


def _text_page(document, title: str, columns: list[str], rows: list[list[str]]) -> None:
    import fitz

    page = document.new_page()
    page.insert_text((40, 50), title, fontname="china-s", fontsize=12)
    page.insert_text((40, 66), LABEL, fontname="china-s", fontsize=9)
    y = 92.0
    page.insert_textbox(fitz.Rect(40, y, 555, y + 24), " | ".join(columns), fontname="china-s", fontsize=8)
    y += 28
    for row in rows:
        line = " | ".join(str(cell) for cell in row)
        rect = fitz.Rect(40, y, 555, y + 40)
        overflow = page.insert_textbox(rect, line, fontname="china-s", fontsize=7)
        if overflow > 0:
            page = document.new_page()
            page.insert_text((40, 50), f"{title}（续）", fontname="china-s", fontsize=12)
            page.insert_text((40, 66), LABEL, fontname="china-s", fontsize=9)
            rect = fitz.Rect(40, 92, 555, 132)
            page.insert_textbox(rect, line, fontname="china-s", fontsize=7)
            y = 136
        y += 44
        if y > 760:
            page = document.new_page()
            page.insert_text((40, 50), f"{title}（续）", fontname="china-s", fontsize=12)
            page.insert_text((40, 66), LABEL, fontname="china-s", fontsize=9)
            y = 92


def write_pdf(path: Path, title: str, columns: list[str], rows: list[list[str]]) -> None:
    import fitz

    path.parent.mkdir(parents=True, exist_ok=True)
    document = fitz.open()
    _text_page(document, title, columns, rows)
    document.save(path)


def write_scan_pdf(path: Path, title: str, columns: list[str], rows: list[list[str]]) -> None:
    """扫描件：先渲染成位图再嵌入，产出无文本层的 PDF（供 OCR 通路使用）。"""
    import fitz

    scratch = fitz.open()
    _text_page(scratch, title, columns, rows)
    scratch_path = path.parent / "_scan-source.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    scratch.save(scratch_path)
    scratch.close()
    rendered = fitz.open(scratch_path)
    document = fitz.open()
    for source_page in rendered:
        pixmap = source_page.get_pixmap(dpi=150)
        page = document.new_page(width=pixmap.width * 72 / 150, height=pixmap.height * 72 / 150)
        page.insert_image(page.rect, pixmap=pixmap)
    # 位图不压缩会让扫描件超过 8MiB；deflate 只改编码，不改像素内容。
    document.save(path, garbage=4, deflate=True)
    rendered.close()
    scratch_path.unlink()


def write_raster(path: Path, title: str, lines: list[str]) -> None:
    """位图：用 fitz 内置中文字体渲染（系统无中文字体，禁止依赖字体下载）。"""
    from PIL import Image
    import fitz

    scratch = fitz.open()
    page = scratch.new_page(width=595, height=420)
    page.insert_text((40, 60), title, fontname="china-s", fontsize=14)
    for index, line in enumerate(lines):
        page.insert_text((40, 110 + index * 22), line[:70], fontname="china-s", fontsize=10)
    pixmap = page.get_pixmap(dpi=150)
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    if path.suffix == ".jpeg":
        image.save(path, format="JPEG", quality=88)
    else:
        image.save(path, format="PNG")
    scratch.close()


SECTION_GEOMETRY = {
    "lines": [(60, 150, 535, 150), (70, 310, 525, 310), (200, 150, 200, 205), (180, 150, 180, 215)],
    "circles": [(200, 265, 34), (300, 245, 56)],
    "rects": [(238, 196, 124, 104)],
    "dots": [(200, 205), (180, 215), (430, 205), (460, 205), (300, 245), (240, 330)],
}

SECTION_LABELS = [
    (40, 40, f"{PROJECT_NAME} 变径段监测断面布置图（合成示意）"),
    (60, 128, "地表"),
    (150, 168, "地表沉降测点"),
    (430, 168, "支护结构变形测点"),
    (238, 190, "变径后车站断面"),
    (170, 310, "区间隧道（小直径）"),
    (368, 246, "变径后大直径断面"),
    (70, 296, "地下水位观测"),
    (300, 322, "泥水压力 / 注浆压力取样点"),
    (40, 350, "图例：细实线为量测基准线，圆点为测点；本图为合成示意，不含真实工程测量成果"),
    (40, 368, "盾构姿态参数取自掘进参数记录，未在本断面图标注"),
    (40, 386, LABEL),
]


def write_section_diagram(path: Path, split: dict) -> None:
    """监测断面示意：几何用 PIL 绘制，中文标注由 fitz 内置字体渲染后叠加。"""
    from PIL import Image, ImageDraw
    import fitz

    scale = 150 / 72
    scratch = fitz.open()
    page = scratch.new_page(width=595, height=420)
    for x, y, text in SECTION_LABELS:
        page.insert_text((x, y), text, fontname="china-s", fontsize=8 if y > 90 else 10)
    page.insert_text(
        (40, 26), f"资料家族 {split['sourceFamily']}｜工点 {split['site']}", fontname="china-s", fontsize=8
    )
    pixmap = page.get_pixmap(dpi=150)
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    draw = ImageDraw.Draw(image)
    for x1, y1, x2, y2 in SECTION_GEOMETRY["lines"]:
        draw.line([x1 * scale, y1 * scale, x2 * scale, y2 * scale], fill=(40, 40, 40), width=2)
    for x, y, radius in SECTION_GEOMETRY["circles"]:
        draw.ellipse(
            [(x - radius) * scale, (y - radius) * scale, (x + radius) * scale, (y + radius) * scale],
            outline=(20, 20, 20),
            width=2,
        )
    for x, y, width, height in SECTION_GEOMETRY["rects"]:
        draw.rectangle(
            [x * scale, y * scale, (x + width) * scale, (y + height) * scale],
            outline=(20, 20, 20),
            width=2,
        )
    for x, y in SECTION_GEOMETRY["dots"]:
        draw.ellipse(
            [(x - 3) * scale, (y - 3) * scale, (x + 3) * scale, (y + 3) * scale],
            fill=(200, 30, 30),
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG")
    scratch.close()


def write_markdown(path: Path, split_name: str, cases: list[dict]) -> None:
    split = SPLITS[split_name]
    split_cases = [case for case in cases if case["split"] == split_name]
    lines = [
        f"# {PROJECT_NAME} {split['kind']}综合工程资料（{split['sourceFamily']}）",
        "",
        f"- 标记：{LABEL}（labelStatus=candidate）",
        f"- 资料家族：{split['sourceFamily']}；模板家族：{split['templateFamily']}",
        f"- 工点：{split['site']}；记录日期：{split['date']}；班次：{split['shift']}",
        f"- 用例数：{len(split_cases)}",
        "",
        "## 工序施工记录",
        "",
        "| " + " | ".join(LOG_COLUMNS) + " |",
        "|" + "---|" * len(LOG_COLUMNS),
    ]
    for case in split_cases:
        values = case["inputs"]["observedValues"]
        lines.append(
            "| "
            + " | ".join(
                [
                    case["inputs"]["sourceSegmentIds"][0],
                    f"{split['date']}T08:00:00+08:00",
                    case["processNode"],
                    values["stratumGrade"],
                    str(values["facePressureKpa"]),
                    str(values["groundSettlementMm"]),
                    case["inputs"]["inputDescription"],
                ]
            )
            + " |"
        )
    lines += [
        "",
        "## 监测量测台账",
        "",
        "| " + " | ".join(LEDGER_COLUMNS) + " |",
        "|" + "---|" * len(LEDGER_COLUMNS),
    ]
    for row in ledger_rows(split_name, cases):
        lines.append("| " + " | ".join(row) + " |")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def method_rows(split_name: str) -> list[list[str]]:
    split = SPLITS[split_name]
    return [
        ["1.1", "适用工法", "本专项方案适用于原位变径盾构站隧一体化工程的变径段施工。"],
        [
            "1.2",
            "监测项目",
            "盾构法隧道管片结构和周围岩土体监测项目按 GB 50911-2013 第4.2.2条表4.2.2 选取，本包只登记项目名称，不复制规范数值。",
        ],
        [
            "1.3",
            "控制值适用边界",
            "GB 50911-2013 表9.2.2-2 注明确主要适用于标准断面的盾构法隧道，变径段控制值须按工程地质条件、隧道设计参数与监测等级另行确定。",
        ],
        [
            "1.4",
            "预警口径",
            "达到预警标准或实测变形值大于允许变形的2/3时进行警情报送（GB 50446-2017 第15.5.3条），本包阈值均为合成值。",
        ],
        ["2.1", "工点与班次", f"{split['site']}，{split['date']} {split['shift']}，记录类型为{split['kind']}。"],
        ["2.2", "资料段规则", "每条记录对应唯一资料段标识，编号与用例一一对应。"],
    ]


def project_formats() -> None:
    """把 scenarios.json 投影为七种文件形态与 Markdown 综合资料。"""
    scenarios = json.loads((PACK_DIR / "scenarios.json").read_text(encoding="utf-8"))
    cases = build_cases()
    if [case["caseId"] for case in cases] != [case["caseId"] for case in scenarios["cases"]]:
        raise SystemExit("scenarios.json 与生成表不一致，请先运行 --write-sources")
    manifest = json.loads((PACK_DIR / "manifest.json").read_text(encoding="utf-8"))
    for document in manifest["documents"]:
        path = PACK_DIR / document["file"]
        split_name = document["split"]
        split = SPLITS[split_name]
        kind = document["documentType"]
        if kind == "construction-log":
            process = document["documentId"].split("DOC-LOG-")[1]
            write_docx(
                path,
                f"{PROJECT_NAME} {split['kind']}（{document['documentId']}）",
                LOG_COLUMNS,
                log_rows(split_name, cases, process),
            )
        elif kind == "geology-report":
            rows = [
                [
                    case["inputs"]["sourceSegmentIds"][1],
                    case["inputs"]["observedValues"]["stratumGrade"],
                    f"DK12+{300 + index * 20:03d}",
                    "无",
                ]
                for index, case in enumerate(c for c in cases if c["split"] == split_name)
            ]
            write_scan_pdf(
                path,
                f"{PROJECT_NAME} 工程地质勘察报告（扫描件）",
                ["资料段ID", "地层条件", "里程", "溶洞"],
                rows,
            )
        elif kind == "method-statement":
            write_pdf(
                path,
                f"{PROJECT_NAME} 变径段施工专项方案（{split['sourceFamily']}）",
                ["条款号", "主题", "内容"],
                method_rows(split_name),
            )
        elif kind == "monitoring-ledger":
            write_xlsx(
                path,
                f"{PROJECT_NAME} 监测量测台账",
                LEDGER_COLUMNS,
                ledger_rows(split_name, cases),
            )
        elif kind == "monitoring-series-export":
            parameter = path.stem.replace("monitoring-", "")
            indicator = next(key for key, value in MONITORING_PARAMETERS.items() if value[0] == parameter)
            rows = [
                [
                    case["inputs"]["sourceSegmentIds"][2],
                    indicator,
                    f"{split['date']}T08:30:00+08:00",
                    str(
                        case["inputs"]["observedValues"]["groundSettlementMm"]
                        if indicator == "地表沉降"
                        else case["inputs"]["observedValues"]["scenarioMonitoringValue"]
                    ),
                    INDICATOR_SERIES[indicator]["unit"],
                ]
                for case in cases
                if case["split"] == split_name and case["monitoringIndicator"] == indicator
            ]
            write_csv(path, ["资料段ID", "监测指标", "采样时刻", "实测值", "单位"], rows)
        elif kind == "figure":
            write_section_diagram(path, split)
        elif kind == "photo":
            write_raster(
                path,
                f"{PROJECT_NAME} 现场记录照片",
                [
                    f"拍摄日期 {split['date']}",
                    f"工点 {split['site']}",
                    f"班次 {split['shift']}",
                    "注：合成图像，仅用于资料接入与图像解析通路验证",
                ],
            )
        elif kind == "engineering-summary":
            write_markdown(path, split_name, cases)
    print(f"project: documents={len(manifest['documents'])}")


def ink_ratio(image) -> float:
    grey = image.convert("L")
    pixels = grey.tobytes()
    dark = sum(1 for value in pixels if value < 200)
    return dark / (grey.size[0] * grey.size[1])


NODE_SCHEMA_CHECK = [
    'import { readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    'const repo = process.argv[3];',
    'const load = (relative) => import(pathToFileURL(join(repo, relative)).href);',
    'const assessment = await load("packages/core/dist/assessment-config/index.js");',
    'const scoring = await load("packages/core/dist/scoring-rules/index.js");',
    'const knowledgeModule = await load("packages/core/dist/identification-knowledge/index.js");',
    'const monitoringModule = await load("packages/core/dist/engineering-data/monitoring/index.js");',
    'const feedbackModule = await load("packages/core/dist/human-decision-feedback/index.js");',
    'const packDir = process.argv[2];',
    'const read = (relative) => JSON.parse(readFileSync(join(packDir, relative), "utf8"));',
    'const failures = [];',
    'const check = (label, schema, payload) => { const r = schema.safeParse(payload); if (!r.success) { failures.push(label + " " + r.error.issues.map((i) => i.path.join("/")).join(",")); } };',
    'const manifest = read("manifest.json");',
    'for (const entry of manifest.configurations) check("configuration:" + entry.definitionType, assessment.AssessmentConfigurationDocumentV1Schema, read(entry.file));',
    'for (const entry of manifest.rules) check("rules:" + entry.file, scoring.StructuredScoringRuleDocumentV1Schema, read(entry.file));',
    'const knowledge = { "knowledge/process-model.json": knowledgeModule.ProcessModelPackageV1Schema, "knowledge/risk-mechanism.json": knowledgeModule.RiskMechanismPackageV1Schema, "knowledge/standard-library.json": knowledgeModule.StandardLibraryPackageV1Schema, "knowledge/case-library.json": knowledgeModule.CaseLibraryPackageV1Schema };',
    'for (const entry of manifest.knowledge) check("knowledge:" + entry.file, knowledge[entry.file], read(entry.file));',
    'const monitoring = read("monitoring.json");',
    'monitoring.seriesRevisions.forEach((item, index) => check("monitoring:series:" + index, monitoringModule.MonitoringSeriesRevisionV1Schema, item));',
    'monitoring.batches.forEach((item, index) => check("monitoring:batch:" + index, monitoringModule.MonitoringBatchV1Schema, item));',
    'monitoring.sampleArtifacts.forEach((item, index) => check("monitoring:artifact:" + index, monitoringModule.MonitoringSampleArtifactEnvelopeV1Schema, item));',
    'monitoring.samples.forEach((item, index) => check("monitoring:sample:" + index, monitoringModule.MonitoringSampleInputV1Schema, item));',
    'const feedback = read("feedback.json");',
    'feedback.feedbackInputs.forEach((item, index) => check("feedback:" + index, feedbackModule.HumanFeedbackInputSnapshotRowV1Schema, item));',
    'if (failures.length > 0) { console.error(failures.join("\\n")); process.exit(1); }',
    'console.log("node-schema-check ok configurations=" + manifest.configurations.length + " rules=" + manifest.rules.length + " knowledge=" + manifest.knowledge.length + " series=" + monitoring.seriesRevisions.length + " batches=" + monitoring.batches.length + " samples=" + monitoring.samples.length + " feedback=" + feedback.feedbackInputs.length);',
]


def run_node_schema_check() -> None:
    script_path = Path("/tmp/synthetic-schema-check.mjs")
    script_path.write_text("\n".join(NODE_SCHEMA_CHECK) + "\n", encoding="utf-8")
    result = subprocess.run(
        ["node", str(script_path), str(PACK_DIR), str(REPO_ROOT)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        return ["生产 Schema 校验失败（BLOCKED：先构建 packages/core/dist）"]
    return []


def check() -> None:
    """读回全部材料并断言内容与数量；不复用内存中的生成结果。"""
    import fitz

    failures: list[str] = []

    def require(condition: bool, message: str) -> None:
        if not condition:
            failures.append(message)

    manifest = json.loads((PACK_DIR / "manifest.json").read_text(encoding="utf-8"))
    scenarios = json.loads((PACK_DIR / manifest["cases"]).read_text(encoding="utf-8"))
    expected = json.loads((PACK_DIR / manifest["expected"]).read_text(encoding="utf-8"))
    monitoring = json.loads((PACK_DIR / manifest["monitoring"]).read_text(encoding="utf-8"))
    feedback = json.loads((PACK_DIR / manifest["feedback"]).read_text(encoding="utf-8"))
    acceptance = json.loads((PACK_DIR / manifest["acceptanceCases"]).read_text(encoding="utf-8"))
    sources = json.loads((PACK_DIR / manifest["sources"]).read_text(encoding="utf-8"))

    cases = scenarios["cases"]
    development = [case for case in cases if case["split"] == "development"]
    trial = [case for case in cases if case["split"] == "trial-run"]
    require(len(development) == 12, f"开发用例数应为 12，实际 {len(development)}")
    require(len(trial) == 60, f"试运行用例数应为 60，实际 {len(trial)}")
    require(manifest["label"] == LABEL and manifest["labelStatus"] == LABEL_STATUS, "标记字段不正确")

    expected_by_case = {item["caseId"]: item for item in expected["cases"]}
    require(len(expected_by_case) == len(cases), "expected.json 未覆盖全部用例")
    for case in cases:
        entry = expected_by_case[case["caseId"]]
        allowed = MECHANISM_NODES[entry["candidateMechanismType"]]
        require(
            any(node.endswith(case["processNode"]) for node in allowed),
            f"{case['caseId']} 工序 {case['processNode']} 不在机理 {entry['candidateMechanismType']} 的适用节点内",
        )
        values = case["inputs"]["observedValues"]
        breached = threshold_breached("地表沉降", values["groundSettlementMm"]) or threshold_breached(
            case["monitoringIndicator"], values["scenarioMonitoringValue"]
        )
        if entry["candidateLabel"] == "negative":
            require(
                not breached,
                f"{case['caseId']} 负例的实测值触发了预警阈值，不能充当负例",
            )
            require(
                entry["candidateExpectation"] == "no-risk-record-for-target-mechanism"
                and "candidateLikelihoodScore" not in entry
                and "candidateRiskEvent" not in entry
                and "candidateExternalRiskComparison" in entry,
                f"{case['caseId']} 负例预期形态不正确",
            )
        else:
            require(
                entry["candidateExpectation"] == "risk-record-present"
                and isinstance(entry["candidateLikelihoodScore"], (int, float))
                and isinstance(entry["candidateConsequenceScore"], (int, float))
                and entry["candidateRiskLevel"] in {"level-1", "level-2", "level-3", "level-4"},
                f"{case['caseId']} 正例缺少候选评分或等级",
            )
    for mechanism, _event, _observation in MECHANISMS:
        dev_positive = [
            case
            for case in development
            if expected_by_case[case["caseId"]]["candidateMechanismType"] == mechanism
            and expected_by_case[case["caseId"]]["candidateLabel"] == "positive"
        ]
        trial_positive = [
            case
            for case in trial
            if expected_by_case[case["caseId"]]["candidateMechanismType"] == mechanism
            and expected_by_case[case["caseId"]]["candidateLabel"] == "positive"
        ]
        trial_negative = [
            case
            for case in trial
            if expected_by_case[case["caseId"]]["candidateMechanismType"] == mechanism
            and expected_by_case[case["caseId"]]["candidateLabel"] == "negative"
        ]
        require(len(dev_positive) == 1, f"{mechanism} 开发正例应为 1，实际 {len(dev_positive)}")
        require(len(trial_positive) == 5, f"{mechanism} 试运行正例应为 5，实际 {len(trial_positive)}")
        require(len(trial_negative) == 5, f"{mechanism} 试运行负例应为 5，实际 {len(trial_negative)}")

    require(
        {case["processNode"] for case in cases} == set(PROCESS_NODES),
        "五工序覆盖不完整",
    )
    require(
        {case["monitoringIndicator"] for case in cases} == set(MONITORING_INDICATORS),
        "六类监测覆盖不完整",
    )
    require(
        {case["applicability"]["constructionMethod"] for case in cases}
        | {case["applicability"]["stratumCondition"] for case in cases}
        | {case["applicability"]["engineeringStage"] for case in cases}
        == set(STRATA) | {"原位变径盾构"} | set(PROCESS_NODES),
        "三适用维度取值不完整",
    )

    development_families = {case["sourceFamily"] for case in development}
    trial_families = {case["sourceFamily"] for case in trial}
    require(
        not development_families & trial_families,
        "开发与试运行共用资料家族",
    )
    require(
        {case["templateFamily"] for case in development}
        != {case["templateFamily"] for case in trial},
        "开发与试运行共用模板家族",
    )
    development_documents = {
        document["documentId"] for document in manifest["documents"] if document["split"] == "development"
    }
    trial_documents = {
        document["documentId"] for document in manifest["documents"] if document["split"] == "trial-run"
    }
    require(not development_documents & trial_documents, "开发与试运行共用资料文件")
    for case in cases:
        expected_split = "development" if case["split"] == "development" else "trial-run"
        require(
            all(
                reference
                in (development_documents if expected_split == "development" else trial_documents)
                for reference in case["inputs"]["documentRefs"]
            ),
            f"{case['caseId']} 引用了其它集合的资料文件",
        )

    segments = [segment for case in cases for segment in case["inputs"]["sourceSegmentIds"]]
    require(len(segments) == len(set(segments)), "资料段标识存在重复")
    leaked = {"candidateLabel", "candidateRiskEvent", "candidateMechanismType", "polarity", "riskEvent"}
    require(
        not leaked & set(cases[0].keys()) and not leaked & set(cases[0]["inputs"].keys()),
        "scenarios.json 混入候选答案字段",
    )
    require(
        len({case["inputs"]["inputDescription"] for case in cases}) == len(cases),
        "输入描述存在整段复用",
    )
    require(
        len({case["inputs"]["observedValues"]["stratumGrade"] for case in cases}) == len(STRATA),
        "地层取值未覆盖",
    )

    require(len(manifest["configurations"]) == 11, f"配置应为 11 类，实际 {len(manifest['configurations'])}")
    require(len(sources["sources"]) == 8, f"来源登记应为 8 条，实际 {len(sources['sources'])}")
    for source in sources["sources"]:
        for key in ("id", "path", "locator", "explicitFact", "applicability", "uncertainty"):
            require(bool(source.get(key)), f"来源 {source.get('id')} 缺{key}")
    require(
        {source["id"] for source in sources["sources"]}
        == {"STD-001", "STD-002", "STD-003", "ENG-001", "ENG-003", "ENG-177", "ENG-201", "ENG-212"},
        "来源标识集合不正确",
    )
    require(len(acceptance["acceptanceCases"]) >= 6, "异常验收用例过少")
    require(
        all(
            item["expectedOutcome"] == "rejected" and item["detailCode"]
            for item in acceptance["acceptanceCases"]
        ),
        "异常验收用例缺少预期失败码",
    )
    business = acceptance.get("businessAcceptanceCases", [])
    require(len(business) >= 17, f"业务验收用例应至少 17 条，实际 {len(business)}")
    matrix_rows = [row for row in business if row["category"] == "risk-matrix"]
    require(len(matrix_rows) >= 9, "矩阵映射样本不足")
    covered_cells = {
        (row["deterministicExpectation"]["possibilityBandId"], row["deterministicExpectation"]["consequenceBandId"])
        for row in matrix_rows
        if "possibilityBandId" in row["deterministicExpectation"]
    }
    require(len(covered_cells) == 6, "矩阵 6 个单元格未全覆盖")
    closed_upper = [
        row
        for row in matrix_rows
        if row["input"]["likelihoodScore"] == 5.0
        and row["deterministicExpectation"].get("possibilityBandId") == "p-band-3"
    ]
    require(bool(closed_upper), "末带上界闭合语义缺失（P=5.0 应落在 p-band-3）")
    require(
        any(
            row["input"]["likelihoodScore"] > 5.0
            and row["deterministicExpectation"].get("outcome") == "rejected"
            for row in matrix_rows
        ),
        "缺少越界拒绝样本",
    )
    require(
        all(
            row["input"]
            and row["deterministicExpectation"]
            and row["evidence"]
            and row["executionStatus"] == "not-executed"
            for row in business
        ),
        "业务验收用例缺少输入、确定性预期、证据或未执行标记",
    )
    require(len(feedback["feedbackInputs"]) == 6, "反馈输入应为 6 条")

    configurations = [
        json.loads((PACK_DIR / entry["file"]).read_text(encoding="utf-8"))
        for entry in manifest["configurations"]
    ]
    mapping = next(item for item in configurations if item["definitionType"] == "indicator-field-mapping")
    targets = [item["targetIndicatorId"] for item in mapping["content"]["mappings"]]
    require(len(targets) == len(set(targets)), "同一指标存在多条字段映射")
    require(
        all(item["sourceUnit"] == item["targetUnit"] for item in mapping["content"]["mappings"]),
        "字段映射存在物理单位不一致",
    )
    matrix = next(item for item in configurations if item["definitionType"] == "risk-matrix")
    require(
        len(matrix["content"]["possibilityAxis"]["bands"]) == 3
        and len(matrix["content"]["consequenceAxis"]["bands"]) == 2
        and len(matrix["content"]["cells"]) == 6,
        "风险矩阵不是 3×2 形状",
    )
    thresholds = next(
        item for item in configurations if item["definitionType"] == "monitoring-warning-threshold"
    )
    require(
        all(item["unit"] and item["comparison"] for item in thresholds["content"]["thresholds"]),
        "监测阈值缺少单位或比较边界",
    )
    knowledge_evidence = []
    for entry in manifest["knowledge"]:
        package = json.loads((PACK_DIR / entry["file"]).read_text(encoding="utf-8"))
        evidence = json.dumps(package, ensure_ascii=False)
        for source in sources["sources"]:
            require(source["id"] not in evidence, f"知识包 {entry['file']} 混入真实来源标识 {source['id']}")
        knowledge_evidence.append(evidence)
    require("synthetic-knowledge-evidence-v1" in knowledge_evidence[0], "知识包证据引用不是合成引用")

    formats = {}
    for document in manifest["documents"]:
        path = PACK_DIR / document["file"]
        require(path.exists(), f"缺少资料文件 {document['file']}")
        if not path.exists():
            continue
        formats.setdefault(document["format"], []).append(document)
        case_ids = document["caseIds"]
        split_cases = [case for case in cases if case["split"] == document["split"]]
        log_cases = [
            case
            for case in split_cases
            if document["documentType"] == "construction-log"
            and case["processNode"] == document["documentId"].split("DOC-LOG-")[1]
        ]
        indicator = None
        if document["documentType"] == "monitoring-series-export":
            parameter = path.stem.replace("monitoring-", "")
            indicator = next(
                key for key, value in MONITORING_PARAMETERS.items() if value[0] == parameter
            )
        ledger_cases = [
            case
            for case in split_cases
            if document["documentType"] == "monitoring-ledger" and case["caseId"] in set(case_ids)
        ]
        if document["format"] == "docx":
            import docx

            table = docx.Document(path).tables[0]
            require(len(table.rows) == len(log_cases) + 1, f"{document['file']} 行数与用例数不符")
            if log_cases:
                require(
                    {row.cells[0].text for row in table.rows[1:]}
                    == {case["inputs"]["sourceSegmentIds"][0] for case in log_cases},
                    f"{document['file']} 资料段标识集合与用例不符",
                )
                require(
                    table.rows[1].cells[6].text == log_cases[0]["inputs"]["inputDescription"],
                    f"{document['file']} 现场描述与用例输入不一致",
                )
        elif document["format"] == "xlsx":
            from openpyxl import load_workbook

            sheet = load_workbook(path).active
            expected_rows = sum(2 if case["monitoringIndicator"] != "地表沉降" else 1 for case in ledger_cases)
            require(sheet.max_row == expected_rows + 2, f"{document['file']} 行数与用例数不符")
            require(
                {sheet.cell(row=row, column=1).value for row in range(3, sheet.max_row + 1)}
                == {case["inputs"]["sourceSegmentIds"][2] for case in ledger_cases},
                f"{document['file']} 资料段标识集合与用例不符",
            )
        elif document["format"] == "csv":
            with path.open(encoding="utf-8") as handle:
                rows = list(csv.reader(handle))
            csv_cases = [
                case
                for case in split_cases
                if indicator is not None and case["monitoringIndicator"] == indicator
            ]
            require(len(rows) == len(csv_cases) + 1, f"{document['file']} 行数与用例数不符")
            require(
                {row[0] for row in rows[1:]}
                == {case["inputs"]["sourceSegmentIds"][2] for case in csv_cases},
                f"{document['file']} 资料段标识集合与用例不符",
            )
            require(
                all(row[1] == indicator for row in rows[1:]),
                f"{document['file']} 监测指标列与文件不符",
            )
        elif document["format"] == "pdf":
            scanned = document["documentType"] == "geology-report"
            reader = fitz.open(path)
            text = "".join(page.get_text() for page in reader)
            if scanned:
                require(text.strip() == "", f"{document['file']} 扫描件不应含文本层")
                require(
                    all(page.get_images() for page in reader),
                    f"{document['file']} 扫描件缺少位图",
                )
                from PIL import Image, ImageChops

                reference = fitz.open()
                _text_page(
                    reference,
                    f"{PROJECT_NAME} 工程地质勘察报告（扫描件）",
                    ["资料段ID", "地层条件", "里程", "溶洞"],
                    [
                        [
                            case["inputs"]["sourceSegmentIds"][1],
                            case["inputs"]["observedValues"]["stratumGrade"],
                            f"DK12+{300 + index * 20:03d}",
                            "无",
                        ]
                        for index, case in enumerate(c for c in cases if c["split"] == document["split"])
                    ],
                )
                require(
                    reader.page_count == reference.page_count,
                    f"{document['file']} 页数与源排版不一致",
                )
                for index in range(min(reader.page_count, reference.page_count)):
                    scan_pixmap = reader[index].get_pixmap(dpi=36)
                    reference_pixmap = reference[index].get_pixmap(dpi=36)
                    scan_image = Image.frombytes(
                        "RGB", (scan_pixmap.width, scan_pixmap.height), scan_pixmap.samples
                    )
                    reference_image = Image.frombytes(
                        "RGB",
                        (reference_pixmap.width, reference_pixmap.height),
                        reference_pixmap.samples,
                    )
                    require(
                        ink_ratio(scan_image) > 0.002,
                        f"{document['file']} 第 {index + 1} 页内容过少",
                    )
                    difference = ImageChops.difference(scan_image, reference_image).convert("L")
                    mean_difference = sum(difference.tobytes()) / len(difference.tobytes())
                    require(
                        mean_difference < 12,
                        f"{document['file']} 第 {index + 1} 页与源排版差异过大",
                    )
                reference.close()
            else:
                require(len(reader) >= 1, f"{document['file']} 无页面")
                require("GB 50911-2013" in text, f"{document['file']} 缺少适用边界说明")
                require(LABEL in text, f"{document['file']} 缺少合成标记")
                tail = method_rows(document["split"])[-1][-1]
                require(tail in text, f"{document['file']} 正文尾部被截断：{tail}")
            reader.close()
        elif document["format"] in {"png", "jpeg"}:
            from PIL import Image

            with Image.open(path) as image:
                require(image.width > 400 and image.height > 300, f"{document['file']} 尺寸异常")
                require(ink_ratio(image) > 0.01, f"{document['file']} 图像内容过少")
        elif document["format"] == "md":
            text = path.read_text(encoding="utf-8")
            require(LABEL in text, f"{document['file']} 缺少合成标记")
            require(
                all(case["inputs"]["sourceSegmentIds"][0] in text for case in split_cases),
                f"{document['file']} 缺少用例记录",
            )

    require(
        set(formats) == {"docx", "pdf", "xlsx", "csv", "png", "jpeg", "md"},
        f"文件形态不完整：{sorted(formats)}",
    )
    require(len(formats["pdf"]) == 4, "PDF 形态数量不正确")
    require(len(formats["csv"]) == 12, "CSV 形态数量不正确")

    for name in (
        "README.md",
        "资料分析.md",
        "验收用例.md",
        "追踪矩阵.md",
        "待甲方输入与开发缺口.md",
    ):
        require((PACK_DIR / name).exists(), f"缺少中文文档 {name}")

    failures.extend(run_node_schema_check())

    if failures:
        for message in failures:
            print(f"FAIL {message}")
        raise SystemExit(f"check 失败：{len(failures)} 项")
    print(
        f"check ok: cases={len(cases)} documents={len(manifest['documents'])} "
        f"configurations={len(manifest['configurations'])} sources={len(sources['sources'])} "
        f"samples={len(monitoring['samples'])} feedback={len(feedback['feedbackInputs'])}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="RiskFlow 合成材料生成与自检")
    parser.add_argument("--write-sources", action="store_true", help="写出材料包 JSON")
    parser.add_argument("--check", action="store_true", help="读回全部材料并断言")
    arguments = parser.parse_args()
    if arguments.write_sources:
        write_sources()
        return
    if arguments.check:
        check()
        return
    project_formats()


if __name__ == "__main__":
    main()
