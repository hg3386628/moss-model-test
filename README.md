# MOSS 模型测试页

面向 [MOSS 开放平台](https://platform.moss.cn/docs) 的本地单页测试工具，覆盖对话、语音合成、语音转写、图片理解与文生图。

官方 API 基址是 `https://api.mosi.cn`，鉴权头为 `Authorization: Bearer <API Key>`。该域名的浏览器 CORS 预检会返回 403，且响应中没有 `Access-Control-Allow-Origin`，所以浏览器无法直连。请用下面的本地代理打开本页面。

## 运行

需要 Node.js 18+（零依赖，不必 `npm install`）。

```bash
# 可选：让代理代为附带密钥，页面可不填
export MOSS_API_KEY="你的密钥"
# 可选，默认即官方地址
export MOSS_API_ORIGIN="https://api.mosi.cn"

node server.js
```

浏览器打开 http://127.0.0.1:8787

也可以在页面顶部填写 API Key。密钥只保存在当前浏览器的 `localStorage`，不会写入仓库或服务器磁盘。代理启动时如果已经设置了 `MOSS_API_KEY`，页面留空即可。

换端口：`PORT=9000 node server.js`


## 部署到 Uppcoder

本项目是零依赖 Node 服务（`npm start` → `node server.js`），监听 `process.env.PORT` 和 `0.0.0.0`，适合用 Uppcoder 的 Express / Node 模板从 GitHub 部署，不需要数据库。

1. 打开 [Uppcoder 登录页](https://portal.uppcoder.com/login)，建议直接用 GitHub 注册，可一步关联仓库。
2. 新建 Stack（第 1 个免费）。模板选 Node：Express（不必选 Next.js，也不必加 MySQL / PostgreSQL）。
3. 连接本仓库并按页面提示完成配置。`MOSS_API_KEY` 环境变量是**可选的**：不配置时，访问者在页面里自行填写 API Key（只保存在其浏览器 localStorage）。若在 Stack 里配置了该变量，页面也可以留空，由服务器代为附带密钥（注意不要把密钥写进仓库）。
4. 点击右上角 Deploy，完成后会收到邮件。

本地默认端口是 8787；Uppcoder 等平台会注入 `PORT`。

## 功能

| 页签 | 接口 | 说明 |
| --- | --- | --- |
| 对话 | `POST /v1/chat/completions` | `nex-n2.6` / 快照 `nex-n2.6-2026-11-05`，支持流式 SSE、系统提示、temperature，展示延迟、首 token 耗时和 Token 用量。限时免费。 |
| 语音合成 | `GET /v1/audio/voices` + `POST /v1/audio/speech` | `moss-tts-1.5-flash` 等。付费，约 ¥2.00 / 万字符。积分不足时返回 402。 |
| 语音转写 | `POST /v1/audio/transcriptions` | 上传音频。`moss-transcribe-1.0` 为普通转写（付费，约 ¥0.80 / 小时）。 |
| 图片理解 | `POST /v1/files` + `POST /v1/responses` | `moss-vl-1.0`。可上传图片或填写公网 URL。限时免费。不支持 Base64 内联。 |
| 文生图 | `POST /v1/images/generations` | `moss-image-base-1.0` / `moss-image-sft-1.0`。**付费**，低分辨率约 ¥0.20 / 张。积分不足时会 402。 |

右侧面板会显示原始请求与响应 JSON。展示时会打码任何形如 `sk-…` 的密钥。

## 安全

- 不要把 API Key 写进源码、提交到 Git，或放到 GitHub Pages。
- `server.js` 不会提供 `.moss_key`、`.env` 等点文件。
- 本仓库可以公开，但运行时的密钥请只放在环境变量或浏览器本地。

## 文档

- 快速开始：https://platform.moss.cn/docs/getting-started/quickstart
- 模型列表：https://platform.moss.cn/docs/models
- API 概览：https://platform.moss.cn/docs/reference
