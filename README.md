# ERP 智能助手 · 前端

制造业 ERP 智能助手的前端应用 —— 为 [**ERP AI Assistant**](https://github.com/Duduke-dev/erp-ai-assistant)（后端）提供 Web 界面，覆盖对话、知识库、工具、计费、平台五个业务模块。

对话页支持 **SSE 流式输出**、停止生成、多轮会话切换、引用来源展示与 Markdown 渲染；知识库页支持文档上传与解析进度轮询、检索自测、死信重投。

> **技术栈**：Vue 3.5 · TypeScript 6 · Vite 8 · vue-router 5 · Pinia 4 · Naive UI 2.45 · Tailwind CSS v4 · marked + DOMPurify
>
> **包管理器**：bun

---

## 一、页面一览

| 路由 | 页面 | 能力 |
|---|---|---|
| `/login` | 登录 | 账号密码登录，Token 存 localStorage，刷新页面自动恢复会话 |
| `/chat` | 对话 | SSE 流式问答、停止生成、会话列表与历史消息、引用来源、warning 提示、Markdown 表格渲染 |
| `/knowledge` | 知识库 | 知识库增删改、文档上传与版本替换、解析阶段轮询、纯向量检索自测、死信列表与重投/丢弃 |
| `/tools` | 工具 | 动态 SQL Tool 的配置与维护 |
| `/billing` | 计费 | 账户额度、用量记录、套餐与流水 |
| `/platform` | 平台 | 租户管理与用户角色 |

除登录页外，其余页面都挂在应用外壳 `AppLayout` 下，左侧导航只实现一次。

---

## 二、快速开始

### 2.1 前置条件

**先启动后端**：<https://github.com/Duduke-dev/erp-ai-assistant>（默认 `http://localhost:8080`）。前端不提供任何 mock，所有页面都依赖真实接口。

### 2.2 安装与运行

```bash
git clone https://github.com/Duduke-dev/erp-ai-assistant-web.git
cd erp-ai-assistant-web

bun install
bun run dev          # http://localhost:5173
```

若本地已与后端放在同一父目录（`../erp-ai-assistant-web`），直接 `bun install && bun run dev` 即可。

**后端不在默认端口时**用环境变量覆盖，不必去占用别人的 8080：

```bash
VITE_BACKEND_ORIGIN=http://localhost:8081 bun run dev
```

### 2.3 演示账号

登录需要填**租户编码**——用户名只在租户内唯一，登录接口的 `entCode` 是必填项：

| 租户编码 | 账号 | 密码 | 角色 |
|---|---|---|---|
| `DEMO` | `admin` | `123456` | 管理员 |
| `DEMO` | `viewer` | `123456` | 只读访客 |

租户 `DEMO` 与演示数据由后端的 Flyway 种子脚本（`V3` / `V17`）创建，所以**必须先让后端把迁移跑完**，否则登录会查不到用户。

### 2.4 常用命令

| 命令 | 说明 |
|---|---|
| `bun run dev` | 启动开发服务器（端口 5173） |
| `bun run build` | 类型检查（`vue-tsc`）+ 生产构建，输出到 `dist/` |
| `bun run preview` | 本地预览构建产物 |

---

## 三、目录结构

```
src/
├── api/            接口层，一个后端模块一个文件
│   ├── http.ts         统一请求封装：信封拆解、认证头、401 处理
│   ├── chat.ts         对话（含手写 SSE 解析）
│   ├── knowledge.ts    知识库 / 文档 / 死信
│   ├── auth.ts         billing.ts  platform.ts  tool.ts
├── components/     可复用组件
│   ├── MarkdownViewer.vue   Markdown 渲染（marked + DOMPurify）
│   └── CitationList.vue     引用来源列表
├── layouts/
│   └── AppLayout.vue   应用外壳：左侧导航 + 内容区
├── views/          页面组件，与路由一一对应
├── router/
│   └── index.ts        路由表 + 登录守卫 + 401 跳转注册
├── stores/
│   └── auth.ts         登录态（Pinia）
├── styles/
│   └── tailwind.css    Tailwind 选择性导入 + 自定基线
├── types/
│   └── api.ts          后端契约类型（信封 / DTO / SSE 事件负载）
├── utils/
│   └── time.ts         相对时间格式化
├── App.vue
└── main.ts
```

---

## 四、关键实现说明

### 4.1 为什么全站用原生 `fetch`，不引 axios

流式接口**必须**用 fetch（原因见 4.2）。既然流式那一套认证与错误处理已经要手写，普通请求再引入一套 axios 拦截器就意味着**两份认证逻辑、两份错误处理**——迟早会各自演化出不同行为。所以只保留一份实现。

`src/api/http.ts` 负责：

- 拆响应信封 `Result{code, message, data}`，`code !== 200` 一律抛 `ApiError`
- 自动附加认证头（header 名 `satoken`，**必须与后端 `sa-token.token-name` 保持一致**）
- 401 统一处理：清 Token → 清用户缓存 → 跳登录页并带上 `redirect`
- 空响应体（204）按「成功且无返回」处理
- 非 JSON 响应单独报错——那种情况通常说明请求打到的不是本后端（例如被代理吞掉的 502 页面），报「合法 JSON」错误比抛解析异常更好定位

**上传接口刻意不复用这套封装**：`request` 里硬编码了 `Content-Type: application/json`，而 multipart 的 Content-Type 必须由浏览器生成（要带 boundary）。手写或沿用 JSON 头会让后端解析不出文件，**症状是「文件字段为 null」且不报格式错**，非常难查。

### 4.2 SSE 流式：为什么不用 `EventSource`

`EventSource` 只能发 GET、且不允许自定义请求头。而本项目的流式提问是 **POST + JSON body + `satoken` 头**——三样它都做不到。

所以 `src/api/chat.ts` 用 `fetch` + `ReadableStream` 手写解析。SSE 协议本身很小：`event:` / `data:` 两种行，空行分帧，`:` 开头的是心跳注释帧。实现上有三处必须处理对：

1. **半帧问题**：一次 `read()` 可能拿到多帧、也可能只有半帧。按 `\r?\n\r?\n` 切分，**剩下的残片留在 buffer 里**等下次拼接。不这么做会在网络抖动时随机丢内容。
2. **结束时的残留帧**：流结束时若还有未以空行结尾的内容，要再处理一次。
3. **未知事件类型忽略而非报错**：后端将来新增事件时，旧前端仍能正常工作。

**停止生成**通过 `AbortSignal` 中断 fetch：浏览器关闭连接后，后端的 `onCompletion` 会 dispose 上游模型调用（否则模型会继续生成并计费）。主动中断不算错误，不做错误提示。

### 4.3 路由与登录守卫

```
/login                    公开
/  → AppLayout           需要登录，子路由 chat / knowledge / tools / billing / platform
/:pathMatch(.*)*          重定向到对话页
```

- 根路径重定向到 `chat`——那是本项目的主入口，比停在 404 有用
- 未登录访问受保护路由 → 跳登录页并记录 `redirect`，登录后原路返回
- **页面全部动态 import**：首屏只加载登录页与对话页外壳，其余页面不拖慢首屏
- 「服务端会话失效」的回调**注册在路由之后、回调内部才取 store**：模块加载顺序不确定，在回调外取 store 可能在 pinia 初始化之前执行

### 4.4 Tailwind v4 与 Naive UI 共存

本项目的主样式系统是 **Naive UI**（组件自带完整样式），Tailwind 只用于布局工具类。

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
```

两个必须遵守的点：

- **刻意不 import `preflight.css`**。它会重置 button / input / 标题 / 列表等基础样式，与 Naive 自身的 reset 叠加会改坏组件外观，且症状零散——表现为「某个组件看着怪怪的」，极难定位到是 reset 冲突。preflight 缺席后浏览器默认样式仍在，`tailwind.css` 里只补了 `html/body/#app` 高度与滚动条这几条真正必要的。
- **`@layer` 声明不能删**。utilities 的层级优先级依赖它，删掉会让覆盖关系反过来（Naive 组件样式压住 Tailwind 工具类）。

### 4.5 Markdown 渲染必须净化

对话回答用 `marked` 渲染、`DOMPurify` 净化后 `v-html` 注入。

**这不是可选项**：渲染的是模型输出，而模型输出里混着**知识库文档的原文**（RAG 会把检索片段喂给模型）。也就是说这段 HTML 的来源链路上存在「用户可间接影响的内容」——一旦文档里被塞进 `<script>` 或 `<img onerror=...>`，直接 `innerHTML` 就等于执行任意脚本。

净化策略用白名单：只放行常规文档标签（含 `table` 系列），明确排除 `script` / `style` / `iframe` / `form`；属性只留 `href` / `title` / `target` / `rel`。同时**不启用原始 HTML 透传**，也不做代码高亮（ERP 问答里代码块极少，为此再引一个高亮库不划算）。

> 消息区外层是 `overflow-hidden`，而 ERP 查询结果常是 6~10 列的宽表格，因此表格样式需要 `display: block` + `width: max-content` + `max-width: 100%` + `overflow-x: auto`。少了这套，宽表格会被**直接裁掉且无法查看**，表现为「表格看着正常，只是右边少了几个字段」，很难被意识到。

### 4.6 后端时间字符串要显式解析

后端 `LocalDateTime` 序列化成 `2026-09-17T23:26:00.23495`——**没有时区标记**，且小数秒是 **5 位**（不是标准的 3 位）。

直接丢给 `new Date()` 有风险：个别实现会对非 3 位小数秒返回 `Invalid Date`。所以 `utils/time.ts` 显式拆分并截断到毫秒、按本地时间构造。时钟偏差导致的「未来时间」按「刚刚」处理，不显示负数。

另外，相对时间文案必须**定时刷新**，否则列表里的「刚刚」永远不会变。

---

## 五、与后端的契约

改后端时若动了以下任一项，前端必须同步：

| 契约 | 前端位置 | 说明 |
|---|---|---|
| 认证头名 `satoken` | `api/http.ts` 的 `TOKEN_HEADER` | 对应后端 `sa-token.token-name` |
| 登录入参含 `entCode` | `types/api.ts` 的 `LoginPayload` | 用户名只在租户内唯一，因此登录时租户**由请求体提供**；登录接口被排除在租户拦截器之外，其余接口的租户均取自会话 |
| 响应信封 `Result{code, message, data}` | `types/api.ts` + `api/http.ts` | 业务失败用 `code` 判定，非 HTTP 状态码 |
| SSE 事件类型 | `api/chat.ts` 的 `dispatch` | 当前：`meta` / `delta` / `citations` / `warning` / `done` / `error` |
| 接口路径 | 各 `api/*.ts` | 后端规约：POST 新建 / PUT 更新 / DELETE 删除 / GET 查询 |
| 时间格式 | `utils/time.ts` | 无时区 + 5 位小数秒 |

---

## 六、构建与部署

```bash
bun run build      # 产物在 dist/，纯静态文件
```

生产部署时 `dist/` 是纯静态资源，`/api` 由网关或反向代理转发到后端。**Vite 的 proxy 配置只对本地开发生效**，不要在部署环境指望它。

若用 Nginx 之类做反代，注意转发 SSE 时要关闭缓冲（否则流式回答会等整段生成完才一次性到达浏览器，表现为「点了半天没反应，然后整段蹦出来」）：

```nginx
location /api/ {
    proxy_pass http://backend:8080;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

> 本地开发时这一步由 `vite.config.ts` 的 `proxyRes` 钩子代劳：给响应加上 `x-accel-buffering: no`。

---

## 七、开发约定与已知坑

### 7.1 TypeScript 6 的两个约束

- **`baseUrl` 已弃用**（TS5101）：路径别名只保留 `paths`（见 `tsconfig.app.json`）。
- **`erasableSyntaxOnly: true`**：禁止构造器参数属性这类「运行时需要生成代码」的语法。所以 `ApiError` 的字段是显式声明 + 构造器里赋值，而不是 `constructor(readonly code: number)`。该选项的意义是让 TS 语法能被整体擦除，便于用 Node 直接跑 TS 源码。

### 7.2 高度三层收口（踩过坑）

页面根容器用 `h-dvh min-h-0 overflow-hidden`，中间层 `aside` / `section` **必须加 `min-h-0`**，固定区 `header` / `footer` 用 `shrink-0`。

漏掉中间层的 `min-h-0`，flex 子项会被内容撑高、溢出转交给 `body`，结果是**左右两栏一起滚动**——而不是各自区域内滚动。

### 7.3 新增依赖前先确认它是否真的被用到

图表功能移除后，`echarts` 曾在 `package.json` 里长期留着却**源码零引用**。引入依赖是成本，移除依赖同样是收益——定期 `grep` 一下很有必要。

### 7.4 目前没有测试框架

项目未引入 vitest / jest。需要验证纯函数（如 `utils/time.ts`）时，可以用 `bun run <脚本>.ts` 直接执行 TS 源码——得益于 `erasableSyntaxOnly`，不需要编译步骤。

---

## 八、相关仓库

| 仓库 | 说明 |
|---|---|
| [Duduke-dev/erp-ai-assistant](https://github.com/Duduke-dev/erp-ai-assistant) | **后端**：Spring Boot 4 + Spring AI 2，Tool Calling / RAG / 多租户 / 计费 |
| [Duduke-dev/erp-ai-assistant-web](https://github.com/Duduke-dev/erp-ai-assistant-web) | 本仓库（前端） |
