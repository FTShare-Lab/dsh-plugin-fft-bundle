# dsh-fft-bundle

DSH 插件 bundle 仓：非凸金融工作台插件集合。pnpm workspace，组合层 `@ft/dsh-fft-bundle` 发布为终端用户安装入口，各插件包在 `packages/` 下独立开发。

## 结构

```
packages/
├── dsh-fft-bundle/            # 组合层：cordis.patch.yml 装配清单 + 管理器 icon/locale，无运行时代码
├── dsh-fft-settings/          # 插件：共享设置、FTShare API Key 管理（ftshareSettings 服务）
├── dsh-fft-research-cockpit/  # 插件：FT 投研舱，8 类 FTShare 投研报告 + 组合推荐工具
```

插件间依赖方向：`dsh-fft-research-cockpit` 注入 `dsh-fft-settings` 的 `ftshareSettings` 服务；

## 开发

```bash
pnpm install
pnpm build && pnpm test
```

## 装入 DSH

```bash
# 开发：单插件直装
dsh plugin --profile <name> add link:./packages/dsh-fft-settings

# 开发：组合层（各包 + 组合包分别 link）
dsh plugin --profile <name> add \
  link:./packages/dsh-fft-settings \
  link:./packages/dsh-fft-research-cockpit \
  link:./packages/dsh-fft-bundle

# 发布后：终端用户一条命令拉全套
dsh plugin --profile <name> add @ft/dsh-fft-bundle
```

修改插件后需重新 build 并重启 `dsh web`（Host 代码不热载）。

## 文档

- `.agents/skills/dsh-plugin-development/` DSH 插件开发/移植公共知识（bundle 组合、包骨架、兼容门、安装路径、升级清单）
- `docs/plans/` 迁移与架构决策草稿
- `docs/thirdparty/` 第三方插件调研
- `docs/releases.md` Release notes（版本倒序）
