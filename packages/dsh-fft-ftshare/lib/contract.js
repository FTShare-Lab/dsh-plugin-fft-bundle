/**
 * `@ft/dsh-fft-ftshare/contract` —— FTShare 公用底座的冻结契约。
 *
 * 消费方只需要 `import type { FtshareMarketService } from '@ft/dsh-fft-ftshare/contract'`，
 * 不依赖本包的实现、传输层或 MCP SDK。本模块只有类型与常量，没有运行时依赖，
 * 因此宿主插件与测试都能安全引用。
 *
 * 设计要点是 **三态归一**：FTShare 网关把「真的没有数据」「套餐无权限（403
 * route_not_allowed）」「取数失败」三种情况都表现为「空」，调用方若只判断空数组就
 * 会把「无权限」误读成「没有数据」。{@link FtshareCallResult.state} 强制区分这四种
 * 结局，并把权限提示挂在 {@link FtshareCallResult.notice} 上。
 * @module @ft/dsh-fft-ftshare/contract
 */
/** 服务在 cordis `Context` 上的名字，也是 `ctx.provide` 的键。 */
export const FTSHARE_MARKET_SERVICE = 'ftshareMarket';
/** 用户可升级订阅的页面，{@link FtshareNotice.upgradeUrl} 的默认值。 */
export const FTSHARE_UPGRADE_URL = 'https://ftai.chat/me/profile?tab=subscription';
//# sourceMappingURL=contract.js.map