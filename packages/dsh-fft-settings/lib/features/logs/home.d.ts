/**
 * `$DSH_HOME` 解析（Host 侧）。
 *
 * 与 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome` 语义一致：显式配置 → `$DSH_HOME` →
 * `~/.dsh`。此处自己实现，避免为一个纯路径函数新增运行时依赖与锁文件改动。
 */
export declare const DSH_HOME_ENV = "DSH_HOME";
export declare const DSH_HOME_DIR_NAME = ".dsh";
/** 解析 DSH 根目录；空白 `$DSH_HOME` 视为未设置，`~` 前缀按官方语义展开。 */
export declare function resolveDshHome(env?: Readonly<Record<string, string | undefined>>): string;
/** 面向用户的展示形式：默认目录写 `~/.dsh`，自定义目录写 `$DSH_HOME`。 */
export declare function displayDshHome(home: string): string;
/** 展开 `~`、`~/`、`~\` 前缀；不做其他 shell 展开。 */
export declare function expandHomePath(value: string, home?: string): string;
/** 解析配置里的来源路径为绝对路径（相对路径按当前工作目录）。 */
export declare function resolveSourcePath(value: string, home?: string): string;
/** 日志目录：`$DSH_HOME/logs/ft`。 */
export declare function logsDirectory(home?: string): string;
