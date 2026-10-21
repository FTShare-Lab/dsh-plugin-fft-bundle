window.__ModuleLoader__.load({
	id: "@ft/dsh-fft-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		const FTSHARE_CREDENTIAL_EVENTS = ["credentials/reference-updated"];
		/** Local syntax validation, never an assertion of upstream validity. */
		function normalizeApiKey(input) {
			const value = input.trim();
			if (!value) throw new Error("请输入 API Key");
			if (value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("API Key 长度不能超过 512 个字符，且不能包含控制字符");
			return value;
		}
		//#endregion
		//#region src/core/contract.ts
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
		/**
		* Browser-facing route for this plugin's settings calls.
		*
		* It sits below `/api` so the shared connection carrier applies the Host/Origin
		* fence and browser authentication before dispatch; this plugin only handles
		* the call itself.
		*/
		const FTSHARE_SETTINGS_ROUTE = "/api/ftshare-settings";
		//#endregion
		//#region src/features/api-key/model.ts
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
		//#region src/core/rpc-core.ts
		/**
		* 把一次失败的信封翻译成调用方能展示的原因。
		*
		* `not_found` 是「浏览器半边比宿主半边新」的可观测症状：升级插件后客户端 bundle 由磁盘重新
		* 加载，而宿主进程仍持有旧包，它没有新命名空间。此时重试永远不会成功，必须点名重启宿主。
		* @param endpoint - 这次调用的 `<namespace>/<method>`。
		* @param error - 宿主回传的失败原因，畸形信封下可能缺省。
		* @returns 面向用户的失败描述。
		*/
		function describeSettingsFailure(endpoint, error) {
			if (error?.code === "not_found") return `FTShare 设置接口 ${endpoint} 不存在：宿主插件还是升级前的版本，重启 DSH 后再试`;
			return `FTShare 设置操作失败（${error?.code ?? "unknown"}）：${error?.message ?? "宿主未说明原因"}`;
		}
		async function callSettingsRpc(transport, namespace, method, payload = {}) {
			const endpoint = `${namespace}/${method}`;
			const result = await transport.call(endpoint, payload);
			if (!result.ok) throw new Error(describeSettingsFailure(endpoint, result.error));
			return result.value;
		}
		//#endregion
		//#region src/features/api-key/client-api.ts
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
		//#region src/core/client-transport.ts
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
		//#region src/features/api-key/styles.ts
		/**
		* The API Key card's own styles, rendered by the card component's `<style>`.
		*
		* A card owns everything past the section shell: the core declares the
		* `--ftshare-*` tokens and the section container, never card internals.
		* Every selector stays scoped under `.ftshare-settings`, so a card never
		* styles another card's markup.
		*/
		const API_KEY_CARD_CSS = `
.ftshare-settings .ftshare-eyebrow { color:var(--ftshare-accent-on-surface); font-size:11px; letter-spacing:.12em; }
.ftshare-settings .ftshare-card { padding:22px; background:var(--ftshare-panel); border:0.5px solid var(--ftshare-border); border-radius:var(--dsw-radius-xl); margin-top:16px; }
.ftshare-settings label { display:block; font-weight:500; }
.ftshare-settings input { width:100%; height:32px; border:0.5px solid var(--ftshare-control); border-radius:var(--dsw-radius-md); padding:0 12px; background:var(--ftshare-input); color:inherit; font:inherit; }
.ftshare-settings input::placeholder { color:var(--ftshare-muted); opacity:1; }
.ftshare-settings .ftshare-actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:16px; }
.ftshare-settings button { min-height:36px; border:0.5px solid var(--ftshare-control); border-radius:var(--dsw-radius-md); padding:0 14px; font:inherit; background:transparent; color:inherit; cursor:pointer; }
.ftshare-settings button.primary { background:var(--ftshare-accent); color:var(--ftshare-accent-ink); border-color:var(--ftshare-accent); font-weight:500; }
.ftshare-settings button:disabled { opacity:.5; cursor:not-allowed; }
.ftshare-settings dl { margin:0; }
.ftshare-settings .ftshare-result { display:grid; grid-template-columns:130px 1fr; gap:12px; padding:10px 0; border-top:0.5px solid var(--ftshare-border); }
.ftshare-settings dd { margin:0; overflow-wrap:anywhere; }
.ftshare-settings .ftshare-error { color:var(--ftshare-error); }
@media(max-width:540px) { .ftshare-settings .ftshare-card { padding:16px; } .ftshare-settings .ftshare-result { grid-template-columns:1fr; gap:4px; } }
`;
		//#endregion
		//#region src/features/api-key/card.tsx
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: API_KEY_CARD_CSS }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
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
			})] });
		}
		//#endregion
		//#region src/features/logs/contract.ts
		/**
		* `logs` 命名空间的共享契约：只有常量与类型，浏览器半边可以安全导入。
		*
		* 采集器（Host 常驻）与导出器（设置页）通过文件解耦；本文件是两者唯一的共同语言。
		*/
		/**
		* 卡片在 `ftshare.settings.card` 槽位里的 id 与 order。
		*
		* 归 feature 所有（与业务契约同一份来源）：卡片组件与浏览器侧的守卫测试都读它，
		* order 20 排在 API Key 卡（10）之后。
		*/
		const LOGS_CARD_ID = "logs";
		/**
		* 诊断包路由（规格 §9 / §12 决策 3）：`/api` 载体上的第二条精确路由，归 `logs` feature 所有。
		*
		* 卡片用 `<a download>` 直接指向它：浏览器同源 GET 自带凭据，不需要 fetch/Blob，
		* `/api` 前缀的鉴权由载体负责，本 feature 不重复鉴权、也不读任何请求参数。
		* 它随 owner fiber 释放（`ctx.effect` + `register` 返回的 disposer）。
		*/
		const LOGS_ARCHIVE_ROUTE = "/api/ftshare-settings/logs.zip";
		//#endregion
		//#region src/features/logs/client-api.ts
		/** 浏览器适配器：只读，且不暴露本地路径以外的任何 Host 能力（刷盘与释放句柄）。 */
		function createLogsClient(transport) {
			const call = (method, payload = {}) => callSettingsRpc(transport, "logs", method, payload);
			return {
				stats: () => call("stats"),
				preview: (lines = 80) => call("preview", { lines }),
				export: () => call("export")
			};
		}
		//#endregion
		//#region src/features/logs/styles.ts
		/**
		* The `logs` card's own styles, rendered by the card component's `<style>`.
		*
		* These two rules used to live in the core section stylesheet; a card owns
		* everything past the section shell, so they moved here with the card. Every
		* selector stays scoped under `.ftshare-settings`, so a card never styles
		* another card's markup.
		*/
		const LOGS_CARD_CSS = `
.ftshare-settings select { height:32px; border:0.5px solid var(--ftshare-control); border-radius:var(--dsw-radius-md); padding:0 10px; background:var(--ftshare-input); color:inherit; font:inherit; }
.ftshare-settings .ftshare-download { display:inline-flex; align-items:center; min-height:32px; padding:0 14px; border:0.5px solid var(--ftshare-control); border-radius:var(--dsw-radius-md); color:inherit; text-decoration:none; cursor:pointer; }
.ftshare-settings .ftshare-log-preview { max-height:320px; overflow:auto; margin:0 0 12px; padding:12px; background:var(--ftshare-input); border:0.5px solid var(--ftshare-border); border-radius:var(--dsw-radius-lg); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
`;
		//#endregion
		//#region src/features/logs/card.tsx
		/** 预览行数候选：上限由 Host 侧校验兜底。 */
		const PREVIEW_CHOICES = [
			50,
			80,
			200
		];
		/**
		* 快照缺失时的占位文案。
		*
		* 失败后不能继续写「读取中…」：那会把一次已经结束的失败说成正在进行的读取，掩盖真正的
		* 原因（例如宿主插件没有这个接口，重试永远不会成功）。
		* @param failed - 本次读取是否已经失败。
		* @returns 失败提示，或仍在读取的提示。
		*/
		function statsPlaceholder(failed) {
			return failed ? "读取失败" : "读取中…";
		}
		function displayBytes(bytes) {
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`;
			return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
		}
		/** 把文本包成 Blob，用 a[download] 触发下载（Web 与桌面同一套）。 */
		function downloadText(fileName, text) {
			const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = fileName;
			anchor.rel = "noopener";
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 0);
		}
		/**
		* Contribute the built-in runtime-log card through the same slot a third-party
		* card uses. Nothing about it is privileged: same declaration, same options.
		* @param ctx - client context carrying the renderer's slots service.
		* @returns idempotent disposer for the card registration.
		*/
		function registerLogsCard(ctx) {
			return ctx.slots.inject(FTSHARE_SETTINGS_CARD_SLOT, () => ctx.slots.register({
				name: FTSHARE_SETTINGS_CARD_SLOT,
				id: LOGS_CARD_ID,
				order: 20
			}, createLogsCard()));
		}
		/** Bind the card's adapter; the component only reads through it. */
		function createLogsCard() {
			const api = createLogsClient(createSettingsTransport());
			return () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LogsSection, { api });
		}
		function LogsSection({ api }) {
			const [stats, setStats] = (0, react.useState)();
			const [preview, setPreview] = (0, react.useState)();
			const [lines, setLines] = (0, react.useState)(80);
			const [busy, setBusy] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			/** 读取已失败且还没有任何快照时，每个字段都必须说出来，而不是假装还在读。 */
			const placeholder = statsPlaceholder(error !== "");
			const refresh = (0, react.useCallback)(async () => {
				setBusy(true);
				setError("");
				try {
					setStats(await api.stats());
					setPreview(await api.preview(lines));
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : "读取日志状态失败");
				} finally {
					setBusy(false);
				}
			}, [api, lines]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			const doExport = async () => {
				setBusy(true);
				setError("");
				setMessage("");
				try {
					const result = await api.export();
					downloadText(result.fileName, result.text);
					setMessage(`已导出 ${result.fileName}（${displayBytes(result.bytes)}${result.truncated ? "，已达体积上限并截断" : ""}）`);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : "导出日志失败");
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: LOGS_CARD_CSS }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "ftshare-settings",
				"aria-label": "FT 运行日志",
				"aria-busy": busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "ftshare-eyebrow",
						children: "FTSHARE / LOGS"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "运行日志" })] }) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ftshare-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "采集状态" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "日志文件" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: stats?.file ?? placeholder })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "记录 / 时间范围" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [stats === void 0 ? placeholder : `${stats.records} 条`, stats?.firstAt !== void 0 && `（${stats.firstAt} ~ ${stats.lastAt}）`] })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "文件大小 / 上限" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: stats === void 0 ? placeholder : `${displayBytes(stats.fileBytes)} / ${displayBytes(stats.maxBytes)}` })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "丢弃 / 轮转 / 写失败" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: stats === void 0 ? placeholder : `${stats.dropped} / ${stats.rotations} / ${stats.writeFailures}` })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "日志级别" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [stats?.level ?? placeholder, " "] })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "统计" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: stats === void 0 ? placeholder : Object.keys(stats.byName).length === 0 ? "暂无" : Object.entries(stats.byName).map(([name, count]) => `${name}=${count}`).join("、") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "ftshare-result",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "额外来源" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: stats === void 0 ? placeholder : stats.sources.length === 0 ? "暂无" : stats.sources.map((source) => `${source.path}（${source.kind}${source.bytes === void 0 ? "" : ` ${displayBytes(source.bytes)}`}）`).join("；") })]
								})
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ftshare-actions",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "primary",
										type: "button",
										onClick: () => void doExport(),
										disabled: busy,
										children: "导出日志"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										className: "ftshare-download",
										href: LOGS_ARCHIVE_ROUTE,
										download: "",
										children: "导出诊断包"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => void refresh(),
										disabled: busy,
										children: "刷新"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: "ftshare-log-lines",
										children: "预览行数"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										id: "ftshare-log-lines",
										value: lines,
										onChange: (e) => setLines(Number(e.target.value)),
										disabled: busy,
										children: PREVIEW_CHOICES.map((choice) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: choice,
											children: choice
										}, choice))
									})
								]
							}),
							busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								children: "正在处理，请稍候…"
							}),
							message && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								children: message
							}),
							error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "ftshare-error",
								role: "alert",
								children: error
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ftshare-card",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", { children: ["最近日志", preview?.truncated === true ? "（已截断）" : ""] }), preview === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: error === "" ? "正在读取…" : "日志预览读取失败，见上方提示。" }) : preview.lines.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "无" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: "ftshare-log-preview",
							children: preview.lines.join("\n")
						})]
					})
				]
			})] });
		}
		//#endregion
		//#region src/core/styles.ts
		/**
		* The section shell's styles plus the theme tokens every card reads.
		*
		* The shell owns the container, typography, focus ring and link rules that
		* every card sits inside; a card owns its own CSS and renders it from its own
		* component, and core never styles card internals.
		*
		* The theme layer declares the plugin's `--ftshare-*` tokens once, on
		* `.ftshare-settings` — the root element every card renders. Surfaces and text
		* take their value from the host palette: `--dsw-alias-*` is what DSH
		* publishes for the light, the dark and every registered theme, so one
		* stylesheet follows the live palette with no script, no `prefers-color-scheme`
		* copy and no second palette to keep in sync. The literal inside each `var()`
		* is the fallback for a host that publishes no palette.
		*
		* The declarations sit on the card root rather than on `:root` because a
		* custom property resolves where it is *declared*: `--dsw-alias-*` exists from
		* `body` downwards, so a value derived from it above `body` would resolve to
		* nothing and fall back. Consequence: the place to pin a look is the host
		* palette itself (`ctx.theme.register` / `ctx.theme.overrideTokens`), not these
		* names.
		*
		* `--ftshare-accent*` is the plugin's own brand and has no host equivalent. The
		* values come from the FT brand layer's `--ft-*` tokens (`src/brand.ts`), with
		* the same literal as the fallback so the card keeps its colors when that layer
		* is absent. The fill and its ink are scheme-invariant;
		* `--ftshare-accent-on-surface` mixes the same yellow towards the host's text
		* colour, so the brand stays legible as the 11px eyebrow and as the focus ring
		* on either surface.
		*/
		const SETTINGS_CSS = `
.ftshare-settings { --ftshare-text:var(--dsw-alias-label-primary,#f4f4f5); --ftshare-muted:var(--dsw-alias-label-secondary,#aeb2bd); --ftshare-panel:var(--dsw-alias-settings-card-fill,#292a30); --ftshare-border:var(--dsw-alias-settings-card-stroke,#44464f); --ftshare-control:var(--dsw-alias-border-l4,#696c77); --ftshare-input:var(--dsw-alias-bg-layer-1,#1d1e23); --ftshare-link:var(--dsw-alias-link,#d8c4fc); --ftshare-error:var(--dsw-alias-state-error-primary,#ffb5ad); --ftshare-accent:var(--ft-accent,#f0c433); --ftshare-accent-ink:var(--ft-accent-ink,#171717); --ftshare-accent-on-surface:color-mix(in srgb,var(--ftshare-accent) 50%,var(--dsw-alias-label-primary,#f4f4f5)); }
.ftshare-settings { color:var(--ftshare-text); max-width:760px; font-size:14px; line-height:1.6; }
.ftshare-settings * { box-sizing:border-box; }
.ftshare-settings h2 { font-size:26px; margin:4px 0 8px; }
.ftshare-settings h3 { font-size:15px; margin:0 0 12px; }
.ftshare-settings p { margin:8px 0; color:var(--ftshare-muted); }
.ftshare-settings header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:20px; }
.ftshare-settings small { display:block; color:var(--ftshare-muted); font-size:12px; margin:5px 0 12px; }
.ftshare-settings :is(button,input,a):focus-visible { outline:2px solid var(--ftshare-accent-on-surface); outline-offset:3px; }
.ftshare-settings a { color:var(--ftshare-link); }
@media(max-width:540px) { .ftshare-settings header { flex-direction:column; gap:10px; } }
`;
		//#endregion
		//#region src/core/shell.tsx
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
		//#region src/brand.ts
		/** One value for both palettes: brand fills are scheme-invariant. */
		const invariant = (value) => ({
			light: value,
			dark: value
		});
		/** Layer identity reported to `ctx.theme.overrideTokens` (one layer per source). */
		const FT_BRAND_SOURCE = "@ft/dsh-fft-settings";
		/**
		* The published brand colors.
		*
		* `accent` is the FT yellow used by this plugin's primary action and eyebrow;
		* `accent-warm` is the orange trading accent shared by market and trade
		* surfaces (it is the only palette-aware group); `wechat` is the enterprise-
		* WeChat green the SSO card keeps as its identity. Inks are the text colors on
		* those fills, and `-soft` is the tinted surface behind the accent.
		*/
		const FT_BRAND_TOKENS = Object.freeze({
			"--ft-accent": invariant("#f0c433"),
			"--ft-accent-ink": invariant("#171717"),
			"--ft-accent-warm": {
				light: "#cf5623",
				dark: "#ff8352"
			},
			"--ft-accent-warm-hover": {
				light: "#b8481b",
				dark: "#ff9a72"
			},
			"--ft-accent-warm-ink": {
				light: "#ffffff",
				dark: "#1a120e"
			},
			"--ft-accent-warm-soft": {
				light: "#fbeee8",
				dark: "#2b1d16"
			},
			"--ft-wechat": invariant("#2ebd68"),
			"--ft-wechat-ink": invariant("#102419")
		});
		/**
		* Stack the brand layer once the host theme service exists.
		*
		* The deferred `inject` is deliberate: this plugin's declared client context
		* names only the services its cards read, and a host without `theme` must
		* still load the settings page — the CSS fallbacks then carry the colors.
		* @param ctx - client context carrying the host theme service.
		*/
		function applyBrandTokens(ctx) {
			ctx.inject(["theme"], (scope) => {
				scope.effect(() => scope.theme.overrideTokens(FT_BRAND_SOURCE, FT_BRAND_TOKENS), "ft-settings: FT brand tokens");
			});
		}
		//#endregion
		//#region src/client.tsx
		const inject = ["slots", "remote"];
		function apply(ctx) {
			registerFtshareSettings(ctx);
			applyBrandTokens(ctx);
		}
		/** Contribute the section shell, then the built-in cards through the slot it declares. */
		function registerFtshareSettings(ctx) {
			registerSettingsSection(ctx);
			registerApiKeyCard(ctx);
			registerLogsCard(ctx);
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