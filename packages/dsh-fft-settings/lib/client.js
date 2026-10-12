window.__ModuleLoader__.load({
	id: "@ft/dsh-fft-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		/**
		* Identity of the settings section that carries this plugin's cards.
		*
		* The id replaces the old `ftshare`; the label is the brand this plugin shows
		* for itself, independent of any host application name.
		*/
		const FTSHARE_SETTINGS_SECTION = {
			id: "dsh-fft",
			order: 120,
			label: "非凸金融终端"
		};
		/**
		* Child slot of {@link FTSHARE_SETTINGS_SECTION} that carries its cards.
		*
		* The section declares the slot when it registers; every card — ours and a
		* third party's — contributes through it with `id`/`order`/`label`, and
		* `order` (ascending, default 100) decides the card's position.
		*/
		const FTSHARE_SETTINGS_CARD_SLOT = "ftshare.settings.card";
		const FTSHARE_CREDENTIAL_EVENTS = ["credentials/reference-updated"];
		/**
		* Browser-facing route for this plugin's settings calls.
		*
		* It sits below `/api` so the shared connection carrier applies the Host/Origin
		* fence and browser authentication before dispatch; this plugin only handles
		* the call itself.
		*/
		const FTSHARE_SETTINGS_ROUTE = "/api/ftshare-settings";
		/** Local syntax validation, never an assertion of upstream validity. */
		function normalizeApiKey(input) {
			const value = input.trim();
			if (!value) throw new Error("请输入 API Key");
			if (value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("API Key 长度不能超过 512 个字符，且不能包含控制字符");
			return value;
		}
		//#endregion
		//#region src/settings-model.ts
		var FtshareSettingsModel = class {
			api;
			state = {
				busy: false,
				message: ""
			};
			listeners = /* @__PURE__ */ new Set();
			request = 0;
			lifetime = 0;
			constructor(api) {
				this.api = api;
			}
			getSnapshot = () => this.state;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			update(patch) {
				this.state = {
					...this.state,
					...patch
				};
				for (const listener of this.listeners) listener();
			}
			connect(subscribe) {
				const dispose = subscribe?.(() => {
					this.refresh();
				});
				this.refresh();
				return () => {
					this.request++;
					this.lifetime++;
					dispose?.();
				};
			}
			async refresh() {
				const request = ++this.request;
				try {
					const status = await this.api.describe();
					if (!status || typeof status.configured !== "boolean") throw new Error("missing_status");
					if (request === this.request) this.update({
						status,
						statusError: void 0
					});
				} catch {
					if (request === this.request) this.update({
						status: void 0,
						statusError: "无法读取设置状态，请刷新重试"
					});
				}
			}
			async configureAndTest(input) {
				if (this.state.busy || !this.state.status?.writable) return false;
				let value;
				try {
					value = normalizeApiKey(input);
				} catch (error) {
					this.update({ message: error.message });
					return false;
				}
				const lifetime = this.lifetime;
				this.update({
					busy: true,
					save: void 0,
					message: "正在保存并检查远端服务和 API Key…"
				});
				let saved = false;
				try {
					const result = await this.api.configureAndTest(value);
					saved = result.save.status === "saved";
					if (lifetime === this.lifetime) this.update({
						save: result.save,
						message: saved ? validationMessage(result.validation.status) : result.save.message
					});
				} catch {
					if (lifetime === this.lifetime) this.update({ message: "请求未完成，保存状态待确认；请刷新后测试当前连接" });
				}
				if (lifetime === this.lifetime) {
					await this.refresh();
					this.update({ busy: false });
				}
				return saved;
			}
			async testConnection() {
				if (this.state.busy || !this.state.status) return;
				const lifetime = this.lifetime;
				this.update({
					busy: true,
					message: "正在检查远端服务和当前 API Key…"
				});
				try {
					const result = await this.api.testConnection();
					if (lifetime === this.lifetime) this.update({ message: validationMessage(result.status) });
				} catch {
					if (lifetime === this.lifetime) this.update({ message: "测试请求失败，请重试" });
				}
				if (lifetime === this.lifetime) {
					await this.refresh();
					this.update({ busy: false });
				}
			}
			async clear() {
				if (this.state.busy || !this.state.status?.writable) return;
				const lifetime = this.lifetime;
				this.update({
					busy: true,
					save: void 0,
					message: ""
				});
				try {
					await this.api.clear();
					if (lifetime === this.lifetime) this.update({ message: "已清除 DSH 保存的密钥；若有 .env 配置，下方显示其有效状态" });
				} catch {
					if (lifetime === this.lifetime) this.update({ message: "清除失败，请刷新状态后重试" });
				}
				if (lifetime === this.lifetime) {
					await this.refresh();
					this.update({ busy: false });
				}
			}
		};
		function validationMessage(status) {
			return {
				passed: "远端服务正常，API Key 验证通过",
				partial: "远端服务正常，请查看 API Key 检查结果",
				failed: "测试未通过，请查看分项结果",
				not_run: "未执行测试，请先确认凭据配置",
				superseded: "凭据已变化，请重新测试",
				not_tested: "尚未测试"
			}[status] ?? "请查看分项结果";
		}
		//#endregion
		//#region src/rpc-core.ts
		async function callSettingsRpc(transport, namespace, method, payload = {}) {
			const result = await transport.call(`${namespace}/${method}`, payload);
			if (!result.ok) throw new Error("FTShare 设置操作失败，请重试");
			return result.value;
		}
		//#endregion
		//#region src/modules/api-key/client-api.ts
		/** Browser adapter deliberately has no resolve/createEnvironment method. */
		function createApiKeyClient(transport) {
			async function call(method, payload = {}) {
				return callSettingsRpc(transport, "apiKey", method, payload);
			}
			return {
				describe: () => call("describe"),
				set: (value) => call("set", { value }),
				clear: () => call("clear"),
				configureAndTest: (value) => call("configureAndTest", { value }),
				testConnection: () => call("testConnection"),
				getValidationStatus: () => call("getValidationStatus")
			};
		}
		//#endregion
		//#region src/client-transport.ts
		/**
		* Browser half of the settings transport.
		*
		* Calls are same-origin fetches to the plugin route, so the browser session
		* cookie carries authentication and this plugin needs no Connection RPC client.
		*/
		/**
		* Create the browser-backed caller used by the settings cards.
		* @param doFetch - transport override; defaults to the page's global fetch.
		* @returns caller that owns request encoding and envelope decoding.
		*/
		function createSettingsTransport(doFetch) {
			const send = doFetch ?? ((input, init) => globalThis.fetch(input, init));
			return { async call(endpoint, payload = {}, signal) {
				const response = await send(FTSHARE_SETTINGS_ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						endpoint,
						payload
					}),
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new Error(`transport failure for ${endpoint}: HTTP ${response.status}`);
				return await response.json();
			} };
		}
		//#endregion
		//#region src/modules/api-key/card.tsx
		/**
		* Contribute the built-in API Key card through the same slot a third-party
		* card uses. Nothing about it is privileged: same declaration, same options.
		* @param ctx - client context carrying the renderer's slots service.
		* @returns idempotent disposer for the card registration.
		*/
		function registerApiKeyCard(ctx) {
			return ctx.slots.inject(FTSHARE_SETTINGS_CARD_SLOT, () => ctx.slots.register({
				name: FTSHARE_SETTINGS_CARD_SLOT,
				id: "apiKey",
				order: 10
			}, createApiKeyCard(ctx)));
		}
		/** Bind the card's adapters; subscriptions are acquired in the component's effect. */
		function createApiKeyCard(ctx) {
			const api = createApiKeyClient(createSettingsTransport());
			const subscribeChanges = (listener) => {
				const disposers = FTSHARE_CREDENTIAL_EVENTS.map((event) => ctx.remote.$on(event, (ref) => {
					if (ref === "FTSHARE_API_KEY") listener();
				}));
				disposers.push(ctx.on("connection/reset", listener));
				return () => {
					for (const dispose of disposers) dispose();
				};
			};
			return () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApiKeyCard, {
				api,
				subscribeChanges
			});
		}
		function ApiKeyCard({ api, subscribeChanges }) {
			const model = (0, react.useMemo)(() => new FtshareSettingsModel(api), [api]);
			const { status, busy, message, statusError, save } = (0, react.useSyncExternalStore)(model.subscribe, model.getSnapshot, model.getSnapshot);
			const [draft, setDraft] = (0, react.useState)("");
			(0, react.useEffect)(() => model.connect(subscribeChanges), [model, subscribeChanges]);
			const disabled = busy || !status?.writable;
			const configure = async () => {
				if (await model.configureAndTest(draft)) setDraft("");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "ftshare-settings",
				"aria-label": "FTShare 设置",
				"aria-busy": busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "ftshare-eyebrow",
						children: "FTSHARE / API KEY"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "访问凭据" })] }) }),
					status && !status.writable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前来源为只读，可测试连接；修改密钥请到对应来源操作。" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ftshare-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								htmlFor: "ftshare-api-key",
								children: "FTShare API Key"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: "ftshare-api-key",
								type: "password",
								value: draft,
								placeholder: status?.configured ? status.maskedValue ?? "••••••••" : "请输入 API Key",
								onChange: (e) => setDraft(e.target.value),
								disabled,
								autoComplete: "new-password",
								maxLength: 512
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ftshare-actions",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "primary",
										type: "button",
										onClick: () => void configure(),
										disabled: disabled || !draft.trim(),
										children: "配置并测试"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => void model.testConnection(),
										disabled: busy || !status,
										children: "测试当前连接"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => void model.clear(),
										disabled: disabled || !status?.configured,
										children: "清除已保存密钥"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => void model.refresh(),
										disabled: busy,
										title: "重新读取已保存的配置和上次检测结果，不会发起联网检测",
										children: "重新读取状态"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: "https://ftai.chat/me/profile?tab=api-key",
										target: "_blank",
										rel: "noreferrer",
										children: "获取 API Key ↗"
									})
								]
							}),
							draft && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "“测试当前连接”使用已生效的密钥，不测试输入框内尚未保存的内容。" }),
							busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								children: "正在处理，请稍候…"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ftshare-card",
						"aria-live": "polite",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "验证结果" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
								save && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "本次保存" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: save.message })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "远端服务" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: status?.validation.remote.message ?? "状态待确认" })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "API Key" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: status?.validation.apiKey.message ?? "状态待确认" })]
								}),
								status?.validation.testedAt && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "测试时间" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: new Date(status.validation.testedAt).toLocaleString() })]
								})
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "节假日或收盘后的空数据不影响验证。" })
						]
					}),
					message && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: message
					}),
					statusError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ftshare-error",
						role: "alert",
						children: statusError
					})
				]
			});
		}
		//#endregion
		//#region src/styles.ts
		/** Owned by this plugin; does not depend on Kpan being loaded. */
		const SETTINGS_CSS = `
.ftshare-settings { color:var(--ftshare-text,#f4f4f5); max-width:760px; font-size:14px; line-height:1.6; }
.ftshare-settings * { box-sizing:border-box; }
.ftshare-settings h2 { font-size:26px; margin:4px 0 8px; }
.ftshare-settings h3 { font-size:15px; margin:0 0 12px; }
.ftshare-settings p { margin:8px 0; color:var(--ftshare-muted,#aeb2bd); }
.ftshare-settings .ftshare-eyebrow { color:#e8bf35; font-size:11px; letter-spacing:.12em; }
.ftshare-settings header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:20px; }
.ftshare-settings .ftshare-badge { padding:5px 12px; border:1px solid #585b66; border-radius:20px; white-space:nowrap; }
.ftshare-settings .ftshare-card { padding:22px; background:var(--ftshare-panel,#292a30); border:1px solid var(--ftshare-border,#44464f); border-radius:12px; margin-top:16px; }
.ftshare-settings label { display:block; font-weight:600; }
.ftshare-settings small { display:block; color:var(--ftshare-muted,#aeb2bd); font-size:12px; margin:5px 0 12px; }
.ftshare-settings input { width:100%; height:44px; border:1px solid #696c77; border-radius:7px; padding:0 12px; background:var(--ftshare-input,#1d1e23); color:inherit; font:inherit; }
.ftshare-settings input::placeholder { color:var(--ftshare-muted,#aeb2bd); opacity:1; }
.ftshare-settings .ftshare-actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:16px; }
.ftshare-settings button { min-height:44px; border:1px solid #696c77; border-radius:7px; padding:8px 14px; font:inherit; background:transparent; color:inherit; cursor:pointer; }
.ftshare-settings button.primary { background:#f0c433; color:#171717; border-color:#f0c433; font-weight:600; }
.ftshare-settings button:disabled { opacity:.5; cursor:not-allowed; }
.ftshare-settings :is(button,input,a):focus-visible { outline:2px solid #e8bf35; outline-offset:3px; }
.ftshare-settings a { color:var(--ftshare-link,#d8c4fc); }
.ftshare-settings dl { margin:0; }
.ftshare-settings .ftshare-result { display:grid; grid-template-columns:130px 1fr; gap:12px; padding:10px 0; border-top:1px solid var(--ftshare-border,#44464f); }
.ftshare-settings dd { margin:0; overflow-wrap:anywhere; }
.ftshare-settings .ftshare-error { color:var(--ftshare-error,#ffb5ad); }
@media(max-width:540px) { .ftshare-settings header { flex-direction:column; gap:10px; } .ftshare-settings .ftshare-card { padding:16px; } .ftshare-settings .ftshare-result { grid-template-columns:1fr; gap:4px; } }
`;
		//#endregion
		//#region src/shell.tsx
		/** Section slot this seam contributes into; declared by the settings shell. */
		const FTSHARE_SETTINGS_SECTION_NAME = "settings.section";
		/**
		* The settings section shell: core CSS variables, the section chrome, and the
		* single render site every card appears at. Cards own everything inside it.
		*/
		function FtshareSettingsSection({ renderSlot }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: SETTINGS_CSS }), renderSlot(FTSHARE_SETTINGS_CARD_SLOT, {})] });
		}
		/**
		* Declare the card slot and contribute the section that renders it.
		*
		* Declaring the child slot is what authorizes the render site; a card
		* registering through {@link FTSHARE_SETTINGS_CARD_SLOT} before this runs waits
		* for the declaration instead of failing.
		* @param ctx - client context carrying the renderer's slots service.
		* @returns idempotent disposer for the section and its declaration.
		*/
		function registerSettingsSection(ctx) {
			return ctx.slots.inject(FTSHARE_SETTINGS_SECTION_NAME, () => ctx.slots.register({
				name: FTSHARE_SETTINGS_SECTION_NAME,
				...FTSHARE_SETTINGS_SECTION,
				children: { [FTSHARE_SETTINGS_CARD_SLOT]: {
					kind: "list",
					scope: "root"
				} }
			}, FtshareSettingsSection));
		}
		//#endregion
		//#region src/client.tsx
		const inject = ["slots", "remote"];
		function apply(ctx) {
			registerFtshareSettings(ctx);
		}
		/** Contribute the section shell, then the built-in cards through the slot it declares. */
		function registerFtshareSettings(ctx) {
			registerSettingsSection(ctx);
			registerApiKeyCard(ctx);
		}
		//#endregion
		exports.FtshareSettingsSection = FtshareSettingsSection;
		exports.apply = apply;
		exports.inject = inject;
		exports.registerFtshareSettings = registerFtshareSettings;
		exports.registerSettingsSection = registerSettingsSection;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map