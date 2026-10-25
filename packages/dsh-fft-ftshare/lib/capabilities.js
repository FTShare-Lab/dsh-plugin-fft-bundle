/**
 * 接口表（capability table）：本底座承接并对外提供的上游接口，人工策展。
 *
 * 与**目录**（`catalog.json`，上游全量快照）不是一回事：目录回答「上游有什么」，
 * 接口表回答「我们承接什么」。两条准入判据：
 *
 * 1. **有本仓调用点**，记在 {@link Capability.provenance}；
 * 2. **不与 `dsh_kline` 的保留工具面重复** —— 行情、K 线、指标、板块联动、市场
 *    脉搏、自选仍归 kline，这里只放它没有的能力。
 *
 * 上游接口名必须能在目录里找到（守护测试断言），不在目录就当不可调：不猜别名，
 * 也不按版本前缀推断订阅档位（见 {@link ./errors.ts} 与设计文档附录 B）。
 * @module @dsh-ft/dsh-fft-ftshare/capabilities
 */
/** 常用入参文案。 */
const STOCK_CODE = 'A 股代码，支持 6 位纯代码、.SH/.SZ/.BJ 短后缀或 .XSHG/.XSHE/.BJSE 长后缀';
const DATE_COMPACT = '交易日，格式 YYYYMMDD';
const SYMBOL = '带市场后缀的证券代码，如 600519.SH';
/** 投研舱的取数模块；接口表里绝大多数条目由它调用。 */
const COCKPIT_DATA = 'packages/dsh-fft-research-cockpit/src/ftshare-data.ts';
/** 投研舱的研报/公告取数模块。 */
const COCKPIT_REPORT = 'packages/dsh-fft-research-cockpit/src/report-data.ts';
/**
 * 接口表本体。顺序即模型看到的顺序：先用得上的排前面。
 */
export const FTSHARE_CAPABILITIES = [
    {
        id: 'finance_income',
        title: '利润表',
        interface: 'ft_v1_finance_income',
        args: { stock_code: { type: 'string', description: STOCK_CODE, required: true } },
        expose: {
            name: 'ftshare_finance_income',
            description: '读取个股利润表（营收、净利等）历史期数。用于基本面与盈利质量分析。',
        },
        provenance: `${COCKPIT_DATA}#loadSnapshot`,
    },
    {
        id: 'finance_balance',
        title: '资产负债表',
        interface: 'ft_v1_finance_balance',
        args: { stock_code: { type: 'string', description: STOCK_CODE, required: true } },
        expose: {
            name: 'ftshare_finance_balance',
            description: '读取个股资产负债表历史期数。用于资产结构与偿债能力分析。',
        },
        provenance: `${COCKPIT_DATA}#loadSnapshot`,
    },
    {
        id: 'finance_cashflow',
        title: '现金流量表',
        interface: 'ft_v1_finance_cashflow',
        args: { stock_code: { type: 'string', description: STOCK_CODE, required: true } },
        expose: {
            name: 'ftshare_finance_cashflow',
            description: '读取个股现金流量表历史期数。用于现金流与经营质量分析。',
        },
        provenance: `${COCKPIT_DATA}#loadSnapshot`,
    },
    {
        id: 'stock_valuation',
        title: '个股估值',
        interface: 'ft_v1_eastmoney_stock_valuation',
        args: {
            symbol: { type: 'string', description: SYMBOL, required: true },
            start_date: { type: 'string', description: `区间起（${DATE_COMPACT}）` },
            end_date: { type: 'string', description: `区间止（${DATE_COMPACT}）` },
            page: { type: 'number', description: '页码，默认 1' },
            page_size: { type: 'number', description: '每页条数，默认 30' },
        },
        expose: {
            name: 'ftshare_stock_valuation',
            description: '读取个股估值时间序列（PE、PB 等）。区间按交易日给，单次最多一页。',
        },
        provenance: `${COCKPIT_DATA}#loadSnapshot`,
    },
    {
        id: 'margin_trading',
        title: '融资融券明细',
        interface: 'ft_v1_margin_trading_details',
        args: {
            stock: { type: 'string', description: SYMBOL, required: true },
            date: { type: 'string', description: `交易日（${DATE_COMPACT}）`, required: true },
        },
        expose: {
            name: 'ftshare_margin_trading',
            description: '读取全市场某交易日的两融明细，可按标的筛选。用于杠杆资金观察。',
        },
        provenance: `${COCKPIT_DATA}#loadSnapshot`,
    },
    {
        id: 'stock_reports',
        title: '券商研报',
        interface: 'ft_v2_report_stock_reports',
        args: {
            stock_code: { type: 'string', description: STOCK_CODE, required: true },
            type: { type: 'string', description: '研报类型；按代码查只能用 StockReport', enum: ['StockReport'] },
            page: { type: 'integer', description: '页码，上游必填，从 1 开始', required: true },
            page_size: { type: 'integer', description: '每页条数，上游必填，1 到 500', required: true },
        },
        expose: {
            name: 'ftshare_stock_reports',
            description: '读取个股研报列表（标题、机构、观点摘要）。日期区间最多 3 天，页码必填。',
        },
        provenance: `${COCKPIT_DATA}#loadSnapshot, ${COCKPIT_REPORT}#announcementCallSpecs`,
    },
    {
        id: 'stock_announcements',
        title: '个股公告',
        interface: 'ft_v2_announcements_stock_announcements',
        args: {
            stock_code: { type: 'string', description: STOCK_CODE, required: true },
            type: { type: 'string', description: '查询类型，当前只支持 stock', enum: ['stock'], required: true },
            start_date: { type: 'string', description: `${DATE_COMPACT}，仅支持单日` },
            page: { type: 'integer', description: '页码，上游必填，从 1 开始', required: true },
            page_size: { type: 'integer', description: '每页条数，上游必填，1 到 500', required: true },
        },
        expose: {
            name: 'ftshare_stock_announcements',
            description: '按标的代码读取最新公告历史（标题、时间、链接）。',
        },
        provenance: `${COCKPIT_REPORT}#announcementCallSpecs`,
    },
    {
        id: 'announcements_by_date',
        title: '公告（按日期）',
        interface: 'ft_v1_report_announcements_list',
        args: {
            date: { type: 'string', description: `公告日期（${DATE_COMPACT}）`, required: true },
            sec_code: { type: 'string', description: STOCK_CODE },
            page: { type: 'integer', description: '页码，缺省 1' },
            page_size: { type: 'integer', description: '每页条数，缺省 200，上限 500' },
        },
        expose: {
            name: 'ftshare_announcements_by_date',
            description: '按交易日读取全市场公告列表，可按证券代码筛选。',
        },
        provenance: `${COCKPIT_DATA}#loadRecentAnnouncements, ${COCKPIT_REPORT}#announcementCallSpecs`,
    },
];
/** 按模型工具名反查接口表条目（只有带 `expose` 的条目才在表内）。 */
export const FTSHARE_CAPABILITY_BY_TOOL = new Map(FTSHARE_CAPABILITIES.flatMap(entry => entry.expose === undefined ? [] : [[entry.expose.name, entry]]));
/** 按上游接口名反查接口表条目。 */
export const FTSHARE_CAPABILITY_BY_INTERFACE = new Map(FTSHARE_CAPABILITIES.map(entry => [entry.interface, entry]));
//# sourceMappingURL=capabilities.js.map