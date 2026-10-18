# DOCX 标准字符引用修复提案

状态：用户已于2026-10-14授权修复并继续。官网 process-model 转换已返回 done 和 ZIP，原响应及诊断经真实C04完整读取。规范化失败为 MINERU_MIDDLE_INVALID / docx-source-text-mismatch：源文本3562字符、服务文本2362字符。原DOCX有240个标准 `&quot;`，每个编码比正文字符多5字节，恰好解释1200字符差异。

根因：既有 parsers.ts 的 XML_OPTIONS 禁用 processEntities，collectXmlText 未解码标准XML字符引用。官网正确返回引号，本地源结构核对把字符编码当正文，导致合法DOCX拒绝。

拟仅修改 `packages/adapters/src/engineering-data/document-conversion/parsers.ts` 及既有 DOCX/MinerU 测试：解析标准XML预定义及数字字符引用，继续拒绝 DTD/ENTITY、外部引用与原有资源限制。优先复用现有XML库能力；若其开关同时放开其它实体，则只在文本读取边界解码标准引用。不关闭源文本一致性或质量门槛，不重写原文以避开缺陷。

已同步design D-33、施工图及文档转换delta。文本边界解码标准引用，CDATA按字面读取；41项回归及16份正式治理来源转换通过，原失败保留，见 [取证记录](visible-read-and-docx-2026-10-14.md)。治理清洗遇到新的模型输入/恢复阻塞，范围外公共契约、依赖或迁移仍升级。
