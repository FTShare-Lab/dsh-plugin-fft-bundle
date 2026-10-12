/**
 * `$DSH_HOME` 解析（Host 侧）。
 *
 * 与 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome` 语义一致：显式配置 → `$DSH_HOME` →
 * `~/.dsh`。此处自己实现，避免为一个纯路径函数新增运行时依赖与锁文件改动。
 */
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import { LOGS_DIR_SEGMENTS } from './contract.js';
export const DSH_HOME_ENV = 'DSH_HOME';
export const DSH_HOME_DIR_NAME = '.dsh';
/** 解析 DSH 根目录；空白 `$DSH_HOME` 视为未设置，`~` 前缀按官方语义展开。 */
export function resolveDshHome(env = process.env) {
    const configured = env[DSH_HOME_ENV]?.trim();
    if (configured)
        return resolve(expandHomePath(configured));
    return join(homedir(), DSH_HOME_DIR_NAME);
}
/** 面向用户的展示形式：默认目录写 `~/.dsh`，自定义目录写 `$DSH_HOME`。 */
export function displayDshHome(home) {
    return normalize(home) === normalize(join(homedir(), DSH_HOME_DIR_NAME)) ? '~/.dsh' : '$DSH_HOME';
}
/** 展开 `~`、`~/`、`~\` 前缀；不做其他 shell 展开。 */
export function expandHomePath(value, home = homedir()) {
    if (value === '~')
        return home;
    if (value.startsWith('~/') || value.startsWith('~\\'))
        return join(home, value.slice(2));
    return value;
}
/** 解析配置里的来源路径为绝对路径（相对路径按当前工作目录）。 */
export function resolveSourcePath(value, home = homedir()) {
    const expanded = expandHomePath(value, home);
    return isAbsolute(expanded) ? normalize(expanded) : resolve(expanded);
}
/** 日志目录：`$DSH_HOME/logs/ft`。 */
export function logsDirectory(home = resolveDshHome()) {
    return join(home, ...LOGS_DIR_SEGMENTS);
}
