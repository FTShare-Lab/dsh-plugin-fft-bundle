/**
 * 宿主侧的目录读取：把随包的 `catalog.json` 读进内存，供 `ftshare_call` 的准入
 * 校验、`./route` 的接口名校验使用。
 *
 * 单独一个模块，是为了让浏览器侧只引 `./catalog`（纯函数），不把 `node:fs` 拖进
 * 打包图里。
 * @module @dsh-ft/dsh-fft-ftshare/catalog-host
 */
import { readFileSync } from 'node:fs';
import { asCatalog } from './catalog.js';
/** 随包目录产物的路径；`lib/` 的上一层就是包根。 */
export const FTSHARE_CATALOG_PATH = new URL('../catalog.json', import.meta.url);
let cached;
/**
 * 读取随包目录（首次调用读盘，之后走缓存）。
 * @returns 目录；文件缺失或损坏时为空目录（调用方据此一律判「不在目录里」）。
 */
export function loadCatalog() {
    if (cached !== undefined)
        return cached;
    try {
        cached = asCatalog(JSON.parse(readFileSync(FTSHARE_CATALOG_PATH, 'utf8')));
    }
    catch {
        cached = { entries: [] };
    }
    return cached;
}
/** 目录索引文件的绝对路径，给模型 `grep` 用。 */
export const FTSHARE_CATALOG_INDEX_PATH = new URL('../catalog.txt', import.meta.url).pathname;
//# sourceMappingURL=catalog-host.js.map