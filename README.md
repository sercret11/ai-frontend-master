# ai-frontend-master

后端与前端一体化项目，支持本地运行与 Docker 运行。

## 环境变量

以下变量建议配置在根目录 `.env`（Docker Compose 也会读取）：

```env
# AI provider
AI_DEFAULT_PROVIDER=openai
AI_DEFAULT_MODEL=gpt-5.3-codex
AI_MAX_TOKENS=8192
AI_TEMPERATURE=7
AI_TOP_P=9
AI_REASONING_EFFORT=xhigh

# UI/UX design_search 数据目录
UI_UX_DATA_PATH=./ui-ux-data

# UI/UX design_search 评分权重（非负数）
UI_UX_SEARCH_WEIGHT_EXACT_QUERY=12
UI_UX_SEARCH_WEIGHT_TOKEN_TEXT=2
UI_UX_SEARCH_WEIGHT_TOKEN_TITLE=3
UI_UX_SEARCH_WEIGHT_TOKEN_KEYWORDS=2
UI_UX_SEARCH_WEIGHT_HYPHEN=1

# server
PORT=3001
HOST=0.0.0.0
NODE_ENV=production
FRONTEND_URL=http://localhost:5190
```

### design_search 权重说明

- `UI_UX_SEARCH_WEIGHT_EXACT_QUERY`：整句命中加权。
- `UI_UX_SEARCH_WEIGHT_TOKEN_TEXT`：token 命中文档全文加权。
- `UI_UX_SEARCH_WEIGHT_TOKEN_TITLE`：token 命中标题加权。
- `UI_UX_SEARCH_WEIGHT_TOKEN_KEYWORDS`：token 命中关键词字段加权。
- `UI_UX_SEARCH_WEIGHT_HYPHEN`：命中连字符 token（如 `apple-style`）额外加权。

说明：
- 权重为非负数。
- 未配置、为空或非法值会回退到默认值。

## 快速启动

```bash
docker compose up -d --build backend frontend
```

健康检查：

```bash
curl http://localhost:3001/health
```

## Context7 MCP 直连部署

推荐直接部署 `@upstash/context7-mcp`，后端通过 MCP 协议连接，不再依赖自定义上游转发 URL。

### 方式 1：Docker Compose（已内置）

`docker-compose.yml` 已包含 `context7-mcp` 服务，后端默认连接：

`CONTEXT7_MCP_URL=http://context7-mcp:3000/mcp`

可选配置（根目录 `.env`）：

```env
CONTEXT7_API_KEY=your_context7_api_key
```

启动：

```bash
docker compose up -d --build context7-mcp backend frontend
```

### 方式 2：本地单独启动 MCP 服务

```bash
npx -y @upstash/context7-mcp --transport http --port 3999
```

然后将后端环境变量配置为：

```env
CONTEXT7_MCP_URL=http://127.0.0.1:3999/mcp
CONTEXT7_API_KEY=your_context7_api_key
```
