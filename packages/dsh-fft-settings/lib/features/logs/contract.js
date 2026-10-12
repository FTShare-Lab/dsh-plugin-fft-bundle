/**
 * `logs` 命名空间的共享契约：只有常量与类型，浏览器半边可以安全导入。
 *
 * 采集器（Host 常驻）与导出器（设置页）通过文件解耦；本文件是两者唯一的共同语言。
 */
/**
 * 卡片在 `ftshare.settings.card` 槽位里的 id 与 order。
 *
 * 归 feature 所有（与业务契约同一份来源）：卡片组件与浏览器侧的守卫测试都读它，
 * order 20 排在 API Key 卡（10）之后。
 */
export const LOGS_CARD_ID = 'logs';
export const LOGS_CARD_ORDER = 20;
/** 显式登记的 RPC 方法；未登记的方法一律 `not_found`。 */
export const LOGS_METHODS = ['stats', 'preview', 'export'];
/**
 * 配置级别 → cordis `levels.default` 数值。
 *
 * cordis 的 `levels` 是**接收上限**而不是下限：`targetLevel < level` 才丢弃。
 * 因此 `warn`(2) 收 error/info/warn，`debug`(3) 收全部，`info`(1) 会把 `warn` 丢掉。
 */
export const LOG_LEVEL_THRESHOLD = { error: 0, info: 1, warn: 2, debug: 3 };
export const LOG_LEVEL_NAMES = ['warn', 'info', 'debug', 'error'];
/**
 * 可配置的级别（规格 §10）。
 *
 * 不提供 `info` 档：`levels` 是接收上限，`info`(1) 会把 `warn`(2) 一起丢掉，与规格 §6
 * 「失败日志不低于 warn」冲突；`error`(0) 同样不成立（等于只剩 error）。允许值收敛为
 * `warn | debug`，档位越界由 Schemastery 直接拒绝（插件不挂载），不做静默夹紧。
 */
export const LOGS_CONFIG_LEVELS = ['warn', 'debug'];
/** 落盘位置：`$DSH_HOME/logs/ft/`。 */
export const LOGS_DIR_SEGMENTS = ['logs', 'ft'];
export const LOGS_CURRENT_FILE = 'current.log';
export const LOGS_ROTATED_PREFIX = 'ft-';
export const LOGS_FILE_SUFFIX = '.log';
export const LOGS_LINE_MAX_BYTES = 8 * 1024;
export const LOGS_TRUNCATED_MARK = '...[已截断]';
export const LOGS_REPEAT_FIELD = '重复次数';
export const LOGS_THROTTLE_WINDOW_MS = 10_000;
export const LOGS_MAX_PENDING_KEYS = 2_000;
export const LOGS_MAX_FIELD_LENGTH = 2_000;
export const LOGS_MAX_FIELD_DEPTH = 3;
export const LOGS_DEFAULT_PREVIEW_LINES = 80;
export const LOGS_MAX_PREVIEW_LINES = 200;
export const LOGS_PREVIEW_MAX_BYTES = 256 * 1024;
/** 导出体积上限（规格 §9）：单来源 2 MiB、合计 8 MiB、目录最多 20 个 `*.log`。 */
export const LOGS_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
export const LOGS_EXPORT_MAX_BYTES = 8 * 1024 * 1024;
export const LOGS_MAX_SOURCE_FILES = 20;
export const LOGS_EXPORT_FILE_PREFIX = 'ft-runtime-';
export const LOGS_SECRET_TTL_MS = 5_000;
/**
 * 诊断包路由（规格 §9 / §12 决策 3）：`/api` 载体上的第二条精确路由，归 `logs` feature 所有。
 *
 * 卡片用 `<a download>` 直接指向它：浏览器同源 GET 自带凭据，不需要 fetch/Blob，
 * `/api` 前缀的鉴权由载体负责，本 feature 不重复鉴权、也不读任何请求参数。
 * 它随 owner fiber 释放（`ctx.effect` + `register` 返回的 disposer）。
 */
export const LOGS_ARCHIVE_ROUTE = '/api/ftshare-settings/logs.zip';
/** 归档内固定条目名（`manifest.json` 永远排第一）。 */
export const LOGS_ARCHIVE_MANIFEST = 'manifest.json';
export const LOGS_ARCHIVE_LOG = 'ft-runtime.log';
/** 额外来源原文的目录前缀：`sources/<n>-<basename>`。 */
export const LOGS_ARCHIVE_SOURCE_DIR = 'sources/';
/** 导出 header 里的来源段落分隔标记。 */
export const LOGS_SECTION_RULE = '=====';
