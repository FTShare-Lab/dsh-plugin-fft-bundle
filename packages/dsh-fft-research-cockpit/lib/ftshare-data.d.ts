import { type FtShareSession } from './ftshare-client.js';
import type { Logger } from '@deepseek-ai/cordis';
import type { JsonRecord, Snapshot } from './types.js';
export declare function rows(value: JsonRecord, depth?: number): JsonRecord[];
export interface SnapshotLoadOptions {
    /** Skip optional event/research calls when loading large candidate pools. */
    includeAnnouncements?: boolean;
    includeResearch?: boolean;
    /** Load stock-level flow and risk facts for reports that render them. */
    includeExtendedFacts?: boolean;
    includeRiskFacts?: boolean;
}
export declare function loadSnapshot(session: FtShareSession, symbol: string, asOf: string, maxKlineDays: number, signal: AbortSignal, announcementLookbackDays?: number, options?: SnapshotLoadOptions, logger?: Logger): Promise<Snapshot>;
//# sourceMappingURL=ftshare-data.d.ts.map