/**
 * `@dsh-ft/dsh-fft-ftshare/contract` —— FTShare 公用底座的冻结契约。
 *
 * 消费方只需要 `import type { FtshareDataService } from '@dsh-ft/dsh-fft-ftshare/contract'`，
 * 不依赖本包的实现、传输层或 MCP SDK。本模块只有类型与常量，没有运行时依赖，
 * 因此宿主插件与测试都能安全引用。
 *
 * 设计要点是 **四态归一**：FTShare 网关把「真的没有数据」「上游拒绝（401/403）」
 * 「取数失败」三种情况都表现为「空」，调用方若只判断空数组就会把「拒绝」误读成
 * 「没有数据」。{@link FtshareCallResult.state} 强制区分这四种结局。
 *
 * 失败说明（{@link FtshareNotice}）只**抄上游事实**：码、HTTP 状态、原文、重试提示。
 * 本包不翻译、不归因、不编造 remedy；是不是配额、要不要升级，由原文与消费方判断。
 * @module @dsh-ft/dsh-fft-ftshare/contract
 */
/** 服务在 cordis `Context` 上的名字，也是 `ctx.provide` 的键。 */
export const FTSHARE_DATA_SERVICE = 'ftshareData';
/**
 * 跨平面通路的精确路由：浏览器侧的 `createFtshareClient` POST 到这里，宿主侧的
 * `registerFtshareRoute` 在这里应答。走 `connection.fetch` 的 `/api` 载体，因此
 * Host/Origin 围栏与浏览器鉴权由载体负责。
 */
export const FTSHARE_DATA_ROUTE = '/api/ftshare-data';
/** 用户可升级订阅的页面，{@link FtshareNotice.upgradeUrl} 的默认值（仅 `denied` 带）。 */
export const FTSHARE_UPGRADE_URL = 'https://ftai.chat/me/profile?tab=subscription';
//# sourceMappingURL=contract.js.map