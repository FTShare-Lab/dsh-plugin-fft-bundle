/**
 * 出站传输：到 FTShare 网关的 StreamableHTTP MCP 会话。
 *
 * 两件事值得记下来：
 *
 * 1. **凭据只从 `ctx.ftshareSettings.apiKey.resolve()` 取**，绝不自己读
 *    `~/.dsh/.credentials.yaml`。设置服务是凭据的唯一入口，它还要负责把「用户
 *    在设置页填的 Key」和「环境变量回退」按同一优先级合起来；绕过它就会出现
 *    「设置页显示已配置、实际取数用的是另一个 Key」这类无法排查的分歧。
 * 2. **每次调用开一个新会话**（`initialize` → `callTool` → `close`）。会话里带
 *    着凭据，缓存会话就等于缓存秘密，而设置契约要求「每次操作重新 resolve」；
 *    连接成本换正确性是划算的，这条与投研舱的既有做法一致。
 * @module @ft/dsh-fft-ftshare/transport
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { asText, isRecord } from './errors.js';
/** 默认网关地址：FTShare 的 MCP StreamableHTTP 入口。 */
export const FTSHARE_GATEWAY_ENDPOINT = 'https://market.ft.tech/gateway/mcp';
/** 承载 API Key 的请求头名。 */
export const FTSHARE_API_KEY_HEADER = 'FTSHARE_API_KEY';
/**
 * 从 MCP 调用的错误结果里取出可读文本。
 * @param content - `callTool` 返回的 content 数组。
 * @param fallback - 取不到文本时的说明。
 * @returns 多块文本以换行拼接。
 */
function errorTextFromContent(content, fallback) {
    if (!Array.isArray(content))
        return fallback;
    const text = content
        .filter((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
        .trim();
    return text === '' ? fallback : text;
}
/**
 * 选一次调用的结构化载荷：优先 `structuredContent`，缺失时退回把文本当 JSON 解析。
 *
 * `dsh-kline` 两个都给；只给文本的上游也不该被判成空结果。
 * @param result - `callTool` 的返回。
 * @param tool - 工具名，仅用于日志。
 * @param logger - 具名 logger。
 * @returns 结构化载荷；两者都没有时为 undefined。
 */
function payloadOf(result, tool, logger) {
    const record = isRecord(result) ? result : {};
    if (isRecord(record.structuredContent))
        return record.structuredContent;
    const text = errorTextFromContent(record.content, '');
    if (text !== '' && /^[[{]/u.test(text)) {
        try {
            return JSON.parse(text);
        }
        catch {
            logger?.warn('ftshare.invalid_json_payload', { tool });
        }
    }
    return record.structuredContent ?? undefined;
}
/**
 * 建一个到 FTShare 网关的传输层。
 * @param options - 见 {@link FtshareTransportOptions}。
 * @returns 传输层实现。
 */
export function createFtshareTransport(options) {
    const endpoint = options.endpoint?.trim() || FTSHARE_GATEWAY_ENDPOINT;
    const clientName = options.clientName ?? 'dsh-fft-ftshare';
    const clientVersion = options.clientVersion ?? '0.1.0';
    /**
     * 开一个已握手的会话；调用方负责关闭。
     * @returns 已连接的 MCP 客户端。
     */
    async function connect() {
        const headers = {};
        const apiKey = asText(await options.resolveApiKey());
        // 未配置时不带该头：网关会以「未携带 API Key」拒绝，比伪造一个空 Key 更可诊断。
        if (apiKey !== undefined)
            headers[FTSHARE_API_KEY_HEADER] = apiKey;
        const client = new Client({ name: clientName, version: clientVersion });
        const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers } });
        await client.connect(transport);
        return client;
    }
    return {
        async call(tool, args, callOptions) {
            const signal = callOptions?.signal;
            if (signal?.aborted === true)
                throw new Error(`FTShare ${tool} 调用前已被取消`);
            const startedAt = Date.now();
            const client = await connect();
            try {
                const result = await client.callTool({ name: tool, arguments: args }, undefined, {
                    ...signal !== undefined ? { signal } : {},
                });
                if (result.isError === true) {
                    // 抛出一段文本：归一器既能读其中的 JSON 码，也能读纯文案。
                    throw new Error(errorTextFromContent(result.content, `${tool} 返回 MCP 错误`));
                }
                const value = payloadOf(result, tool, options.logger);
                if (value === undefined)
                    throw new Error(`${tool} 未返回 structuredContent，也没有可解析的文本载荷`);
                return { value };
            }
            catch (error) {
                options.logger?.warn('ftshare.call_failed', {
                    tool,
                    durationMs: Date.now() - startedAt,
                    message: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
            finally {
                await client.close().catch(() => undefined);
            }
        },
        async listTools() {
            const client = await connect();
            try {
                const listed = await client.listTools();
                const tools = [];
                for (const entry of Array.isArray(listed.tools) ? listed.tools : []) {
                    if (!isRecord(entry))
                        continue;
                    const tool = asText(entry.name);
                    if (tool === undefined)
                        continue;
                    const description = asText(entry.description);
                    tools.push({
                        tool,
                        title: asText(entry.title) ?? tool,
                        // 目录产物（`catalog.json` / `catalog.txt`）就是这两项生成的：少了它们
                        // 目录只能给名字，模型没法判断该调哪个接口、要传什么。
                        ...description !== undefined ? { description } : {},
                        ...entry.inputSchema !== undefined ? { inputSchema: entry.inputSchema } : {},
                    });
                }
                return tools;
            }
            finally {
                await client.close().catch(() => undefined);
            }
        },
    };
}
//# sourceMappingURL=transport.js.map