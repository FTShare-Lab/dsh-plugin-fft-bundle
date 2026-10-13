/**
 * The FT prompt contract: three ordered system sections and one runtime fact.
 *
 * Registration is a single {@link installGuidance} call so the text and the
 * mount point stay independent — moving these registrations into an agent preset
 * later changes only the row that calls this module.
 *
 * A section is paid for on every request and any edit invalidates the prompt's
 * KV-cache prefix, so the contract stays short; methodology that needs examples,
 * checklists, or branch flow belongs in a skill instead.
 * @module @ft/dsh-fft-settings/guidance
 */
import type { Context } from '@deepseek-ai/cordis';
/** Section name of the identity opener. */
export declare const FT_IDENTITY_SECTION = "ft:identity";
/** Section name of the capability list. */
export declare const FT_SERVICES_SECTION = "ft:services";
/** Section name of the financial-data discipline. */
export declare const FT_DATA_POLICY_SECTION = "ft:data-policy";
/** Runtime-context name of the FTShare credential fact. */
export declare const FT_CREDENTIALS_CONTEXT = "ft:credentials";
/**
 * Section orders. Consecutive integers keep a third-party section from sorting
 * between two of ours (`1`–`499` is the shared free band), while `5` still lands
 * after the deployment persona (`0`) and before core's plan policy (`500`).
 */
export declare const FT_SECTION_ORDERS: {
    readonly identity: 5;
    readonly services: 6;
    readonly dataPolicy: 7;
};
/** Order of the credential fact — `getContextOrder` owns only three named positions. */
export declare const FT_CREDENTIALS_ORDER = 130;
export declare const FT_IDENTITY_TEXT = "\u4F60\u662F\u975E\u51F8(FT)\u91D1\u878D\u52A9\u624B\uFF0C\u5E2E\u52A9\u7528\u6237\u83B7\u53D6\u91D1\u878D\u4FE1\u606F\uFF0C\u8FDB\u884C\u91D1\u878D\u7814\u7A76\u3002\u4E50\u4E8E\u52A9\u4EBA\uFF0C\u8BED\u8A00\u7CBE\u51C6\u5BA2\u89C2";
export declare const FT_SERVICES_TEXT = "\u884C\u60C5\u3001K\u7EBF\u4E0E\u6307\u6807\u7528 dsh-kline \u5DE5\u5177\uFF08\u4EE3\u7801\u5148\u7528 search_symbols \u89E3\u6790\uFF09\uFF1B\u6295\u7814\u62A5\u544A\u4E0E\u7EC4\u5408\u63A8\u8350\u7528 cockpit_* \u5DE5\u5177\uFF1B\u56E0\u5B50\u5165\u5E93\u4E0E\u8BC4\u4EF7\u7528 factor-intake-standard \u6280\u80FD\uFF1BFTShare API Key \u5728\u8BBE\u7F6E\u9875\u7EF4\u62A4\u3002";
export declare const FT_DATA_POLICY_TEXT = "\u91D1\u878D\u6570\u636E\u4F18\u5148\u53D6 FTShare\uFF0C\u5176\u6B21\u624D\u7528\u8054\u7F51\u68C0\u7D22\u8865\u5145\uFF1B\u5F15\u7528\u5FC5\u987B\u7ED9\u51FA\u5904\u4E0E\u65F6\u70B9\uFF1B\u4E25\u683C\u533A\u5206\u5DF2\u62AB\u9732\u4E8B\u5B9E\u3001\u673A\u6784\u5224\u65AD\u4E0E\u5F85\u9A8C\u8BC1\u4FE1\u606F\uFF1B\u4E0D\u7F16\u9020\u6570\u5B57\uFF0C\u4E5F\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE\u3002";
export declare const FT_CREDENTIALS_MISSING_TEXT = "FTShare \u51ED\u636E\u672A\u914D\u7F6E\uFF1A\u884C\u60C5\u53EF\u80FD\u9000\u5316\u4E3A\u514D\u8D39\u515C\u5E95\u6E90\uFF0C\u8986\u76D6\u6709\u9650\uFF0C\u5F15\u7528\u65F6\u5FC5\u987B\u6807\u660E\u6765\u6E90\uFF1B\u9700\u8981\u5B8C\u6574\u6570\u636E\u65F6\u5F15\u5BFC\u7528\u6237\u5728\u8BBE\u7F6E\u9875\u586B\u5199 API Key\u3002";
/**
 * Register the FT prompt contract for every agent the calling context reaches.
 * @param ctx - the plugin's host context; an unscoped context registers globally.
 */
export declare function installGuidance(ctx: Context): void;
