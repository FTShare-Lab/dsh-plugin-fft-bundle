# @ft/dsh-fft-factor-intake-standard

FT 因子入库技能（`factor-intake-standard`）的 DSH 插件包：`dsh plugin add` 一次之后，每个会话的技能目录里就有「因子入库」，不需要手工往 `$DSH_HOME/skills` 拷文件。

## 使用方式

```bash
dsh plugin --profile desktop add git+ssh://git@github.com/FTShare-Lab/dsh-plugin-fft-bundle.git#path:packages/dsh-fft-factor-intake-standard
```

装上后模型用 `skill` 工具加载，或直接 `/factor-intake-standard`。

## 运行前提

- **uv**：脚本用 `uv run --with-requirements …` 按需加载解释器与依赖（`pandas` / `numpy` / `pyarrow` / `matplotlib`），不需要预建 venv，也不依赖 `PATH` 上的 Python。首次运行会从 PyPI 下载并缓存到 uv 的缓存目录。
- **FTShare API Key**：脚本自己从 DSH 解析，优先级为环境变量 `FTSHARE_API_KEY` → DSH 凭据文档 `$DSH_HOME/.credentials.yaml`（即「设置 → FTShare」写入的位置）→ `FTSHARE_API_KEY_FILE` → `~/.factor-intake/ftshare_api_key`。key 不写入命令、报告或仓库。
- 报告默认写到会话工作区的 `reports/` 下：DSH 的 Files 面板能直接渲染 HTML，聊天窗口不需要（也不能）用 `file://` 或本地 HTTP 服务打开。

## 开发方式

```bash
pnpm install
pnpm -C packages/dsh-fft-factor-intake-standard test
```

本包没有构建步骤：入口 `src/index.js` 直接发布，`lib/` 不存在，git 安装不需要安装期构建。

`skills/factor-intake-standard/` 由 `../dsh-ft` 的 `files/factor-intake-standard` 原样搬入（首个提交保持逐字节一致），本仓只做 DSH 适配：凭据解析、uv 运行方式、报告落点。
