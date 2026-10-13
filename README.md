# dsh-fft-bundle

pnpm workspace 组织，组合包 `@ft/dsh-fft-bundle` 是终端用户的安装入口。

## 使用方式

1. 确认本机能 ssh 访问 GitHub 私有仓；
2. 安装官方 Deepseek Harness 桌面版：<https://deepseek-harness.github.io/deepseek-harness>
3. 打开 git 子依赖，并关掉 peer 自动安装加速

```bash
f=~/.dsh/profiles/desktop/pnpm-workspace.yaml; for k in blockExoticSubdeps autoInstallPeers; do grep -q "^$k:" "$f" || echo "$k: false" >> "$f"; done
```

4. 「插件管理」→「添加插件」，在输入框里粘贴同一条 spec：

```
git+ssh://git@github.com/FTShare-Lab/dsh-plugin-fft-bundle.git#path:packages/dsh-fft-bundle
```

重贴同一 spec 即更新到默认分支最新提交（默认分支是只前移到发布提交的 `stable`，所以拿到的是稳定版）；装前先卸掉旧的 `link:` 安装。要试开发中的最新版，把 spec 末尾的 `#path:` 换成 `#dev&path:`。

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
