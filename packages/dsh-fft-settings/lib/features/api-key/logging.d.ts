/**
 * 本 feature 写日志用的最小接口（规格 §6/§7：失败不低于 `warn`，可变值放字段）。
 *
 * 只声明用得到的 `warn`，因此 cordis 的具名 logger（`ctx.logger()` 无参 = 插件名）
 * 可以结构化地传进来，而单元测试直接构造 service 时不传 logger 也就保持静默——
 * 日志是**可选依赖**，不是必需接线。
 *
 * 约定：
 * - 第二参数字段化，绝不放 API Key/token 的值；
 * - 消息文本保持稳定（采集器按 `(插件, 级别, 消息, 稳定字段)` 在 10 秒窗口内合并）；
 * - 失败级别不低于 `warn`，不用 `debug`。
 */
export interface FeatureLogger {
    warn(message: string, fields?: Record<string, unknown>): void;
}
