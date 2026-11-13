# dsh-fft-bundle

非凸金融工作台 DSH 插件集合：共享设置 / FTShare API Key、FTShare 数据面、K 线、模拟交易。
pnpm workspace 组织，组合包 `@dsh-ft/dsh-fft-finance-toolkit` 是终端用户的安装入口。

对外变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 两条产物线的区别

| --- | --- | --- |
| 安装方式 | 下载 `.tgz`，插件管理器贴绝对路径 | 插件管理器输入 `@dsh-ft/dsh-fft-finance-toolkit` |
| profile 层数 | 1 | 1 |
| 前置 | 无（文件已内联全部插件） | 无（预构建，免 ssh） |

两条线是同一个包、同一份清单、同一份公共 patch，**差异只有 `dsh.bundle.patch` 多一个文件**。
方案与取舍见 `docs/specs/distribution/npm-channel.md`。

## 使用方式

### 方式一：tarball（推荐，不需要 ssh）

1. 取得 `ft-dsh-fft-bundle-X.Y.Z.tgz`：打开本仓 GitLab 的「Releases」页，在该版本的资产里下载（下载后不要移动或删除）；
2. 安装官方 Deepseek Harness 桌面版并启动：<https://deepseek-harness.github.io/deepseek-harness>
3. 「设置」→「插件管理」→「添加插件」，粘贴文件的**绝对路径**，或直接粘贴 Release 资产 URL（形如 `https://github.com/FTShare-Lab/dsh-plugin-fft-bundle/releases/download/vX.Y.Z/dsh-ft-finance-all-in-one-X.Y.Z.tgz`）：

```
/Users/<你>/Downloads/ft-dsh-fft-bundle-X.Y.Z.tgz
```

4. 装完刷新一次页面；若替换的是已装的同名插件，完全退出并重开应用。

文件里已内联全部子插件，这条路不需要 ssh，也不需要改 profile 的 pnpm 配置。升级时下载新版本文件（文件名带版本号）再贴新路径即可；同一条路径重贴不会升级。

### 方式二：git spec（装稳定版）

1. 确认本机能 ssh 访问 GitHub 私有仓；
2. 打开 git 子依赖，并关掉 peer 自动安装加速

```bash
f=~/.dsh/profiles/desktop/pnpm-workspace.yaml
[ -f "$f" ] || { echo "找不到 $f：先启动一次桌面版" >&2; exit 1; }
for k in blockExoticSubdeps autoInstallPeers; do grep -q "^$k:" "$f" || echo "$k: false" >> "$f"; done
```

3. 「插件管理」→「添加插件」，在输入框里粘贴同一条 spec：

```
git+ssh://git@github.com/FTShare-Lab/dsh-plugin-fft-bundle.git#path:packages/dsh-fft-bundle
```

重贴完全相同的 spec 不会升级：插件管理器靠 profile 依赖项的前后差异定位装进来的包，没有差异就报「无法从依赖变更中确定安装了哪一个包」。升级要先卸载再重装，或贴一条与现有条目不同的 spec（如带版本号的 `#v0.5.2&path:`）。不带 ref 的 spec 落在默认分支——只前移到发布提交的 `stable`，所以拿到的是稳定版；装前先卸掉旧的 `link:` 安装。开发中的改动不要靠 git spec 验证（`dev` 不是安装来源）：用本地 `link:` 安装，或打一份 tarball（`pnpm pack:tarball`）。

## 开发方式

```bash
pnpm install
pnpm build && pnpm test
```

用本地 link 装自己的改动：

```bash
dsh plugin --profile <name> add link:./packages/dsh-fft-settings
```

改完要重新 build 并重启 `dsh web`（Host 代码不热载）。
推送前必须 `pnpm build` 并提交 `lib/`。
