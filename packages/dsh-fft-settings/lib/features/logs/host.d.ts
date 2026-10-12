/**
 * `logs` 命名空间 Host 半边：常驻采集器 + 导出器。
 *
 * 采集器在 `create()` 里**无条件启动**（`apply()` 期注册即执行，与设置页是否渲染无关）；
 * exporter 由 cordis 绑定当前 fiber，另用 `ctx.effect` 明确关闭文件句柄与队列。
 *
 * 工厂化：dev 的接缝里 `create(ctx)` 不再收配置，模块由 `apply()` 用一个闭包把
 * 已解析的 `logs` 配置带进来（`createLogsModule(logsConfig)`）。这样采集器仍然在
 * 注册期、而不是等到设置页打开才启动。
 */
import { type SettingsModule } from '../../core/module-registry.js';
import { type LogsSettings } from './contract.js';
import type { LogsConfig } from './config.js';
/**
 * 构建 `logs` 模块：把已解析的配置闭包进 `create`。
 * @param config - 本 feature 的 `logs` 配置（`resolveLogsConfig` 的输出，永远完整）。
 * @returns 可交给 `ctx.ftshareSettings.modules.register` 的模块。
 */
export declare function createLogsModule(config: LogsConfig): SettingsModule<'logs', LogsSettings>;
