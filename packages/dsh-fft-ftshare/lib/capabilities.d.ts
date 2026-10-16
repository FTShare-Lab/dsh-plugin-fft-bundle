/**
 * 接口表（capability table）：本底座承接并对外提供的上游接口，人工策展。
 *
 * 与**目录**（`catalog.json`，上游全量快照）不是一回事：目录回答「上游有什么」，
 * 接口表回答「我们承接什么」。两条准入判据：
 *
 * 1. **有本仓调用点**，记在 {@link Capability.provenance}；
 * 2. **不与 `dsh_kline` 的保留工具面重复** —— 行情、K 线、指标、板块联动、市场
 *    脉搏、自选仍归 kline，这里只放它没有的能力。
 *
 * 上游接口名必须能在目录里找到（守护测试断言），不在目录就当不可调：不猜别名，
 * 也不按版本前缀推断订阅档位（见 {@link ./errors.ts} 与设计文档附录 B）。
 * @module @ft/dsh-fft-ftshare/capabilities
 */
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools';
/** 接口表里的一条：一个上游接口，外加我们给它的本地身份与暴露方式。 */
export interface Capability {
    /** 内部能力名，例如 `finance_income`；本仓引用时用它，避免散落上游接口名。 */
    id: string;
    /** 中文短标题，模型工具描述的首行。 */
    title: string;
    /** 上游接口名，1:1，且必须在 `catalog.json` 内。 */
    interface: string;
    /** 入参：抄自上游 `inputSchema` 并做一次人工收敛（去掉本仓用不到的字段）。 */
    args: ParameterSchemaSpec;
    /** 有则注册成模型工具；没有则只供本仓程序调用。 */
    expose?: {
        /** 模型工具名，形如 `ftshare_*`。 */
        name: string;
        /** 模型可见描述。 */
        description: string;
    };
    /**
     * 本仓调用点。记的是**文件与符号**而不是行号：行号每次重构即失效，也没有任何
     * 守护测试能核实它，`path#symbol` 才是能被复核的定位。
     */
    provenance: string;
}
/**
 * 接口表本体。顺序即模型看到的顺序：先用得上的排前面。
 */
export declare const FTSHARE_CAPABILITIES: readonly Capability[];
/** 按模型工具名反查接口表条目（只有带 `expose` 的条目才在表内）。 */
export declare const FTSHARE_CAPABILITY_BY_TOOL: ReadonlyMap<string, Capability>;
/** 按上游接口名反查接口表条目。 */
export declare const FTSHARE_CAPABILITY_BY_INTERFACE: ReadonlyMap<string, Capability>;
//# sourceMappingURL=capabilities.d.ts.map