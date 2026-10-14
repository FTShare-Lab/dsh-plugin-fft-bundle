/**
 * 宿主平面入口：本包的**纯载体**行，只承载浏览器半。
 *
 * DSH 只从**根 loader** 的 entries 组合 `window.__DSH_BOOT__`
 * （`packages/client/modules/src/index.ts`），而 preset 把自己的行挂在脱离
 * `ctx.loader.entries()` 的子树里；所以浏览器半（报告卡、会话「报告」视图、
 * 侧栏 tab）必须由一行**裸包名**的全局行来承载。
 *
 * 该行不得声明 `inject`：扫描要求 `entry.fiber !== undefined`，带 inject 的行
 * 会先等待服务、拿不到 fiber，浏览器半照样扫不到。工具注册因此全部移到
 * `./agent.ts`（preset 行以 `@ft/dsh-fft-research-cockpit/agent` 挂载）。
 * @module @ft/dsh-fft-research-cockpit
 */
export const name = 'FT 投研舱（浏览器半载体）';
export function apply(_ctx) {
    // 刻意留空：本行只让扫描看到本包，不注册任何工具或服务。
}
export { Config } from './config.js';
//# sourceMappingURL=index.js.map