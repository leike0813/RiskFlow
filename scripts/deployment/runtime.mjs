#!/usr/bin/env node
/**
 * C37 D-20：生产组合根的宿主装配。
 *
 * 三条硬约束：
 * 1. 五类 Agent 任务共用同一个 AgentTaskDefinitionRegistry 与同一持久任务集合，
 *    不新增第二任务表；
 * 2. C20↔C21、C17↔C20 是构造引用环，不是业务流程环——宿主用只绑定一次的窄委派解开，
 *    绑定前任何调用都抛未就绪错误；
 * 3. 必需 option 缺失时构造失败并释放已创建资源，不以永真、空仓储或 harness SQL 冒充。
 *
 * 本模块只组合 apps/api 与 apps/worker 的公开入口，不导入 core/adapters 私文件。
 */

/** 宿主尚未绑定委派时，任何调用都必须失败关闭。 */
export class DeploymentCompositionNotReadyError extends Error {
  constructor(capability) {
    super(`deployment composition is not bound: ${capability}`);
    this.name = "DeploymentCompositionNotReadyError";
    this.capability = capability;
  }
}

export class DeploymentCompositionIncompleteError extends Error {
  constructor(missing) {
    super(`deployment composition is missing required dependencies: ${missing.join(", ")}`);
    this.name = "DeploymentCompositionIncompleteError";
    this.missing = Object.freeze([...missing]);
  }
}

/**
 * 只绑定一次的窄委派槽。
 *
 * 绑定前调用抛未就绪；重复绑定同一目标直接抛错，避免运行期悄悄换实现。
 */
export class SingleBindingV1 {
  #capability;
  #target;
  #bound = false;

  constructor(capability) {
    this.#capability = capability;
  }

  get capability() {
    return this.#capability;
  }

  get isBound() {
    return this.#bound;
  }

  bind(target) {
    if (this.#bound) {
      throw new TypeError(`deployment binding is already closed: ${this.#capability}`);
    }
    this.#target = target;
    this.#bound = true;
    return target;
  }

  use(...args) {
    if (!this.#bound || this.#target === undefined) {
      throw new DeploymentCompositionNotReadyError(this.#capability);
    }
    return this.#target(...args);
  }

  useMethod(name, ...args) {
    if (!this.#bound || this.#target === undefined) {
      throw new DeploymentCompositionNotReadyError(`${this.#capability}.${name}`);
    }
    const method = this.#target[name];
    if (typeof method !== "function") {
      throw new DeploymentCompositionNotReadyError(`${this.#capability}.${name}`);
    }
    return method.apply(this.#target, args);
  }
}

/** C37 五类共享 Agent 任务；registry 必须按同一顺序注册这五类。 */
import { AgentTaskTypeV1Schema } from "../../packages/contracts/dist/ports/index.js";

export const SHARED_AGENT_TASK_KINDS_V1 = Object.freeze([...AgentTaskTypeV1Schema.options]);

/**
 * 组装期必需依赖清单。
 *
 * 缺项一律构造失败：宿主不得用永真 provider、任意 execute、空仓储或 harness SQL 补位。
 */
export const REQUIRED_PRODUCTION_DEPENDENCIES_V1 = Object.freeze([
  "database",
  "transactionUnit",
  "checkpointer",
  "access",
  "artifactStore",
  "referenceGuard",
  "modelGateway",
  "ocr",
  "review",
  "idempotentConsumer",
  "agentTaskRegistry",
  "policyCatalog",
  "qualityGate",
]);

/**
 * 校验必需依赖是否齐备且不是占位实现。
 * 返回缺失清单；空数组表示可以继续组装。
 */
export const missingProductionDependenciesV1 = (providers) => {
  const missing = [];
  for (const name of REQUIRED_PRODUCTION_DEPENDENCIES_V1) {
    const value = providers[name];
    if (value === undefined || value === null) {
      missing.push(name);
    }
  }
  return Object.freeze(missing);
};

/** 组装期必须创建且在失败时释放的资源。 */
export class CompositionResourcesV1 {
  #closers = [];

  register(closer) {
    this.#closers.push(closer);
  }

  async releaseAll() {
    const closers = this.#closers.splice(0, this.#closers.length).reverse();
    const failures = [];
    for (const close of closers) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "DEPLOYMENT_RESOURCE_CLOSE_FAILED");
  }

  get size() {
    return this.#closers.length;
  }
}

/**
 * 生产组合根装配器。
 *
 * 装配顺序遵循 D-20：C15/共享 registry/C17 → C20 → C21 → C22/C23/C24 → C25…C30；
 * 委派最后一次性绑定。全部绑定核验后才允许监听与 claim。
 */
export class ProductionCompositionRootV1 {
  constructor(providers) {
    const missing = missingProductionDependenciesV1(providers);
    if (missing.length > 0) throw new DeploymentCompositionIncompleteError(missing);
    this.providers = Object.freeze({ ...providers });
    this.resources = new CompositionResourcesV1();
    /** C17→C20 的窄委派：绑定一次，绑定前不可用。 */
    this.knowledgeRetrievalDelegate = new SingleBindingV1("knowledge.retrieval");
    /** C20→C21 的窄委派：绑定一次，绑定前不可用。 */
    this.identificationQueryInputDelegate = new SingleBindingV1("identification.queryInput");
  }

  /**
   * 一次性绑定委派。宿主在所有组合根建立完成后调用；
   * 任一委派重复绑定都失败，防止运行期替换实现。
   */
  bindDelegates(delegates) {
    this.knowledgeRetrievalDelegate.bind(delegates.knowledgeRetrieval);
    this.identificationQueryInputDelegate.bind(delegates.identificationQueryInput);
    return this;
  }

  /** 监听/claim 前的就绪核验：所有委派必须已绑定。 */
  assertReady() {
    const unbound = [this.knowledgeRetrievalDelegate, this.identificationQueryInputDelegate]
      .filter((slot) => !slot.isBound)
      .map((slot) => slot.capability);
    if (unbound.length > 0) {
      throw new DeploymentCompositionNotReadyError(unbound.join(","));
    }
    return this;
  }

  async close() {
    await this.resources.releaseAll();
  }
}
