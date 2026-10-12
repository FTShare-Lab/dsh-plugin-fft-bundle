import { Config } from './config.js';
import { registerReportTool } from './report-tool.js';
export const name = 'FT 投研舱';
export const inject = ['tools', 'llm', 'ftshareSettings'];
export { Config };
export function apply(ctx, config) {
    // 具名 logger 只创建一次，再显式注入到各服务/函数：不使用模块级单例，
    // 免得插件重载后残留上一个 fiber 的 logger。
    const logger = ctx.logger('ft-research-cockpit');
    registerReportTool(ctx, config, logger);
}
//# sourceMappingURL=index.js.map