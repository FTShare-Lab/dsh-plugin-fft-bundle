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
import type { Logger } from '@deepseek-ai/cordis';
import type { FtshareToolInfo } from './contract.js';
/** 默认网关地址：FTShare 的 MCP StreamableHTTP 入口。 */
export declare const FTSHARE_GATEWAY_ENDPOINT = "https://market.ft.tech/gateway/mcp";
/** 承载 API Key 的请求头名。 */
export declare const FTSHARE_API_KEY_HEADER = "FTSHARE_API_KEY";
/** 一次上游调用的原始结果。`value` 是上游自己的结构化载荷，未做任何解释。 */
export interface FtshareTransportResult {
    value: unknown;
}
/** 传输层：与传输实现无关的最小面，便于测试注入假实现。 */
export interface FtshareTransport {
    /** 调一个上游工具；上游报错时抛异常（由调用方归一）。 */
    call(tool: string, args: Record<string, unknown>, options?: {
        signal?: AbortSignal;
    }): Promise<FtshareTransportResult>;
    /** 上游工具清单；上游不可达时抛异常。 */
    listTools(): Promise<readonly FtshareToolInfo[]>;
}
/** 建传输层所需的依赖。 */
export interface FtshareTransportOptions {
    /** 网关地址，默认 {@link FTSHARE_GATEWAY_ENDPOINT}。 */
    endpoint?: string;
    /** 每次操作重新取凭据；返回空串/undefined 表示未配置。 */
    resolveApiKey: () => Promise<string | undefined>;
    /** 具名 logger；不传则不记录。 */
    logger?: Logger;
    /** MCP 客户端自称的名字，只影响上游日志。 */
    clientName?: string;
    /** MCP 客户端版本。 */
    clientVersion?: string;
}
/**
 * 建一个到 FTShare 网关的传输层。
 * @param options - 见 {@link FtshareTransportOptions}。
 * @returns 传输层实现。
 */
export declare function createFtshareTransport(options: FtshareTransportOptions): FtshareTransport;
//# sourceMappingURL=transport.d.ts.map