/**
 * `logs` feature 配置（规格 §10）：`level` / `maxBytes` / `keep` / `sources`，全部有安全默认值，
 * 不配置也能正常挂载。
 *
 * 子 schema 归 feature 所有：本文件导出 `logs` 这一片的原生 Schemastery schema 与默认值，
 * 插件入口 `src/index.ts` 只负责把它组合进插件的顶层 `Config`。新增 feature 的配置同理，
 * 不要往这里塞别人的字段。
 *
 * `logsConfigSchema` 必须是**原生 Schemastery schema**，不能用任何手写的 Standard Schema 冒充：
 * DSH 配置收集器的判定是
 * `Reflect.get(value, Symbol.for('schemastery')) === true && typeof Reflect.get(value, 'type') === 'string'`
 * （`packages/boot/app-boot/src/config-schema/native.ts`）。不满足会得到
 * `entry.status='unsupported'` 与一条 `Config is not a native Schemastery schema` 的
 * **error** 诊断、`x-cordis.complete: false`，`logs.*` 进不了 profile 的配置 schema 与配置编辑器。
 * 运行时 cordis 只要求 Standard Schema（`vendor/cordis/src/fiber.ts` 的 `resolveConfig`
 * 读 `Config['~standard'].validate`），所以能跑不等于能加载。
 *
 * 校验失败时 cordis 抛 `ValidationError`、**插件整体不挂载**：写错 `level` 或给出越界数值
 * 都会让插件消失，这是刻意的（配置错误要响，而不是静默回退到别的级别）。
 * 下面的 `parseLogsConfig` / `resolveLogsConfig` 只是给绕过 cordis 校验的调用方（测试、
 * 直接调用 `apply`）准备的**内部兜底**：容错、夹紧数值，不是配置的真相来源，
 * 也不参与 DSH 的 schema 收集。
 */
import z from '@deepseek-ai/schemastery';
import { type LogsConfigLevel } from './contract.js';
export interface LogsConfig {
    /** `warn`（默认，error+info+warn）｜`debug`（含 debug）。不提供 `info` 档，见 `./contract.ts`。 */
    level: LogsConfigLevel;
    /** 单文件上限，超过即轮转。 */
    maxBytes: number;
    /** 轮转文件保留份数。 */
    keep: number;
    /** 导出时一并打包的额外来源：文件路径或目录（目录取最近的 `*.log`）。 */
    sources: string[];
}
export declare const DEFAULT_LOGS_CONFIG: LogsConfig;
/**
 * `logs` 这一片的原生 Schemastery schema（`src/index.ts` 的顶层 `Config` 组合它）。
 *
 * 两点不可省：
 * 1. `.default()` 必须带默认值对象 —— 无参写法在 Schemastery 里不生效；
 * 2. 无配置行时 cordis 传的是 `{}` 而不是 `undefined`，靠 `validate` 补齐全部默认值
 *    （`validate(undefined)` 与 `validate({})` 结果一致）。因此不要在 `apply` 的参数默认值上
 *    兜底，见 `index.ts`。
 */
export declare const logsConfigSchema: z<Schemastery.ObjectS<NoInfer<{
    level: z<"warn" | "debug", "warn" | "debug", "defined">;
    maxBytes: z<number, number, "defined">;
    keep: z<number, number, "defined">;
    sources: z<string[], string[], "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    level: z<"warn" | "debug", "warn" | "debug", "defined">;
    maxBytes: z<number, number, "defined">;
    keep: z<number, number, "defined">;
    sources: z<string[], string[], "defined">;
}>>, "defined">;
/**
 * 内部兜底解析：非法组合不抛错，回落到默认值/夹紧；`level` 写错才报 issue
 * （写错级别等于静默丢日志）。入参是整个插件配置，只取 `input.logs` 这一片；
 * 只在绕过 cordis 校验时使用。
 */
export declare function parseLogsConfig(input: unknown): {
    value: LogsConfig;
} | {
    issues: {
        message: string;
    }[];
};
/** 取值：解析结果永远是完整配置，调用方不再做空值判断。 */
export declare function resolveLogsConfig(input: unknown): LogsConfig;
