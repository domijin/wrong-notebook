# Smart Wrong Notebook (智能错题本)

一个基于 AI 的智能错题管理系统，帮助学生高效整理、分析和复习错题。

## ✨ 主要功能

- **🤖 AI 智能分析**：自动识别题目内容，生成解析、知识点标签和同类练习题。
- **⚙️ 灵活的 AI 配置**：支持 **Google Gemini** 和 **OpenAI** (及兼容接口) 两种 AI 提供商，可直接在网页设置中动态切换和配置。
- **📚 多错题本管理**：支持按科目（如数学、物理、英语）创建和管理多个错题本。
- **🏷️ 智能标签系统**：自动提取知识点标签，支持自定义标签管理。
- **🔍 多维度筛选**：支持按掌握状态、时间范围、知识点标签、年级学期、试卷等级等多种条件筛选错题。
- **🖨️ 灵活导出打印**：一键导出筛选后的错题，支持自定义打印内容（答案/解析/知识点）和图片缩放比例，可直接打印或保存为 PDF。
- **📝 智能练习**：基于错题生成相似的练习题，巩固薄弱环节。
- **📊 数据统计**：可视化展示错题掌握情况和学习进度。
- **🔐 用户管理**：支持多用户注册、登录，数据安全隔离。
- **🛡️ 管理员后台**：提供用户管理功能，可禁用/启用用户、删除违规用户。
- **🔒 安全加固（Tier A + B2）**：设置页管理员鉴权、密钥不回传、IDOR 修复、AI 出口白名单、session 撤销、步进鉴权 + 审计。详见 [SECURITY.md](SECURITY.md)。


## 📸 屏幕截图功能 (HTTPS 设置)

本应用的屏幕截图功能依赖浏览器的安全上下文 (HTTPS)。在 Docker 或局域网环境中使用时，请参考 **[HTTPS 配置指南](doc/HTTPS_SETUP.md)** 启用内置 HTTPS 支持。

## 📱 PWA 支持 (添加到主屏幕)

本项目支持 PWA (Progressive Web App)，您可以将应用添加到手机主屏幕，获得原生应用般的使用体验。

**功能特性**：
- 🚀 **快速启动**：点击主屏幕图标直接打开，无需输入网址。
- 📱 **沉浸体验**：全屏运行，无浏览器地址栏干扰。
- 🎨 **原色适配**：应用图标和启动画面适配系统主题。

**使用方法**：

- **iPhone / iPad (Safari)**: 点击底部 **分享** 按钮 -> 选择 **"添加到主屏幕"**。
- **Android (Chrome)**: 点击右上角 **菜单** -> 选择 **"添加到主屏幕"** 或 **"安装应用"**。

## 🔒 Private deploy (recommended: Tailscale)

