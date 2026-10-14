import Schema from '@deepseek-ai/schemastery';
export const Config = Schema.object({
    ftshareUrl: Schema.string().default('https://market.ft.tech/gateway/mcp'),
    llmProvider: Schema.string().default('deepseek-official'),
    llmModel: Schema.string().default('deepseek-v4-flash'),
    maxKlineDays: Schema.number().default(120),
    announcementLookbackDays: Schema.number().default(30),
    llmMaxAttempts: Schema.number().default(2),
});
//# sourceMappingURL=config.js.map