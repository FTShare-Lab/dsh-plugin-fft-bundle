import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { createShellReader } from '../../shell.js';
import { defineSettingsCard } from '../../card-registry.js';
import { describeUpdateView, productVersionLine } from './view.js';
/**
 * Version and check-for-updates entry, above the credentials card.
 *
 * The desktop shell is the only source: version and update state deliberately do
 * not travel over the plugin RPC surface, so this card declares no injection.
 */
export const appVersionCard = defineSettingsCard({
    id: 'appVersion', order: 0, inject: [],
    createComponent() {
        const shell = createShellReader();
        return () => _jsx(AppVersionCard, { shell: shell });
    },
});
export function AppVersionCard({ shell }) {
    const [appInfo, setAppInfo] = useState();
    const [loaded, setLoaded] = useState(false);
    const [capability, setCapability] = useState();
    const [state, setState] = useState();
    useEffect(() => {
        let live = true;
        // The shell replays the current state on subscribe, so the card holds no
        // second copy that could drift from the tray (FR-9).
        const unsubscribe = shell.subscribe(next => { if (live)
            setState(next); });
        void shell.appInfo().then(info => { if (!live)
            return; setAppInfo(info); setLoaded(true); });
        void shell.capability().then(next => { if (live)
            setCapability(next); });
        return () => { live = false; unsubscribe(); };
    }, [shell]);
    const view = describeUpdateView(state, capability);
    const run = (control) => { if (control.action)
        shell.act(control.action); };
    return _jsxs("section", { className: "ftshare-settings", "aria-label": "\u975E\u51F8\u91D1\u878D\u7EC8\u7AEF \u7248\u672C\u4E0E\u66F4\u65B0", children: [_jsx("header", { children: _jsxs("div", { children: [_jsx("span", { className: "ftshare-eyebrow", children: "FFT DESKTOP / UPDATE" }), _jsx("h2", { children: "\u5E94\u7528\u7248\u672C" })] }) }), _jsxs("div", { className: "ftshare-card", children: [_jsx("p", { className: "ftshare-version", children: productVersionLine(appInfo, loaded) }), _jsxs("div", { className: "ftshare-actions", children: [_jsx("button", { className: "primary", type: "button", disabled: !view.primary.enabled, onClick: () => run(view.primary), children: view.primary.label }), view.extra.map(control => _jsx("button", { type: "button", disabled: !control.enabled, onClick: () => run(control), children: control.label }, control.id))] })] }), _jsx("p", { className: view.tone === 'error' ? 'ftshare-error' : undefined, role: view.tone === 'error' ? 'alert' : 'status', children: view.status }), view.advisory ? _jsx("p", { className: "ftshare-advisory", role: "note", children: view.advisory }) : undefined] });
}
