# 闪存视频 FlashSave

全网视频一键保存网站。粘贴链接即可解析并下载视频，支持 B站、抖音等上千平台，高清原画、无水印、仅音频 MP3、批量/合集下载，手机电脑都能用。

底层站在开源巨人肩膀上：**通用平台封装 [yt-dlp](https://github.com/yt-dlp/yt-dlp)（零改动）**，**抖音走专用免登录解析模块**。后端单进程、无数据库，尽量轻量。

> 仅供个人学习与备份，请尊重版权，勿用于商业用途。

---

## 快速启动

### 1. 准备运行环境
- Python 3.10+（本项目在 3.10.4 验证）
- 创建虚拟环境并安装依赖：
  ```bash
  python -m venv .venv
  .venv/Scripts/python -m pip install -r requirements.txt   # Windows
  # Linux/macOS: .venv/bin/python -m pip install -r requirements.txt
  ```

### 2. 准备下载工具（放在 `tools/` 目录，已被 gitignore）
| 工具 | 来源 | 用途 |
|---|---|---|
| `yt-dlp.exe` | [yt-dlp 官方 Release](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe) | 通用平台解析/下载引擎 |
| `ffmpeg.exe` / `ffprobe.exe` | [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds/releases)（win64-gpl zip 内 `bin/`） | 音视频合并、MP3 转换 |

Windows 直接用官方独立 `yt-dlp.exe`（自带 Python，不受本机 Python 版本限制）。
Linux/macOS 可 `pip install yt-dlp` 并把 `ffmpeg` 装上，代码会自动改用 PATH 中的 `yt-dlp`/`ffmpeg`。

### 3. 启动
- Windows：双击 `start.bat`
- 或命令行：
  ```bash
  .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
  ```
- 打开 http://127.0.0.1:8000

### 可选环境变量
| 变量 | 默认 | 说明 |
|---|---|---|
| `FREE_DAILY_LIMIT` | `5` | 每 IP 每日免费下载次数 |
| `MAX_FILESIZE` | `500M` | 单文件下载大小上限（yt-dlp `--max-filesize`） |

---

## 功能列表

- **链接解析**：封面、标题、作者、时长、可选清晰度列表
- **高清下载**：B站 1080P/720P/480P/360P，优先 H.264、强制 MP4 输出（手机兼容好）
- **抖音无水印**：专用模块，服务端自生成游客身份，无需用户登录/提供 cookie
- **仅音频 MP3**：B站直接抽流转换；抖音先下视频再用 ffmpeg 抽音频
- **实时进度**：百分比 + 下载速度，前端轮询展示
- **批量 / 合集**：多行链接（≤10）逐个解析；播放列表/合集解析（展示前 50 条）勾选下载
- **字幕下载**：平台自带字幕时可选（yt-dlp `--write-subs`）
- **免费额度 + 会员引导**：每日限额，超额友好提示并引导价格区
- **移动端适配**：375px 起完整可用
- **自动清理**：服务器文件 1 小时后自动删除，不留存用户视频

## 技术亮点

- **零改动封装 yt-dlp**：只用官方稳定接口（`-J`、`--print`、`--progress-template`），不解析易变的普通 stdout，yt-dlp 升级无需改代码
- **抖音免登录方案**：服务端生成游客 `ttwid` + 分享页 SSR 数据 + `playwm→play` 去水印，全程不碰用户登录态
- **轻量无数据库**：任务/额度/统计全内存，临时文件定时清理，单进程即可运行
- **安全边界**：URL 协议白名单、子进程列表参数 + `--` 分隔防注入、清晰度/字幕参数正则校验、前端 HTML 转义防 XSS
- **并发与体积保护**：下载并发 semaphore=3，单文件上限防磁盘被打爆

## 扩展方向（二期）

- 视频 AI 总结、字幕翻译（接大模型接口）
- 真实支付接入（微信/支付宝商户）+ 数据库持久化订单/额度
- Docker 部署到服务器（注意海外平台需海外网络/代理）
- 需登录平台改为「浏览器插件本地 cookie」模式（登录态只留在用户本机，不上服务端）
- 任务取消 API、下载历史持久化

## 已知限制

- YouTube 等海外平台：国内网络/服务器直连不通，需海外服务器或代理
- 需登录/已删除/风控视频无法下载（页面友好提示）
- 抖音依赖分享页接口，平台改版需跟进维护
- 无数据库：重启后额度/任务/统计清零

## 目录与文档

- 需求与设计见 [docs/需求分析.md](docs/需求分析.md)、[docs/方案设计.md](docs/方案设计.md)
- 代码结构：`app/`（后端）、`static/`（前端）、`tools/`（下载工具）、`downloads/`（临时文件）