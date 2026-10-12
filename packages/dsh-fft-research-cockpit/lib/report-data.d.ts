import { type FtShareSession } from './ftshare-client.js';
import type { Logger } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
import type { JsonRecord, PermissionNotice, Provenance, ReportRequest, ReportType, SectorConstituent, Snapshot } from './types.js';
export interface ReportFacts {
    reportType: ReportType;
    asOf: string;
    request: ReportRequest;
    snapshots: Snapshot[];
    market: JsonRecord[];
    indices: JsonRecord[];
    sectors: JsonRecord[];
    constituents: SectorConstituent[];
    flows: JsonRecord[];
    limits: JsonRecord[];
    announcements: JsonRecord[];
    news: JsonRecord[];
    raw: JsonRecord;
    provenance: Provenance[];
    permissions: PermissionNotice[];
    blockedPermissions: PermissionNotice[];
    dataGaps: string[];
    warnings: string[];
}
export declare function loadReportFacts(session: FtShareSession, request: ReportRequest, asOf: string, config: Config, signal: AbortSignal, previous?: ReportFacts, logger?: Logger): Promise<ReportFacts>;
//# sourceMappingURL=report-data.d.ts.map