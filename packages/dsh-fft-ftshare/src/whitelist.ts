/**
 * `ftshare_*` 白名单：本底座注册给模型的 FTShare 直连工具。
 *
 * 选品口径有两条，都很硬：
 *
 * 1. **不重复 `dsh_kline` 已有的能力**。行情、K 线、技术指标、板块联动、
 *    市场脉搏、自选清单都由 `mcp__dsh-kline__*` 提供，这里一条都不列。
 * 2. **入参形状必须在本仓已有验证**。每个条目下方注释写明参数是从哪次既有调用
 *    抄来的；没有验证过的入参宁可不注册，也不猜一个字段名让上游报错。
 *
 * 白名单是显式的静态清单：网关有几百个工具，全量注册会把模型的选择空间灌满，
 * 也会把「大概能用」的接口暴露成「看起来能用」。
 * @module @ft/dsh-fft-ftshare/whitelist
 */

import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

/** 白名单中的一个条目：上游工具名 + 注册到 `ctx.tools` 的名字与入参。 */
export interface FtshareWhitelistEntry {
  /** 上游 FTShare 网关工具名。 */
  tool: string
  /** 注册到 `ctx.tools` 的名字，形如 `ftshare_*`。 */
  name: string
  /** 中文短标题，用于工具描述首行。 */
  title: string
  /** 模型可见描述。 */
  description: string
  /** 入参规格，交给 `defineTool` 编译。 */
  parameters: ParameterSchemaSpec
}

/** 常用入参文案。 */
const STOCK_CODE = 'A 股代码，可带或不带市场后缀（如 600519 / 600519.SH）'
const DATE_COMPACT = '交易日，格式 YYYYMMDD'

/**
 * 白名单本体。顺序即模型看到的顺序：先用得上的排前面。
 */
export const FTSHARE_TOOL_WHITELIST: readonly FtshareWhitelistEntry[] = [
  {
    // 入参取自投研舱 `ftshare-data.ts` 的利润表调用：`{ stock_code: bareStockSymbol(symbol) }`。
    tool: 'ft_v1_finance_income',
    name: 'ftshare_finance_income',
    title: '利润表',
    description: '读取个股利润表（营收、净利等）历史期数。用于基本面与盈利质量分析。',
    parameters: {
      stock_code: { type: 'string', description: STOCK_CODE, required: true },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts`：`{ stock_code: bareStockSymbol(symbol) }`。
    tool: 'ft_v1_finance_balance',
    name: 'ftshare_finance_balance',
    title: '资产负债表',
    description: '读取个股资产负债表历史期数。用于资产结构与偿债能力分析。',
    parameters: {
      stock_code: { type: 'string', description: STOCK_CODE, required: true },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts` 的现金流量表调用。
    tool: 'ft_v1_finance_cashflow',
    name: 'ftshare_finance_cashflow',
    title: '现金流量表',
    description: '读取个股现金流量表历史期数。用于现金流与经营质量分析。',
    parameters: {
      stock_code: { type: 'string', description: STOCK_CODE, required: true },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts` 的估值调用：`{ symbol, start_date, end_date, page, page_size }`。
    tool: 'ft_v1_eastmoney_stock_valuation',
    name: 'ftshare_stock_valuation',
    title: '个股估值',
    description: '读取个股估值时间序列（PE、PB 等）。区间按交易日给，单次最多一页。',
    parameters: {
      symbol: { type: 'string', description: '带市场后缀的证券代码，如 600519.SH', required: true },
      start_date: { type: 'string', description: `区间起（${DATE_COMPACT}）` },
      end_date: { type: 'string', description: `区间止（${DATE_COMPACT}）` },
      page: { type: 'number', description: '页码，默认 1' },
      page_size: { type: 'number', description: '每页条数，默认 30' },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts` 的 Beta 调用：`{ stock_code, trade_date }`。
    tool: 'ft_v1_beta_snapshot',
    name: 'ftshare_beta_snapshot',
    title: '风险暴露（Beta）',
    description: '读取个股某交易日的 Beta 快照。免费档接口，优先于多窗口版本。',
    parameters: {
      stock_code: { type: 'string', description: STOCK_CODE, required: true },
      trade_date: { type: 'string', description: `交易日（${DATE_COMPACT}）` },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts` 的首选 Beta 候选：`{ symbol, trade_date }`。
    tool: 'ft_v2_risk_beta',
    name: 'ftshare_risk_beta',
    title: '风险暴露（多窗口 Beta）',
    description: '读取个股多窗口 Beta（1 年 / 2 年 / 100 周）。需要基础版及以上订阅。',
    parameters: {
      symbol: { type: 'string', description: '带市场后缀的证券代码，如 600519.SH', required: true },
      trade_date: { type: 'string', description: `交易日（${DATE_COMPACT}）` },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts` 的两融调用：`{ stock, date }`。
    tool: 'ft_v1_margin_trading_details',
    name: 'ftshare_margin_trading',
    title: '融资融券明细',
    description: '读取全市场某交易日的两融明细，可按标的筛选。用于杠杆资金观察。',
    parameters: {
      stock: { type: 'string', description: '带市场后缀的证券代码，如 600519.SH', required: true },
      date: { type: 'string', description: `交易日（${DATE_COMPACT}）`, required: true },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts` 的研报调用：`{ type: 'StockReport', stock_code, page, page_size }`。
    tool: 'ft_v3_report_stock_reports',
    name: 'ftshare_stock_reports',
    title: '券商研报',
    description: '读取个股研报列表（标题、机构、观点摘要）。需要基础版及以上订阅。',
    parameters: {
      stock_code: { type: 'string', description: STOCK_CODE, required: true },
      type: { type: 'string', description: '研报类型，个股研报用 StockReport' },
      page: { type: 'number', description: '页码，默认 1' },
      page_size: { type: 'number', description: '每页条数，默认 30' },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts` 的公告首选候选：`{ type: 'stock', stock_code, page, page_size }`。
    tool: 'ft_v3_announcements_stock_announcements',
    name: 'ftshare_stock_announcements',
    title: '个股公告',
    description: '按标的代码读取最新公告历史（标题、时间、链接）。需要基础版及以上订阅。',
    parameters: {
      stock_code: { type: 'string', description: STOCK_CODE, required: true },
      type: { type: 'string', description: '查询模式，按代码查用 stock' },
      page: { type: 'number', description: '页码，默认 1' },
      page_size: { type: 'number', description: '每页条数，默认 30' },
    },
  },
  {
    // 入参取自投研舱 `ftshare-data.ts` 的公告降级候选：`{ date, sec_code, page, page_size }`。
    tool: 'ft_v1_report_announcement_list',
    name: 'ftshare_announcements_by_date',
    title: '公告（按日期）',
    description: '按交易日读取全市场公告列表，可按证券代码筛选。免费档接口，是个股公告不可用时的降级路径。',
    parameters: {
      sec_code: { type: 'string', description: STOCK_CODE },
      date: { type: 'string', description: `交易日（${DATE_COMPACT}）` },
      page: { type: 'number', description: '页码，默认 1' },
      page_size: { type: 'number', description: '每页条数，默认 30' },
    },
  },
]

/** 按 `ftshare_*` 名字反查白名单条目。 */
export const FTSHARE_TOOL_BY_NAME: ReadonlyMap<string, FtshareWhitelistEntry> = new Map(
  FTSHARE_TOOL_WHITELIST.map(entry => [entry.name, entry]),
)
