window.__ModuleLoader__.load({
	id: "@ft/dsh-fft-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/card-registry.ts
		function defineSettingsCard(card) {
			return card;
		}
		function assembleSettingsCards(ctx, cards) {
			const seen = /* @__PURE__ */ new Set();
			for (const card of cards) {
				if (!card.id || seen.has(card.id)) throw new Error(`Invalid or duplicate settings card: ${card.id}`);
				if (!Number.isFinite(card.order)) throw new Error(`Invalid settings card order: ${card.id}`);
				seen.add(card.id);
			}
			return [...cards].sort((a, b) => a.order - b.order).map((card) => ({
				id: card.id,
				Component: card.createComponent(ctx)
			}));
		}
		/**
		* Identity of the settings section that carries this plugin's cards.
		*
		* The id replaces the old `ftshare`; the label is also the brand shown next to
		* the desktop version, while the shell's own `productName` stays `DSH FFT`
		* (spec B.5 Q6 leaves that rename out of scope).
		*/
		const FTSHARE_SETTINGS_SECTION = {
			id: "dsh-fft",
			order: 120,
			label: "非凸金融终端"
		};
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
		const apiKeyCard = defineSettingsCard({
			id: "apiKey",
			order: 10,
			inject: ["remote"],
			createComponent(ctx) {
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
				return () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FtshareSettingsSection, {
					api,
					subscribeChanges
				});
			}
		});
		function FtshareSettingsSection({ api, subscribeChanges }) {
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
		//#region src/shell.ts
		/**
		* Reader for the desktop shell bridge injected by the Electron preload script.
		*
		* Contract: `docs/specs/desktop-auto-update/spec.md` §2.9 in the parent workspace.
		* This module is browser-safe by requirement (FR-15): no Node built-ins, no host
		* imports, and no assumption that `window` exists, so every consumer — settings
		* cards and other plugins alike — shares one reading of the shell protocol.
		*/
		/** Global injected by the desktop shell; deliberately unrelated to DSH core bridge names. */
		const SHELL_BRIDGE_GLOBAL = "dshFft";
		/** Bridge shape this reader understands; the shell increments it when the shape changes. */
		const SHELL_BRIDGE_PROTOCOL_VERSION = 1;
		/** Without a desktop runtime the version is unknowable and updates cannot run (spec 2.10). */
		const NO_SHELL_CAPABILITY = Object.freeze({
			supported: false,
			reason: "当前环境不提供版本信息"
		});
		const UPDATE_PHASES = [
			"idle",
			"checking",
			"not-available",
			"available",
			"downloading",
			"downloaded",
			"installing",
			"error"
		];
		const UPDATE_METHODS = [
			"getCapability",
			"getState",
			"subscribe",
			"check",
			"download",
			"install",
			"skip"
		];
		function isRecord(value) {
			return typeof value === "object" && value !== null;
		}
		function hasFunctions(value, names) {
			return names.every((name) => typeof value[name] === "function");
		}
		function text(value) {
			return typeof value === "string" ? value : "";
		}
		/** Structural check: a partial or malformed global must degrade, not throw. */
		function isShellBridge(value) {
			if (!isRecord(value) || typeof value.protocolVersion !== "number" || !Number.isFinite(value.protocolVersion)) return false;
			if (!isRecord(value.app) || !hasFunctions(value.app, ["getInfo"])) return false;
			return isRecord(value.updates) && hasFunctions(value.updates, UPDATE_METHODS);
		}
		function isShellUpdateState(value) {
			if (!isRecord(value)) return false;
			return typeof value.currentVersion === "string" && typeof value.manual === "boolean" && UPDATE_PHASES.includes(value.phase);
		}
		/** Reads the injected global; undefined in a plain browser or any non-browser context. */
		function readShellBridge() {
			const scope = typeof window === "undefined" ? void 0 : window;
			if (!isRecord(scope)) return void 0;
			const candidate = scope[SHELL_BRIDGE_GLOBAL];
			return isShellBridge(candidate) ? candidate : void 0;
		}
		/**
		* Wrap shell access so callers never have to probe, and never have to handle a
		* missing desktop runtime. `resolve` is injectable so tests (and embedders that
		* own the global) can supply a bridge without touching `window`.
		*/
		function createShellReader(resolve = readShellBridge) {
			const current = () => {
				try {
					return resolve();
				} catch {
					return;
				}
			};
			const protocolProblem = (bridge) => bridge.protocolVersion === 1 ? void 0 : {
				supported: false,
				reason: `桌面壳桥协议不兼容（本插件支持 1，桌面壳为 ${bridge.protocolVersion}）`
			};
			return {
				get available() {
					const bridge = current();
					return bridge !== void 0 && protocolProblem(bridge) === void 0;
				},
				async appInfo() {
					const bridge = current();
					if (!bridge) return void 0;
					try {
						const info = await bridge.app.getInfo();
						if (!isRecord(info) || typeof info.version !== "string") return void 0;
						return {
							productName: text(info.productName),
							version: info.version,
							platform: text(info.platform),
							packaged: info.packaged === true
						};
					} catch {
						return;
					}
				},
				async capability() {
					const bridge = current();
					if (!bridge) return NO_SHELL_CAPABILITY;
					const problem = protocolProblem(bridge);
					if (problem) return problem;
					try {
						const value = await bridge.updates.getCapability();
						if (!isRecord(value) || typeof value.supported !== "boolean") return {
							supported: false,
							reason: "桌面壳未返回更新能力信息"
						};
						const advisory = text(value.advisory).trim();
						return {
							supported: value.supported,
							...value.reason === void 0 ? {} : { reason: String(value.reason) },
							...advisory ? { advisory } : {}
						};
					} catch {
						return {
							supported: false,
							reason: "读取更新能力失败"
						};
					}
				},
				async state() {
					const bridge = current();
					if (!bridge) return void 0;
					try {
						const value = await bridge.updates.getState();
						return isShellUpdateState(value) ? value : void 0;
					} catch {
						return;
					}
				},
				subscribe(listener) {
					const bridge = current();
					if (!bridge) return () => {};
					try {
						const unsubscribe = bridge.updates.subscribe((next) => {
							try {
								if (isShellUpdateState(next)) listener(next);
							} catch {}
						});
						if (typeof unsubscribe !== "function") return () => {};
						return () => {
							try {
								unsubscribe();
							} catch {}
						};
					} catch {
						return () => {};
					}
				},
				act(action) {
					const bridge = current();
					if (!bridge) return;
					const method = bridge.updates[action];
					if (typeof method !== "function") return;
					try {
						Promise.resolve(method.call(bridge.updates)).catch(() => {});
					} catch {}
				}
			};
		}
		//#endregion
		//#region src/modules/app-version/view.ts
		/**
		* Update state → card copy and availability.
		*
		* Kept pure and React-free so every phase's mapping can be asserted directly
		* (spec 1.9 table, spec 2.10 degradation matrix) without a DOM.
		*/
		const PENDING_REASON = "正在读取版本与更新能力…";
		const UNSUPPORTED_FALLBACK = "当前环境不支持应用内更新";
		/** `非凸金融终端 vX.Y.Z`, or an explicit unknown while/if the shell cannot answer. */
		function productVersionLine(appInfo, loaded) {
			const version = typeof appInfo?.version === "string" ? appInfo.version.trim() : "";
			if (version) return `${FTSHARE_SETTINGS_SECTION.label} v${version}`;
			return `${FTSHARE_SETTINGS_SECTION.label}（${loaded ? "版本未知" : "正在读取版本信息…"}）`;
		}
		/**
		* The phase mapping, plus the platform's standing notice.
		*
		* The notice hangs off the capability rather than off a phase, because it is
		* true in every phase and is exactly what the user needs before asking for a
		* download — the shell's own dialog never reaches this page (FR-13).
		*/
		function describeUpdateView(state, capability) {
			const view = describePhase(state, capability);
			const advisory = capability?.supported === true ? trimmed(capability.advisory) : "";
			return advisory ? {
				...view,
				advisory
			} : view;
		}
		function describePhase(state, capability) {
			if (capability === void 0) return unavailable(PENDING_REASON);
			if (!capability.supported) return unavailable(trimmed(capability.reason) || UNSUPPORTED_FALLBACK);
			const version = trimmed(state?.availableVersion);
			const target = version ? ` v${version}` : "";
			switch (state?.phase) {
				case "checking": return view(control("primary", "正在检查更新…", false), [], "正在向更新源查询新版本…");
				case "not-available": return view(control("primary", "已是最新版本", false), [], "当前版本已是更新源上的最新版本。");
				case "available": return view(control("primary", "下载", true, "download"), [control("skip", "跳过此版本", true, "skip")], version ? `发现新版本 v${version}` : "发现新版本");
				case "downloading": return view(control("primary", `正在下载${target}…${percentSuffix(state?.percent)}`, false), [], "下载在后台进行，可继续使用应用。");
				case "downloaded": return view(control("primary", `重启以安装${target}`.trim(), true, "install"), [], "下载已完成，重启后由安装器完成安装。");
				case "installing": return view(control("primary", "正在退出并安装…", false), [], "应用即将退出，安装完成后会自动重启。");
				case "error": return view(control("primary", "重试", true, "check"), [], `更新失败：${trimmed(state?.message) || "原因未知"}`, "error");
				default: return view(control("primary", "检查更新", true, "check"), [], "更新只会在你确认后下载与安装。");
			}
		}
		/** Updates unavailable: the version stays visible, the entry is disabled and the reason is stated. */
		function unavailable(reason) {
			return view(control("primary", "检查更新", false), [], reason);
		}
		/** Every value reaching the card is validated here, so a malformed push cannot throw mid-render. */
		function trimmed(value) {
			return typeof value === "string" ? value.trim() : "";
		}
		function control(id, label, enabled, action) {
			return action === void 0 ? {
				id,
				label,
				enabled
			} : {
				id,
				label,
				enabled,
				action
			};
		}
		function view(primary, extra, status, tone = "normal") {
			return {
				primary,
				extra,
				status,
				tone
			};
		}
		function percentSuffix(percent) {
			if (typeof percent !== "number" || !Number.isFinite(percent)) return "";
			return ` ${Math.min(100, Math.max(0, Math.round(percent)))}%`;
		}
		//#endregion
		//#region src/modules/app-version/card.tsx
		/**
		* Version and check-for-updates entry, above the credentials card.
		*
		* The desktop shell is the only source: version and update state deliberately do
		* not travel over the plugin RPC surface, so this card declares no injection.
		*/
		const appVersionCard = defineSettingsCard({
			id: "appVersion",
			order: 0,
			inject: [],
			createComponent() {
				const shell = createShellReader();
				return () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AppVersionCard, { shell });
			}
		});
		function AppVersionCard({ shell }) {
			const [appInfo, setAppInfo] = (0, react.useState)();
			const [loaded, setLoaded] = (0, react.useState)(false);
			const [capability, setCapability] = (0, react.useState)();
			const [state, setState] = (0, react.useState)();
			(0, react.useEffect)(() => {
				let live = true;
				const unsubscribe = shell.subscribe((next) => {
					if (live) setState(next);
				});
				shell.appInfo().then((info) => {
					if (!live) return;
					setAppInfo(info);
					setLoaded(true);
				});
				shell.capability().then((next) => {
					if (live) setCapability(next);
				});
				return () => {
					live = false;
					unsubscribe();
				};
			}, [shell]);
			const view = describeUpdateView(state, capability);
			const run = (control) => {
				if (control.action) shell.act(control.action);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "ftshare-settings",
				"aria-label": "非凸金融终端 版本与更新",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "ftshare-eyebrow",
						children: "FFT DESKTOP / UPDATE"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "应用版本" })] }) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ftshare-card",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "ftshare-version",
							children: productVersionLine(appInfo, loaded)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ftshare-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "primary",
								type: "button",
								disabled: !view.primary.enabled,
								onClick: () => run(view.primary),
								children: view.primary.label
							}), view.extra.map((control) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: !control.enabled,
								onClick: () => run(control),
								children: control.label
							}, control.id))]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: view.tone === "error" ? "ftshare-error" : void 0,
						role: view.tone === "error" ? "alert" : "status",
						children: view.status
					}),
					view.advisory ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "ftshare-advisory",
						role: "note",
						children: view.advisory
					}) : void 0
				]
			});
		}
		//#endregion
		//#region src/cards.ts
		/** Browser registration list. Host modules must never be imported here. */
		const settingsCards = [appVersionCard, apiKeyCard];
		//#endregion
		//#region src/styles.ts
		/** Owned by this plugin; does not depend on Kpan being loaded. */
		const SETTINGS_CSS = `
.ftshare-settings { color:var(--ftshare-text,#f4f4f5); max-width:760px; font-size:14px; line-height:1.6; }
.ftshare-settings * { box-sizing:border-box; }
.ftshare-settings h2 { font-size:26px; margin:4px 0 8px; }
.ftshare-settings h3 { font-size:15px; margin:0 0 12px; }
.ftshare-settings p { margin:8px 0; color:var(--ftshare-muted,#aeb2bd); }
.ftshare-settings .ftshare-version { margin:0 0 4px; color:inherit; font-size:18px; font-weight:600; }
.ftshare-settings .ftshare-advisory { font-size:13px; color:#e8bf35; }
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
		//#region src/client.tsx
		const inject = [.../* @__PURE__ */ new Set(["slots", ...settingsCards.flatMap((card) => [...card.inject])])];
		function apply(ctx) {
			registerFtshareSettings(ctx);
		}
		function registerFtshareSettings(ctx) {
			ctx.slots.inject("settings.section", () => {
				const cards = assembleSettingsCards(ctx, settingsCards);
				return ctx.slots.register({
					name: "settings.section",
					...FTSHARE_SETTINGS_SECTION
				}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: SETTINGS_CSS }), cards.map(({ id, Component }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Component, {}, id))] }));
			});
		}
		//#endregion
		exports.FtshareSettingsSection = FtshareSettingsSection;
		exports.NO_SHELL_CAPABILITY = NO_SHELL_CAPABILITY;
		exports.SHELL_BRIDGE_GLOBAL = SHELL_BRIDGE_GLOBAL;
		exports.SHELL_BRIDGE_PROTOCOL_VERSION = SHELL_BRIDGE_PROTOCOL_VERSION;
		exports.apply = apply;
		exports.createShellReader = createShellReader;
		exports.inject = inject;
		exports.isShellBridge = isShellBridge;
		exports.isShellUpdateState = isShellUpdateState;
		exports.readShellBridge = readShellBridge;
		exports.registerFtshareSettings = registerFtshareSettings;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map