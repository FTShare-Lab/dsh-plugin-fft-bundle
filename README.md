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

包内构建产物（`lib/`）已随仓提交：git 安装只送达 git 跟踪的文件、且不在安装期构建，
所以**安装前必须已 build 并提交 `lib/`**（见 AGENTS.md）。

### 终端用户：一条 spec 装全套

私有仓前置（每台机器一次）：

- ssh 能访问本仓：`git -c credential.helper= ls-remote ssh://git@github.com/gigaflw/dsh-fft-bundle.git HEAD`
- profile 的 `pnpm-workspace.yaml` 里加 `blockExoticSubdeps: false`：bundle 的 `dependencies`
  指向本仓的 `#path:` 子目录包，pnpm 11 默认拒绝子依赖里的 git 协议；pnpm ≥10 只从
  `pnpm-workspace.yaml` 读设置，`.npmrc` 无效

在 Electron「插件管理」里粘贴这一条（等价地，应用自带 CLI `dsh plugin --profile desktop add <同一 spec>`）：

```
git+ssh://git@github.com/gigaflw/dsh-fft-bundle.git#path:packages/dsh-fft-bundle
```

装前先卸掉旧的 `link:` 安装（如 `@ft/dsh-fft-settings`），避免同名包两种来源并存。
更新：重贴同一 spec 即覆盖（git spec 不做"已安装"预检），取默认分支最新提交。

### 开发：本地 link

```bash
# 单插件直装
dsh plugin --profile <name> add link:./packages/dsh-fft-settings

# 组合层（各包 + 组合包分别 link）
dsh plugin --profile <name> add \
  link:./packages/dsh-fft-settings \
  link:./packages/dsh-fft-research-cockpit \
  link:./packages/dsh-fft-bundle
```

修改插件后需重新 build 并重启 `dsh web`（Host 代码不热载）。

### 发布到 registry

`@ft/*` 之间的依赖边写的是本仓 git 地址（`packages/*/package.json` 内 4 处 + 仓库改名时同步）。
改用 registry 分发时，须把这 4 处换回 `workspace:^`，并删掉根 `pnpm-workspace.yaml` 里对应的
`link:` overrides。

## 文档

- `.agents/skills/dsh-plugin-development/` DSH 插件开发/移植公共知识（bundle 组合、包骨架、兼容门、安装路径、升级清单）
- `docs/plans/` 迁移与架构决策草稿
- `docs/thirdparty/` 第三方插件调研
- `docs/releases.md` Release notes（版本倒序）
