# 置信度实例策略修正（D-92）

v97第五次公共继续返回500/TERMINAL_FAILURE，有界驱动已退出，没有后续请求。logs/validation-progress-v97-after-stop.log正式回读证明五个工作项I5完成、failedWorkItemRefs为空，I6已提交merge-plan@6e65ec9b88cbaf8c6a56a36329d9db6b79e0bc8897653934922239cbdacaafe1；父终态版本e3073a6f73c10fb9324fdcd5be61f7ce11cedfa301dcd39a091851acf1a512ad，子I7终态版本1fe5ef09ccf2347d35b4627829199deb1ea57146030ed0664a18c1d19e622c5f。

probe-i7-route-v97.mjs使用当前授权、原精确I6及真实C04读取，在模型、工件put、复核请求、登记与事务写入处安装拒绝屏障。logs/i7-route-v97-readonly.log中原工作计划、两个路由策略、五份校验集和第一个目标组均可读取，业务结果为required-basis-unavailable:multi-source-merge；任何写屏障均未触发，无模型/领域补写。判定器需断言可到复核写屏障，而非真正成功，以保持复现只读。

原策略要求多来源合并依据且任一缺项阻断，合法单候选no-duplicate组因此无法路由；零权重且未声明的仿真也会被block拒绝。主规格和核心测试明确规定缺必需依据必须拒绝，计算实现保持。修正只作用于新隔离策略，范围及数值以design D-92为准。

preview-confidence-policy-d92.mjs通过原C04读取全部15组和五份校验集：旧策略15组均blocked，新显式缺项策略15组均computed，所有组forcedReviewReason保持且未参与依据贡献为0。结果为business-chain-v97/confidence-policy-preview-d92.json与logs/confidence-policy-preview-d92-2.log。首个诊断误写validation用途码被C04拒绝，已复用唯一用途常量，失败日志保留，无工件/领域补写。

既有置信度回归4/4通过（/tmp/riskflow-d92-confidence-regression.log）。v98配置/目录strict及正文差异自检、tar比较通过并已生产启动，随后同策略沿v99/v100保留。D-92不改源码；v97终态不复活，尚未取得新批次I7正式结果，此稿不计I7或业务全链PASS。