This app is built for a small, trusted group (family, your own kids, a small
class). **Do not expose it directly to the public internet.** Run it on a
limited-access server and reach it through a [Tailscale](https://tailscale.com/)
tailnet. Compose binds the container to `127.0.0.1:3000`; expose HTTPS via
Tailscale Serve.

### 1. Required environment

```bash
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"   # required, >= 32 chars; placeholders are rejected at startup
export NEXTAUTH_URL="https://notebook.example-tailnet.ts.net"  # exact HTTPS URL the client uses
export ADMIN_EMAIL="you@example.com"                 # creates the first admin on first run with an empty DB
export ADMIN_PASSWORD="$(openssl rand -base64 18)"     # 12–72 bytes; remove after the first successful login
```

> Production startup validates `NEXTAUTH_SECRET`. Missing, too short, or
> placeholder values (e.g. `supersecret-dev-secret`) cause the process to exit.

### 2. Start with Docker

```bash
docker compose up -d
```

Compose binds the published port to `127.0.0.1:3000` so it is not reachable
from outside the host. SQLite lives in `./data`, and `app-config.json` lives
in `./config`; keep both directories private.

### 3. Expose HTTPS via Tailscale Serve (recommended)

On the machine running the container:

```bash
sudo tailscale serve --bg --https=443 \
  --set-path=/ http://127.0.0.1:3000
```

Share `<machine-name>.ts.net` with the people on your allowlist. **Do not**
use `tailscale funnel` — it would expose the service on the public internet.

### 4. Optional: Tailscale Funnel for a small allowlist

Only if you can lock access down with device approval and ACL tags:

```bash
sudo tailscale funnel --bg 443 http://127.0.0.1:3000
```

Tighten the Tailscale ACL:

```json
{
  "acls": [
    { "action": "accept", "src": ["tag:trusted"], "dst": ["tag:server:443"] }
  ],
  "tagOwners": { "tag:trusted": ["autogroup:admin"] }
}
```

### 5. Users and keys

- The first admin is created on first run from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- `allowRegistration` defaults to **off**. Add new users from “Settings → User Management”.
- After login, configure AI providers (Gemini / OpenAI / Azure) in the
  settings page. The API only returns `keyConfigured`; raw keys never leave
  the server.
- Rotate any legacy default passwords and sign out all sessions.
- The Openclaw integration is disabled by default. To enable it, set
  `OPENCLAW_API_URL`; in apikey mode also set `OPENCLAW_USER_EMAIL` to bind
  the shared key to a single trusted account.

### 6. Verify

```bash
# App should only listen on loopback
ss -lnt | grep ':3000' | grep 127.0.0.1

# Startup must see a real NEXTAUTH_SECRET; missing causes exit
docker logs wrong-notebook | grep -i "NEXTAUTH_SECRET" || true
```

Full threat model, residual risks, and operator notes: [SECURITY.md](SECURITY.md).

---

## 🔒 私有部署（推荐：Tailscale）

本应用面向小范围可信用户（家人、自家小孩、同学小群），**不要直接暴露在公网**。推荐使用 [Tailscale](https://tailscale.com/) 把服务接入你的私有 tailnet，Compose 默认绑定 `127.0.0.1:3000`，再通过 Tailscale Serve 暴露 HTTPS。

### 1. 准备环境变量

```bash
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"   # 必填，至少 32 字符；占位/默认值会被启动时拒绝
export NEXTAUTH_URL="https://notebook.example-tailnet.ts.net"  # 必须是客户端实际访问的 HTTPS URL
export ADMIN_EMAIL="you@example.com"                 # 首次启动空数据库时创建管理员
export ADMIN_PASSWORD="$(openssl rand -base64 18)"     # 至少 12 字符、最多 72 字节；首次登录后移除
```

> 生产启动会校验 `NEXTAUTH_SECRET`：缺失、过短、占位值（如 `supersecret-dev-secret`）会直接退出。

### 2. 启动 Docker

```bash
docker compose up -d
```

Compose 文件已经把容器端口绑到 `127.0.0.1:3000`，外部无法直连。`./data` 存 SQLite，`./config` 存 `app-config.json`，请保持这两个目录的权限私有。

### 3. 用 Tailscale Serve 暴露 HTTPS（推荐）

在运行容器的机器上：

```bash
sudo tailscale serve --bg --https=443 \
  --set-path=/ http://127.0.0.1:3000
```

把 `<machine-name>.ts.net` 给允许的人。**不要**用 `tailscale funnel`（那是公网暴露）。

### 4. （可选）Tailscale Funnel 给特定用户

只有在你能接受被加上 ACL / device approval 限制的访问者时，才考虑 Funnel：

```bash
sudo tailscale funnel --bg 443 http://127.0.0.1:3000
```

并在 Tailscale ACL 里收紧：

```json
{
  "acls": [
    { "action": "accept", "src": ["tag:trusted"], "dst": ["tag:server:443"] }
  ],
  "tagOwners": { "tag:trusted": ["autogroup:admin"] }
}
```

### 5. 用户与密钥

- 首次启动时由 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 创建第一个管理员。
- `allowRegistration` 默认关闭。需要新用户时由管理员在“设置 → 用户管理”里创建。
- 登录后到“设置”里配置 AI 提供商（Gemini / OpenAI / Azure），页面只回传 `keyConfigured`，不会回传明文 key。
- 轮换任何历史默认密码后登出所有会话。
- Openclaw 集成默认禁用；启用时需配置 `OPENCLAW_API_URL`，apikey 模式还需 `OPENCLAW_USER_EMAIL` 把共享 key 绑定到单一可信账户。

### 6. 验证

```bash
# 应用只对 loopback 监听
ss -lnt | grep ':3000' | grep 127.0.0.1

# 启动必须读到真实 NEXTAUTH_SECRET；缺失会退出
docker logs wrong-notebook | grep -i "NEXTAUTH_SECRET" || true
```

完整威胁模型、剩余风险和运维说明：[SECURITY.md](SECURITY.md)。

---

## 🔒 Private deploy (recommended: Tailscale)

This app is built for a small, trusted group (family, your own kids, a small
class). **Do not expose it directly to the public internet.** Run it on a
limited-access server and reach it through a [Tailscale](https://tailscale.com/)
tailnet. Compose binds the container to `127.0.0.1:3000`; expose HTTPS via
Tailscale Serve.

### 1. Required environment

```bash
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"   # required, >= 32 chars; placeholders are rejected at startup
export NEXTAUTH_URL="https://notebook.example-tailnet.ts.net"  # exact HTTPS URL the client uses
export ADMIN_EMAIL="you@example.com"                 # creates the first admin on first run with an empty DB
export ADMIN_PASSWORD="$(openssl rand -base64 18)"     # 12–72 bytes; remove after the first successful login
```

> Production startup validates `NEXTAUTH_SECRET`. Missing, too short, or
> placeholder values (e.g. `supersecret-dev-secret`) cause the process to exit.

### 2. Start with Docker

```bash
docker compose up -d
```

Compose binds the published port to `127.0.0.1:3000` so it is not reachable
from outside the host. SQLite lives in `./data`, and `app-config.json` lives
in `./config`; keep both directories private.

### 3. Expose HTTPS via Tailscale Serve (recommended)

On the machine running the container:

```bash
sudo tailscale serve --bg --https=443 \
  --set-path=/ http://127.0.0.1:3000
```

Share `<machine-name>.ts.net` with the people on your allowlist. **Do not**
use `tailscale funnel` — it would expose the service on the public internet.

### 4. Optional: Tailscale Funnel for a small allowlist

Only if you can lock access down with device approval and ACL tags:

```bash
sudo tailscale funnel --bg 443 http://127.0.0.1:3000
```

Tighten the Tailscale ACL:

```json
{
  "acls": [
    { "action": "accept", "src": ["tag:trusted"], "dst": ["tag:server:443"] }
  ],
  "tagOwners": { "tag:trusted": ["autogroup:admin"] }
}
```

### 5. Users and keys

- The first admin is created on first run from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- `allowRegistration` defaults to **off**. Add new users from “Settings → User Management”.
- After login, configure AI providers (Gemini / OpenAI / Azure) in the
  settings page. The API only returns `keyConfigured`; raw keys never leave
  the server.
- Rotate any legacy default passwords and sign out all sessions.
- The Openclaw integration is disabled by default. To enable it, set
  `OPENCLAW_API_URL`; in apikey mode also set `OPENCLAW_USER_EMAIL` to bind
  the shared key to a single trusted account.

### 6. Verify

```bash
# App should only listen on loopback
ss -lnt | grep ':3000' | grep 127.0.0.1

# Startup must see a real NEXTAUTH_SECRET; missing causes exit
docker logs wrong-notebook | grep -i "NEXTAUTH_SECRET" || true
```

Full threat model, residual risks, and operator notes: [SECURITY.md](SECURITY.md).

---

## 🛠️ 技术栈

- **框架**: [Next.js 16](https://nextjs.org/) (App Router)
- **UI 库**: [React 19](https://react.dev/)
- **数据库**: [SQLite](https://www.sqlite.org/) (via [Prisma](https://www.prisma.io/))
- **样式**: [Tailwind CSS v4](https://tailwindcss.com/) + [Shadcn UI](https://ui.shadcn.com/)
- **AI**: Google Gemini API / OpenAI API / Azure OpenAI
- **认证**: [NextAuth.js](https://next-auth.js.org/)

## 🚀 快速开始

> Planning a public or shared-network deploy? Read [🔒 Private deploy (Tailscale)](#-private-deploy-recommendedtailscale) first.

### 方式一：使用 Docker 部署

#### 1. 启动服务

您可以选择 **直接使用命令** (适合快速测试) 或 **Docker Compose** (适合长期运行)。

**选项 A：直接使用 Docker 命令**

```bash
docker run -d --name wrong-notebook \
  -e NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  -e NEXTAUTH_URL="$NEXTAUTH_URL" \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -p 127.0.0.1:3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/config:/app/config \
  ghcr.io/wttwins/wrong-notebook
```

**选项 B：使用 Docker Compose (推荐)**

使用 `docker-compose.yml` 文件进行管理。

1.  **下载配置文件**：
    ```bash
    curl -o docker-compose.yml https://raw.githubusercontent.com/wttwins/wrong-notebook/refs/heads/main/docker-compose.yml
    ```
2.  **启动服务**：
    ```bash
    docker-compose up -d
    ```
3.  **查看日志**：
    ```bash
    docker-compose logs -f
    ```
4.  **停止服务**：
    ```bash
    docker-compose down
    ```

### 方式二：本地源码运行

#### 1. 克隆仓库

```bash
git clone https://github.com/wttwins/wrong-notebook.git
cd wrong-notebook
```

#### 2. 环境准备

确保已安装 Node.js (v18+) 和 npm。

#### 3. 安装依赖

```bash
npm install
```

#### 4. 配置环境变量

复制 `.env.example` 为 `.env` 并填入必要的配置：

```bash
cp .env.example .env
```

**基础配置**

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | 数据库连接地址 | `file:./dev.db` | SQLite 数据库路径 |
| `NEXTAUTH_SECRET` | Auth 密钥 | 无 | 生产环境必须设置随机密钥（至少 32 字符），使用 openssl rand -base64 32 生成 |
| `NEXTAUTH_URL` | 访问地址 | `http://your-domain-name:3000` | 部署后的访问地址 |
| `AUTH_TRUST_HOST` | 信任主机头 | `true` | 设置为 `true` 时自动推断 URL，适合 Docker/PaaS |
| `LOG_LEVEL` | 日志级别 | `debug` (开发) / `info` (生产) | 可选值：`trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `HTTP_PROXY` | HTTP 代理 | 无 | 设置 HTTP 代理 |
| `HTTPS_PROXY` | HTTPS 代理 | 无 | 设置 HTTPS 代理 |

**AI 配置**

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `AI_PROVIDER` | AI 提供商 | `gemini` | 可选 `gemini`、`openai` 或 `azure` |

**Gemini 配置**

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `GOOGLE_API_KEY` | Gemini API Key | 无 | 使用 Gemini 时必填，从 [Google AI Studio](https://aistudio.google.com/apikey) 获取 |
| `GEMINI_BASE_URL` | Gemini API 地址 | 无 | 可选，默认 `https://generativelanguage.googleapis.com`，通常无需修改 |
| `GEMINI_MODEL` | Gemini 模型 | `gemini-2.5-flash` | 可选，如 `gemini-2.5-pro`、`gemini-3.0-flash` 等 |

**OpenAI 配置**

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `OPENAI_API_KEY` | OpenAI API Key | 无 | 使用 OpenAI 时必填，从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取 |
| `OPENAI_BASE_URL` | OpenAI API 地址 | 无 | 可选，默认 `https://api.openai.com/v1`；使用第三方兼容服务时填写对应地址 |
| `OPENAI_MODEL` | OpenAI 模型 | `gpt-4o` | 可选，如 `gpt-4-turbo`、`o3`、`o4-mini` 等 |

**Azure OpenAI 配置**

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `AZURE_OPENAI_API_KEY` | Azure API Key | 无 | 使用 Azure OpenAI 时必填，从 Azure 门户获取 |
| `AZURE_OPENAI_ENDPOINT` | Azure Endpoint | 无 | Azure 资源端点，如 `https://xxx.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | 部署名称 | 无 | Azure 中配置的部署名称，如 `gpt-4o` |
| `AZURE_OPENAI_API_VERSION` | API 版本 | `2024-02-15-preview` | 可选，Azure API 版本 |
| `AZURE_OPENAI_MODEL` | Azure 模型 | `gpt-4o` | 可选，显示用的模型名称 |

#### 5. 初始化数据库

```bash
npx prisma migrate dev
npx prisma db seed
```

#### 6. 管理员账户

没有默认管理员账户。首次初始化空数据库前，设置 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`（至少 12 字符、最多 72 字节）。已有账户不会在重启时恢复权限或启用状态。首次成功创建后移除 `ADMIN_PASSWORD`。

注册默认关闭。生产部署必须使用随机 `NEXTAUTH_SECRET`（至少 32 字符），并将 `NEXTAUTH_URL` 设置为 Tailscale Serve 的 HTTPS 地址。详见 [私有部署安全配置](SECURITY.md)。

> 管理员登录后，可在“设置” -> “用户管理”中管理系统用户。

#### 7. 启动开发服务器

```bash
npm run dev
```

访问 [http://your-domain-name:3000](http://your-domain-name:3000) 开始使用。

## ⚙️ AI 模型配置

本项目支持动态配置 AI 模型，无需重启服务器。

1.  **进入设置**：点击首页右上角的设置图标。
2.  **选择提供商**：支持 Google Gemini、OpenAI 和 **Azure OpenAI**。
3.  **填写参数**：
    *   **通用参数**: API Key、Base URL（或 Endpoint）、Model Name（或 Deployment Name）。
    *   **Azure 特有**: Deployment Name（部署名称）、API Version（API 版本）。
4.  **保存生效**：点击保存后即刻生效。

> **注意**：网页配置会保存到 `config/app-config.json` 文件中，该文件的优先级高于 `.env` 环境变量。

### 配置样例

选择提供商后，填写对应参数即可。各服务商获取方式如下：

#### Google Gemini

| 参数 | 获取方式 |
| :--- | :--- |
| API Key | [Google AI Studio](https://aistudio.google.com/apikey) → 创建 API Key |
| Base URL | 默认 `https://generativelanguage.googleapis.com`，通常无需修改 |
| 模型 | `gemini-2.5-flash`（推荐）、`gemini-2.5-pro`、`gemini-3.0-flash` 等 |

#### OpenAI

| 参数 | 获取方式 |
| :--- | :--- |
| API Key | [OpenAI Platform](https://platform.openai.com/api-keys) → Create new secret key |
| Base URL | 默认 `https://api.openai.com/v1` |
| 模型 | `gpt-4o`（推荐）、`gpt-4-turbo`、`o3`、`o4-mini` 等 |

> **兼容模式**：OpenAI 提供商兼容所有支持 OpenAI API 格式的第三方服务。只需将 Base URL 改为对应服务地址，即可使用硅基流动、智谱 GLM、月之暗面 Kimi、通义千问 DashScope 等平台的模型。模型名称需填写对应平台的完整模型 ID。

#### Azure OpenAI

| 参数 | 获取方式 |
| :--- | :--- |
| API Key | Azure 门户 → 你的 OpenAI 资源 → 密钥和终结点 |
| Endpoint | Azure 门户 → 你的 OpenAI 资源 → 终结点，如 `https://xxx.openai.azure.com` |
| 部署名称 | Azure 中配置的模型部署名称，如 `gpt-4o` |
| API 版本 | 默认 `2024-02-15-preview` |
| 模型 | 显示用的模型名称，如 `gpt-4o` |

## 🛠️ 实用脚本

在 `scripts/` 目录下提供了一些实用脚本，用于维护和调试：

- **重置密码**:
  ```bash
  node scripts/reset-password.js <邮箱> <新密码>
  ```
  示例:
  ```bash
  node scripts/reset-password.js user@example.com "<strong-new-password>"
  ```

## 📄 许可证

MIT License
