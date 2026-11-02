/**
 * preset 平面：把接口表里带 `expose` 的条目注册成 `ctx.tools` 里的 `ftshare_*` 工具，
 * 外加一个长尾入口 `ftshare_call` 与一个失败现场入口 `ftshare_status`。
 *
 * 由 preset 行以子路径名 `@dsh-ft/dsh-fft-ftshare/tools` 挂载，因此这些工具只存在于
 * 所选 preset 的 agent 作用域内（标准模式下不存在）。取数走全局平面提供的
 * `ctx.ftshareData`，本平面不开连接、不碰凭据；`ftshare_status` 只读进程内账本，
 * 不联网。
 *
 * 每个工具都把 {@link FtshareCallResult} 的四态结局原样印进正文：`denied` 说
 * 「无权访问」，`empty` 才说「没有记录」。这是 P8 的教训——两种结局不能长得一样。
 * @module @dsh-ft/dsh-fft-ftshare/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { FTSHARE_CAPABILITIES } from './capabilities.js';
import { catalogEntryOf, missingRequiredArgs } from './catalog.js';
import { FTSHARE_CATALOG_INDEX_PATH, loadCatalog } from './catalog-host.js';
import { isRecord } from './errors.js';
import { renderCallResult } from './project.js';
import { statusStore } from './status.js';
export * from './capabilities.js';
export * from './catalog.js';
/** Cordis 插件名。 */
export const name = '@dsh-ft/dsh-fft-ftshare/tools';
/** 注册工具要 `tools`，取数要全局 plane 的 `ftshareData`。 */
export const inject = ['tools', 'ftshareData'];
/**
 * 工具的规范化输出：渲染好的正文加四态结局。
 *
 * 结局单独留一个字段，是为了让 `presentResult` 之类的消费者将来能按状态取样式，
 * 而不必再解析正文。
 */
const outputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        tool: { type: 'string' },
        state: { type: 'string' },
        text: { type: 'string' },
    },
};
/** 所有 `ftshare_*` 工具共用的输出：正文加四态结局。 */
const toolOutput = {
    schema: outputSchema,
    render: (_args, value) => [{ type: 'text', text: value.text ?? '' }],
};
/** 接口表里要下发给模型的那部分（其余条目只供本仓程序调用）。 */
export const FTSHARE_EXPOSED_CAPABILITIES = FTSHARE_CAPABILITIES.filter(entry => entry.expose !== undefined);
/** 长尾接口的通用直调工具名。 */
export const FTSHARE_CALL_TOOL = 'ftshare_call';
/** 失败现场查询工具名。 */
export const FTSHARE_STATUS_TOOL = 'ftshare_status';
/**
 * 注册接口表里每一个暴露条目，外加通用直调与失败现场查询。
 * @param ctx - preset 子树的上下文。
 */
export function apply(ctx) {
    for (const entry of FTSHARE_EXPOSED_CAPABILITIES)
        register(ctx, entry);
    registerCatalogTool(ctx);
    registerStatusTool(ctx);
}
/**
 * 注册单个接口表条目。
 * @param ctx - preset 子树的上下文。
 * @param entry - 带 `expose` 的接口表条目。
 */
function register(ctx, entry) {
    const exposed = entry.expose;
    if (exposed === undefined)
        return;
    ctx.tools.register(defineTool({
        name: exposed.name,
        description: `${entry.title}。${exposed.description}`,
        parameters: entry.args,
        output: toolOutput,
        async execute(args, exec) {
            const result = await ctx.ftshareData.call(entry.interface, (args ?? {}), { signal: exec.signal });
            return { tool: entry.interface, state: result.state, text: renderCallResult(entry.title, entry.interface, result) };
        },
    }));
}
/**
 * 注册通用直调：`ftshare_call(interface, args)`。
 *
 * 它是长尾接口的唯一入口——一个工具定义换掉 250 份 schema。三种结局各有各的话：
 * 名字不在目录（给出索引文件路径，让模型去 `grep`，而不是猜第二个名字）、套餐无权
 * （由 {@link renderCallResult} 带上升级入口）、上游原文（由 notice 直传）。
 * @param ctx - preset 子树的上下文。
 */
