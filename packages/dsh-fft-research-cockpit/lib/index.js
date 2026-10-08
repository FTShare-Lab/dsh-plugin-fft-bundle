import { Config } from './config.js';
import { registerReportTool } from './report-tool.js';
export const name = 'FT 投研舱';
export const inject = ['tools', 'llm', 'ftshareSettings'];
export { Config };
export function apply(ctx, config) {
    registerReportTool(ctx, config);
}
//# sourceMappingURL=index.js.map