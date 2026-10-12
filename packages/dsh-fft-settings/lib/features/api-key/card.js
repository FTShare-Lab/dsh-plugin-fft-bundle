import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FTSHARE_API_KEY_REF, FTSHARE_CREDENTIAL_EVENTS } from './contract.js';
import { FTSHARE_SETTINGS_CARD_SLOT } from '../../core/contract.js';
import { FtshareSettingsModel } from './model.js';
import { createApiKeyClient } from './client-api.js';
import { createSettingsTransport } from '../../core/client-transport.js';
import { API_KEY_CARD_CSS } from './styles.js';
/**
 * Contribute the built-in API Key card through the same slot a third-party
 * card uses. Nothing about it is privileged: same declaration, same options.
 * @param ctx - client context carrying the renderer's slots service.
 * @returns idempotent disposer for the card registration.
 */
export function registerApiKeyCard(ctx) {
    return ctx.slots.inject(FTSHARE_SETTINGS_CARD_SLOT, () => ctx.slots.register({ name: FTSHARE_SETTINGS_CARD_SLOT, id: 'apiKey', order: 10 }, createApiKeyCard(ctx)));
}
/** Bind the card's adapters; subscriptions are acquired in the component's effect. */
function createApiKeyCard(ctx) {
    const api = createApiKeyClient(createSettingsTransport());
    const subscribeChanges = listener => {
        const disposers = FTSHARE_CREDENTIAL_EVENTS.map(event => ctx.remote.$on(event, ref => { if (ref === FTSHARE_API_KEY_REF)
            listener(); }));
        disposers.push(ctx.on('connection/reset', listener));
        return () => { for (const dispose of disposers)
            dispose(); };
    };
    return () => _jsx(ApiKeyCard, { api: api, subscribeChanges: subscribeChanges });
}
export function ApiKeyCard({ api, subscribeChanges }) {
    const model = useMemo(() => new FtshareSettingsModel(api), [api]);
    const { status, busy, message, statusError, save } = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
    const [draft, setDraft] = useState('');
    useEffect(() => model.connect(subscribeChanges), [model, subscribeChanges]);
    const disabled = busy || !status?.writable;
    const configure = async () => { if (await model.configureAndTest(draft))
        setDraft(''); };
    return _jsxs(_Fragment, { children: [_jsx("style", { children: API_KEY_CARD_CSS }), _jsxs("section", { className: "ftshare-settings", "aria-label": "FTShare \u8BBE\u7F6E", "aria-busy": busy, children: [_jsx("header", { children: _jsxs("div", { children: [_jsx("span", { className: "ftshare-eyebrow", children: "FTSHARE / API KEY" }), _jsx("h2", { children: "\u8BBF\u95EE\u51ED\u636E" })] }) }), status && !status.writable && _jsx("p", { children: "\u5F53\u524D\u6765\u6E90\u4E3A\u53EA\u8BFB\uFF0C\u53EF\u6D4B\u8BD5\u8FDE\u63A5\uFF1B\u4FEE\u6539\u5BC6\u94A5\u8BF7\u5230\u5BF9\u5E94\u6765\u6E90\u64CD\u4F5C\u3002" }), _jsxs("div", { className: "ftshare-card", children: [_jsx("label", { htmlFor: "ftshare-api-key", children: "FTShare API Key" }), _jsx("input", { id: "ftshare-api-key", type: "password", value: draft, placeholder: status?.configured ? status.maskedValue ?? '••••••••' : '请输入 API Key', onChange: e => setDraft(e.target.value), disabled: disabled, autoComplete: "new-password", maxLength: 512 }), _jsxs("div", { className: "ftshare-actions", children: [_jsx("button", { className: "primary", type: "button", onClick: () => void configure(), disabled: disabled || !draft.trim(), children: "\u914D\u7F6E\u5E76\u6D4B\u8BD5" }), _jsx("button", { type: "button", onClick: () => void model.testConnection(), disabled: busy || !status, children: "\u6D4B\u8BD5\u5F53\u524D\u8FDE\u63A5" }), _jsx("button", { type: "button", onClick: () => void model.clear(), disabled: disabled || !status?.configured, children: "\u6E05\u9664\u5DF2\u4FDD\u5B58\u5BC6\u94A5" }), _jsx("button", { type: "button", onClick: () => void model.refresh(), disabled: busy, title: "\u91CD\u65B0\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u7684\u914D\u7F6E\u548C\u4E0A\u6B21\u68C0\u6D4B\u7ED3\u679C\uFF0C\u4E0D\u4F1A\u53D1\u8D77\u8054\u7F51\u68C0\u6D4B", children: "\u91CD\u65B0\u8BFB\u53D6\u72B6\u6001" }), _jsx("a", { href: "https://ftai.chat/me/profile?tab=api-key", target: "_blank", rel: "noreferrer", children: "\u83B7\u53D6 API Key \u2197" })] }), draft && _jsx("small", { children: "\u201C\u6D4B\u8BD5\u5F53\u524D\u8FDE\u63A5\u201D\u4F7F\u7528\u5DF2\u751F\u6548\u7684\u5BC6\u94A5\uFF0C\u4E0D\u6D4B\u8BD5\u8F93\u5165\u6846\u5185\u5C1A\u672A\u4FDD\u5B58\u7684\u5185\u5BB9\u3002" }), busy && _jsx("p", { role: "status", children: "\u6B63\u5728\u5904\u7406\uFF0C\u8BF7\u7A0D\u5019\u2026" })] }), _jsxs("div", { className: "ftshare-card", "aria-live": "polite", children: [_jsx("h3", { children: "\u9A8C\u8BC1\u7ED3\u679C" }), _jsxs("dl", { children: [save && _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u672C\u6B21\u4FDD\u5B58" }), _jsx("dd", { children: save.message })] }), _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u8FDC\u7AEF\u670D\u52A1" }), _jsx("dd", { children: status?.validation.remote.message ?? '状态待确认' })] }), _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "API Key" }), _jsx("dd", { children: status?.validation.apiKey.message ?? '状态待确认' })] }), status?.validation.testedAt && _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u6D4B\u8BD5\u65F6\u95F4" }), _jsx("dd", { children: new Date(status.validation.testedAt).toLocaleString() })] })] }), _jsx("small", { children: "\u8282\u5047\u65E5\u6216\u6536\u76D8\u540E\u7684\u7A7A\u6570\u636E\u4E0D\u5F71\u54CD\u9A8C\u8BC1\u3002" })] }), message && _jsx("p", { role: "status", children: message }), statusError && _jsx("p", { className: "ftshare-error", role: "alert", children: statusError })] })] });
}
