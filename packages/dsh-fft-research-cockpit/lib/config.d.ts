import Schema from '@deepseek-ai/schemastery';
export interface Config {
    ftshareUrl: string;
    llmProvider: string;
    llmModel: string;
    maxKlineDays: number;
    announcementLookbackDays: number;
    llmMaxAttempts: number;
}
export declare const Config: Schema<Config>;
//# sourceMappingURL=config.d.ts.map