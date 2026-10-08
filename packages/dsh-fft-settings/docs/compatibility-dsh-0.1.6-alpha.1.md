# DeepSeek Harness 0.1.6 兼容性检查

检查日期：2026-09-17。对象为 FTShare Settings；没有升级工作区 DSH 子仓，没有修改 dsh_kline。

## 版本与结论

官方 npm registry 当日没有 `0.1.6` 正式版；本次实际验证 `0.1.6-alpha.1`（alpha 标签），对应 Git tag `dsh-v0.1.6-alpha.1`、commit `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`。当日 latest 为 `0.1.5-rc.1`，next 为 `0.1.5-rc.2`。工作区固定的 DSH 源码版本仍为 `0.1.2-rc.1`。

**已验证的插件代码和接口兼容该 alpha 版本，但现有依赖声明不满足该版本，不能直接称为开箱即用的升级。** 尚未验证整个桌面应用和其他插件。

## 已完成的验证

在工作区忽略目录创建隔离插件副本，把其全部 DSH 依赖固定为 `0.1.6-alpha.1`；未修改实际插件的依赖版本或 lockfile。

| 验证 | 结果 |
| --- | --- |
| TypeScript 类型检查 | 通过 |
| Host 编译与 browser bundle 构建 | 通过 |
| 现有自动化测试 | 44 / 44 通过 |
| 真实 alpha LocalCredentialProvider + Cordis 插件装配 | 通过 |
| 临时旧格式凭据文件自动迁移至 version/refs 格式 | 通过 |
| 保存、即时解析、掩码后四位、清除 | 通过 |
| credentials/reference-updated 变更通知 | 通过 |
| 真实 alpha HostConnectionService 的 HTTP RPC | 通过 |
| 未认证 401、非可信 Origin 403 | 通过 |
| Host-only resolve 拒绝公开调用、额外 JSON 字段拒绝 | 通过 |

运行时检查只使用临时目录和虚构凭据，没有读取或修改用户凭据，也没有使用虚构 Key 请求 FTShare。隔离目录为 `build/.cache/ftshare-compat-plugin-0.1.6`；可在其中执行 `pnpm test`、`pnpm run typecheck`、`node compat-smoke.mjs` 复核（缓存目录不随仓库发布）。

## 接口核对

- `../src/modules/api-key/host.ts` 使用的 `credentialRef`、`resolve/describe/set/unset` 和引用更新事件继续可用。凭据基础包对应源码在比较范围内未改变。
- `../src/index.ts` / `../src/rpc-core.ts` 使用的 `connection.rpc.handle(channel, handler)` 与客户端 `call(...)` 契约保留；新增流式能力不要求现有普通 RPC 修改。
- `../src/client.tsx` / `../src/card-registry.ts` 使用的设置 slot 注册接口保留；类型检查和构建通过。没有执行新版完整 DSH 页面交互测试。
- 新版 LocalCredentialProvider 使用带 `version: 1`、`refs`、`records` 的凭据文档，启动时可迁移可识别的旧平面格式。插件通过 provider API 访问，不依赖文件布局；真实临时文件迁移已验证。异常格式仍由上游拒绝，不能保证任意手写文件自动迁移。

## 升级时需要调整的依赖范围

当前 `package.json`：

```json
{
  "dependencies": { "@deepseek-ai/dsh-credentials": "^0.1.0-rc.8" },
  "peerDependencies": {
    "@deepseek-ai/dsh-client-ui-settings": "^0.1.2-rc.1",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.2-rc.1",
    "@deepseek-ai/dsh-api-remotes": "^0.1.2-rc.1"
  }
}
```

npm semver 的上述范围均不接纳 `0.1.6-alpha.1`，因为它属于不同版本基数的预发布版。稳定版 `0.1.6` 会符合这些范围，但本次未有该正式版本可供验证。

确定升级到该 alpha 时，应显式允许 `0.1.6-alpha.1`，例如将相应范围改为 `原范围 || 0.1.6-alpha.1`，并统一解析 Host 与插件的 DSH 依赖、重新生成 lockfile。也可以在整体迁移时统一精确固定该版本。然后在目标桌面 runtime 验证插件装载、设置页面、重连与跨插件调用。此次只检查兼容性，因此未修改生产依赖范围和 submodule 指针。

## 验证边界

上述结论覆盖 FTShare Settings 的类型、构建、已有测试及所列真实 Host 接口；不等于整个 dsh-ft、Electron 安装包或 kline 已完成新版回归。kline 的 Python 私有桥仍是接入设计，并未实现。未来正式 `0.1.6` 发布后应重新核对版本与测试，不能把 alpha 结果自动外推到正式版。
