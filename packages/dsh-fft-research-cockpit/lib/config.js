import Schema from '@deepseek-ai/schemastery';
export const Config = Schema.object({
    // 网关地址与凭据只归 FTShare 底座（`@dsh-ft/dsh-fft-ftshare`）：本包不再持有出站配置，
    // 「唯一出站」是底座存在的意义。
    llmProvider: Schema.string().default('deepseek-official'),
    llmModel: Schema.string().default('deepseek-v4-flash'),
    maxKlineDays: Schema.number().default(120),
    announcementLookbackDays: Schema.number().default(30),
    llmMaxAttempts: Schema.number().default(2),
});
//# sourceMappingURL=config.js.map