function registerCatalogTool(ctx) {
    ctx.tools.register(defineTool({
        name: FTSHARE_CALL_TOOL,
        description: `直调 FTShare 目录里的任意接口。不要猜接口名：先在 ${FTSHARE_CATALOG_INDEX_PATH} 里 grep `
            + '（一行一个接口，格式 `接口名 | 标题 | 入参名`，带 * 的是必填），目录之外的名字会被拒绝。',
        parameters: {
            interface: { type: 'string', description: '上游接口名，必须来自目录索引', required: true },
            args: { type: 'object', additionalProperties: true, description: '接口入参；必填项见目录索引里带 * 的名字' },
        },
        output: toolOutput,
        async execute(args, exec) {
            const call = isRecord(args) ? args : {};
            const interfaceName = typeof call.interface === 'string' ? call.interface.trim() : '';
            const callArgs = isRecord(call.args) ? call.args : {};
            const entry = catalogEntryOf(loadCatalog(), interfaceName);
            if (entry === undefined) {
                return {
                    tool: interfaceName,
                    state: 'failed',
                    text: `目录里没有接口 ${interfaceName === '' ? '（未给名字）' : interfaceName}，不能直调。`
                        + `先在 ${FTSHARE_CATALOG_INDEX_PATH} 里 grep 一下：一行一个接口，格式「接口名 | 标题 | 入参名」。`,
                };
            }
            const missing = missingRequiredArgs(entry, callArgs);
            if (missing.length > 0) {
                return {
                    tool: entry.name,
                    state: 'failed',
                    text: `缺必填入参：${missing.join('、')}。${entry.name} 的必填项见目录索引里带 * 的名字。`,
                };
            }
            const result = await ctx.ftshareData.call(entry.name, callArgs, { signal: exec.signal });
            return { tool: entry.name, state: result.state, text: renderCallResult(entry.title, entry.name, result) };
        },
    }));
}
/**
 * 注册失败现场查询：只读进程内账本，不联网。
 *
 * 用户问「为什么取不到」时，模型需要的是「同一个失败打了几次、首末时间、原文」，
 * 而不是再打一次上游。
 * @param ctx - preset 子树的上下文。
 */
function registerStatusTool(ctx) {
    ctx.tools.register(defineTool({
        name: FTSHARE_STATUS_TOOL,
        description: '查看 FTShare 最近的失败聚合（指纹、次数、首末时间、上游原文）与目录漂移；不联网、不消耗配额。',
        parameters: {},
        output: toolOutput,
        async execute() {
            return { tool: FTSHARE_STATUS_TOOL, state: 'available', text: renderStatus() };
        },
    }));
}
/**
 * 渲染失败账本。
 * @returns 模型可见文本。
 */
export function renderStatus() {
    const snapshot = statusStore.snapshot();
    const lines = [`FTShare 失败聚合（进程内，自 ${snapshot.since} 起共 ${snapshot.totalFailures} 次）`];
    if (snapshot.failures.length === 0) {
        lines.push('暂无失败记录。');
    }
    else {
        const shown = snapshot.failures.slice(0, 10);
        for (const [index, record] of shown.entries()) {
            const facts = [`×${record.count}`, record.state, record.tool];
            if (record.code !== undefined)
                facts.push(`码 ${record.code}`);
            if (record.status !== undefined)
                facts.push(`HTTP ${record.status}`);
            lines.push(`${index + 1}. ${facts.join(' · ')}`);
            lines.push(`   首次 ${record.firstAt} · 末次 ${record.lastAt} · 最近耗时 ${record.lastDurationMs} ms`);
            lines.push(`   指纹 ${record.fingerprint}`);
            lines.push(`   原文 ${record.message}`);
        }
        if (snapshot.failures.length > shown.length)
            lines.push(`（共 ${snapshot.failures.length} 个指纹，只列前 ${shown.length} 个）`);
    }
    const catalog = snapshot.catalog;
    const live = catalog.liveCount === undefined
        ? '上游清单未拉取'
        : `上游 ${catalog.liveCount} 条（${catalog.liveHash}）${catalog.changed === true ? '，与随包不一致' : '，与随包一致'}`;
    lines.push(`目录：随包 ${catalog.shippedCount} 条（${catalog.shippedHash}）；${live}`);
    return lines.join('\n');
}
//# sourceMappingURL=tools.js.map