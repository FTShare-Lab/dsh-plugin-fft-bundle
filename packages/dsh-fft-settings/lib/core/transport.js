/**
 * Host half of the settings transport.
 *
 * One exact route on the shared `/api` carrier: the carrier owns the Host/Origin
 * fence and browser authentication, so this layer only decodes the call, bounds
 * the body and returns the result envelope. Registering through
 * `connection.rpc.handle` instead would read `webServer` through the context
 * property proxy, whose resolution is ancestor-only and therefore fails for a
 * plugin mounted beside the Web server.
 */
import { FTSHARE_SETTINGS_MAX_BODY_BYTES, FTSHARE_SETTINGS_ROUTE } from './contract.js';
const invalidRequest = () => ({
    ok: false,
    error: { code: 'bad_request', message: '请求参数不正确', details: {} },
});
/**
 * Build the exact Fetch route served by the connection carrier.
 * @param options - the settings call handler.
 * @returns route definition ready for `connection.fetch.register`.
 */
export function createSettingsRoute({ handler }) {
    return {
        path: FTSHARE_SETTINGS_ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
            const body = await readJsonBody(request);
            if (body === null || typeof body !== 'object' || Array.isArray(body)) {
                return json(400, invalidRequest());
            }
            const call = body;
            const endpoint = typeof call.endpoint === 'string' ? call.endpoint : '';
            return json(200, await handler(endpoint, call.payload, request.signal));
        },
    };
}
/** Read and parse the JSON body; oversized, malformed or interrupted reads return undefined. */
async function readJsonBody(request) {
    const reader = request.body?.getReader();
    if (reader === undefined)
        return undefined;
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > FTSHARE_SETTINGS_MAX_BODY_BYTES) {
                await reader.cancel();
                return undefined;
            }
            chunks.push(value);
        }
    }
    catch {
        // A client-side abort only means this request lost its body; nothing else to read.
        return undefined;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        // A non-JSON body has the same single outcome: invalid request parameters.
        return undefined;
    }
}
function json(status, payload) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
