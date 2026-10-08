import Schema from '@deepseek-ai/schemastery';
export interface Config {
    ftshareUrl: string;
    llmProvider: string;
    llmModel: string;
    /** Retained for compatibility with earlier profiles; report persistence is no longer automatic. */
    saveToWorkspace: boolean;
    /** Retained for compatibility; browser downloads are the only export path. */
    outputDir: string;
    maxKlineDays: number;
    announcementLookbackDays: number;
    llmMaxAttempts: number;
}
export declare const Config: Schema<Config>;
//# sourceMappingURL=config.d.ts.map