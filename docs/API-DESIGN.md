# Java 迁移 REST API 设计

状态：实施接口合同，2026-11-11。Java21 + Spring Boot4.1.2后端与原生HTML/CSS/JavaScript前端已在 `backend/` 实现，并完成本地测试；尚未平台发布。本文与 [`openapi.yaml`](./openapi.yaml) 说明当前Java接口，旧Next.js实现不自动具有这些新约定。产品范围见 [`JAVA-MIGRATION-PRD.md`](./JAVA-MIGRATION-PRD.md)，事务设计见 [`DATABASE-ACCESS.md`](./DATABASE-ACCESS.md)，实测范围与待验收事项见 [实施状态](JAVA-IMPLEMENTATION-STATUS.md)。

## 1. 边界与统一约定

- 保留 `/api` 业务路径；页面路径（如 `/login`、`/resources/:id`、`/__lp_auth/callback`）不是 REST API。Launchpad 官方 SDK 及 `/dashboard-api/` bridge 属于外部身份系统契约，不由 Java 后端实现第二套 PKCE 状态机。
- 所有业务接口均要求有效本站会话；内部任务只接受 `Authorization: Bearer <CRON_SECRET>`。浏览器不能把 Launchpad access token 当作业务接口凭据。
- JSON 使用 UTF-8、camelCase；时间为带时区的 RFC 3339 字符串，响应统一使用 UTC；UUID 使用标准字符串。字节数为正整数 `int64`，当前上界 524288000（500 MiB），实际受配置 `UPLOAD_MAX_BYTES` 约束，默认 52428800（50 MiB）。
- JSON 请求拒绝未知属性；查询串拒绝未知参数、重复的单值参数与非法类型。用户可编辑文本先 trim 再做长度校验，除特别说明外不做任意截断；opaque accessToken、botToken、cursor、SDK code/state 等凭据不 trim、不规范化，按原值校验。长度上限按 UTF-16 code units（Java String.length / JS String.length）计算以保持旧校验行为，补充字符占两个单位。OpenAPI maxLength 同时作为不更宽松的外层约束，实施必须落实 code-unit 上限。`sort`、`fileType` 不是查询参数。
- 业务响应、鉴权响应和敏感错误带 `Cache-Control: no-store`。签名 URL、会话明文、平台 token、密码或存储密钥不得进入日志、审计、监控或缓存。内部存储 object key 不作为资源 DTO 字段返回；预签名 URL 自身可能包含对象定位信息，应整体视为临时凭据。
- 浏览器写请求必须使用与 `APP_BASE_URL` 完全相同的 `Origin`；若存在 `Sec-Fetch-Site` 则必须是 `same-origin`。这包括 POST 查询上传状态及 POST 下载签名。`Origin` 缺失/为 `null`/跨源一律 403。内部 cron 请求走独立 bearer 授权，不要求浏览器 Origin。
- POST/PATCH JSON 请求要求 `Content-Type: application/json`；解析前限制正文最多 65536 字节（64 KiB），超限 413 `request_too_large`。格式错误或校验失败为 400，媒体类型错误为 415。旧二进制上传接口使用文件 MIME 类型和 UPLOAD_MAX_BYTES 上限。返回给浏览器的字段必须用 `textContent` 或 DOM 节点安全呈现，不把搜索高亮当 HTML。

## 2. 身份与会话

### 2.1 两种互斥部署模式

目标优先使用经过端到端验证的 `cookie` 模式：登录响应设置 `__Host-shsid_session`（开发 localhost 使用 `shsid_session`），属性为 `HttpOnly; Secure; SameSite=Lax; Path=/`，不设 Domain。仅 localhost 开发允许不带 Secure 的开发 cookie。本站会话最长一小时，数据库只保存带 `SESSION_TOKEN_PEPPER` 的 HMAC-SHA256 token hash；切换语言不能更改现有哈希编码规则。

现有 Launchpad 代理存在 `Set-Cookie` 不能可靠保留的兼容约束，**尚未因本设计而解决**。只有显式开启 `header-compat` 部署配置时，登录响应才包含本站 opaque `accessToken`；浏览器沿用 IndexedDB + 同源 Service Worker 的 `x-sider-session` 传输，不能使用 Web Storage、URL 或日志存 token。Service Worker 不向 `/dashboard-api/`、跨源请求、对象存储上传/下载注入本站凭据；带自定义会话头的 fetch 必须阻止跨源重定向继承凭据（使用合适的 redirect:error/manual 策略并验证导航兼容性），不能只检查初始 URL 的 origin。受保护 API 返回 JSON，不重定向到对象存储。不得因 cookie 暂时缺失自动切换兼容模式；切换需要验证回调、重载、分页、登出、浏览器多标签页及代理传输。

OpenAPI 的默认安全方案表达目标生产 cookie；`CompatibilitySession` 仅供明确的兼容部署 profile 使用，不意味着所有环境都接受该请求头。业务端点均有相同的条件替代规则。兼容部署遇到 cookie 与 header 同时存在且不同，拒绝请求而非猜测身份。两种模式均执行服务端会话查询、过期/撤销/封禁检查与管理员允许列表核对。`Authorization: Bearer` 在目标业务 API 中不接受本站会话；它仅用于内部任务，区别于旧实现的额外兼容入口。

### 2.2 登录与登出

1. 浏览器通过同源官方 SDK 完成 Authorization Code + PKCE；SDK 负责 verifier、state、nonce 与保留 callback。
2. POST `/api/auth/launchpad/session` 提交短时效平台 `accessToken`、可选 `botToken` 与安全的站内 `returnTo`。
3. 通过风险检查后、调用 userinfo 前，使用 domain-separated HMAC-SHA256（SESSION_TOKEN_PEPPER 与固定 login-exchange 上下文）计算平台 token 指纹，在共享 Redis 原子 SET NX EX 3900 预留，完整交换处理期限不超过 60 秒。相同 token 在该保留窗口内不能签发多份有效本站会话，重复返回 409 `login_exchange_replayed`；保留窗口覆盖最长一小时会话及处理缓冲，不宣称平台 token 终身仅可使用一次。Redis 故障返回 503；DB 失败或响应丢失后不释放提交结果不确定的预留，客户端重新通过 SDK 获取新平台凭据，不自动重发。指纹键不包含原始 token，不缓存或记录 token。
4. 后端通过配置的同源 bridge 调用平台 `/oauth/userinfo` 取身份，不信任客户端用户对象，不本地 HS256 验签平台 token；`sub` 是唯一外部身份键。封禁用户不能重新登录。平台故障 503，平台拒绝 token 401。
5. 后端 upsert 用户并签发本站会话。`cookie` 响应不包含明文会话 token；`header-compat` 响应的 `accessToken` 是本站 token，不是平台 token。`returnTo` 最长 500 字符，仅接收单个 `/` 开头的本站相对路径，拒绝 `//`、反斜杠、控制字符及编码绕过。`redirectUrl` 延续现有安全允许列表，只可进入 `/resources`、`/me/resources`、`/admin/reports`、`/admin/audit` 及其子路径/查询；其他语法合法的站内路径回退 `/resources`，片段丢弃。不能返回到 bridge、回调或内部 API。
6. POST `/api/auth/logout` 撤销当前会话、清 cookie，200 JSON 返回 `/login`；重复请求仍成功，不能宣称同时登出 Launchpad 全局会话。兼容模式还须在服务端撤销完成后删除 IndexedDB token 并通知 Service Worker，若网络失败则先本地清理并显示服务端撤销未确认，不能宣称 token 已撤销。前端用不含 token 的广播事件同步其他标签页的本地登出界面；已撤销会话下一次受保护请求返回 401。

管理员角色只由 `SHSID_ADMIN_SUBS` 决定，客户端不能提交 role。管理员被移出列表后降级且撤销已有会话；用户被封禁后撤销其全部会话。GET `/api/me` 返回经过本次请求核对的用户资料，不返回平台 `sub`、token 或敏感鉴权快照。

保留旧 `/api/auth/launchpad/start`：GET 302 跳转 `/login`；POST 410 `sdk_required`。`/__lp_auth/callback` 仍是浏览器回调适配路径，只允许受限的 code/state/error/error_description 转交 SDK 所在登录页，并设置 no-store；不新增 Java code/token 换取逻辑。

## 3. 端点与权限

| 方法与路径 | 权限 | 结果/说明 |
| --- | --- | --- |
| GET `/api/health` | 公开 | 200 `{status:"ok"}`，只表示进程存活 |
| GET `/api/config` | 公开 | 只提供浏览器需要的公开运行配置，见下文 |
| POST `/api/auth/launchpad/session` | 无需本站会话，需同源 | 200；平台身份换本站会话 |
| POST `/api/auth/logout` | 当前会话可选，需同源 | 200，幂等撤销当前会话 |
| GET/POST `/api/auth/launchpad/start` | 公开 | 旧入口，302/410 |
| GET `/api/me` | 登录用户 | 200 `{user}` |
| GET `/api/resources` | 登录用户 | active 资源搜索，20 条游标分页 |
| GET `/api/resources/tags` | 登录用户 | 200 `{tags}`，建议标签 + 最多 500 个活跃资源标签 |
| GET `/api/me/resources` | 登录用户 | 只返回本人上传，20 条游标分页，包括 deleted 状态元数据 |
| GET `/api/resources/{id}` | 登录用户 | 200 `{resource}`；作者/管理员可查看非 deleted 状态，其他用户仅 active |
| PATCH `/api/resources/{id}` | 作者/管理员，需同源 | 200 `{resource:{id,status}}`，更新完整元数据，不替换正文 |
| DELETE `/api/resources/{id}` | 作者，需同源 | 200 `{status:"deleted"}`，软删除 + 审计；管理员删除他人资源使用带原因的 moderate/remove |
| POST `/api/resources/upload-intents` | 登录用户，需同源 | 201；每个文件单独创建 pending 资源与 300 秒 PUT 签名 |
| PUT `/api/resources/{id}/upload` | 登录且需同源；启用时仅作者 | 默认 `LEGACY_UPLOAD_ENABLED=false`，410 `legacy_upload_disabled`；显式启用后成功204，新前端不调用 |
| POST `/api/resources/{id}/complete` | 作者，需同源 | scanning 返回 202，其余已有状态返回 200；不可据此视为发布成功 |
| POST `/api/resources/upload-status` | 登录用户，需同源 | 200；一次查询 1–5 个本人资源的 `{id,status}` |
| POST `/api/resources/{id}/download` | 登录用户，需同源 | 200 `{url,expiresIn:120}`；所有人均仅可下载 active |
| POST `/api/resources/{id}/reports` | 登录用户，需同源 | 201 `{report:{id}}`；仅可举报他人 active 资源 |
| GET `/api/admin/reports` | 管理员 | 默认 open，100 条游标分页 |
| GET `/api/admin/dashboard?range=7d` | 管理员 | range 仅 24h/7d/30d，默认 7d；数据库全量汇总、UTC 补零趋势及排行；详情见 OpenAPI |
| POST `/api/admin/reports/{id}` | 管理员，需同源 | 200 `{status:"dismissed"}`；必填 note，原子关闭 open 举报 + 审计 |
| POST `/api/admin/resources/{id}/moderate` | 管理员，需同源 | hide/restore/remove，状态条件更新与关联举报处理同事务 |
| POST `/api/admin/users/{id}/suspend` | 管理员，需同源 | 200 `{status:"suspended"}`；禁止封禁自己；撤销目标全部会话 |
| GET `/api/admin/audit` | 管理员 | 100 条游标分页，仅返回已脱敏审计内容 |
| GET `/api/internal/ready` | cron bearer | DB/Redis/存储就绪探测，200 ready 或 503 degraded |
| POST `/api/internal/jobs/uploads` | cron bearer | 尝试处理一个持久化扫描任务，不在 API 请求中轮询整个队列 |
| POST `/api/internal/jobs/cleanup` | cron bearer | 有界清理资源/多余副本/过期记录，逐项失败留待重试 |

GET `/api/config` 是为静态前端新增的公开配置入口，避免把服务端模板或前端构建框架当作运行时依赖。仅返回 `botSiteKey`、`uploadMaxBytes`、`maxFiles`（5）、`uploadConcurrency`（2）、`uploadsEnabled` 与 `sessionTransport`。`uploadsEnabled` 说明扫描服务是否已配置，用于沿用原版上传页的可用性提示；不代表扫描服务实时健康，后端始终独立验证。接口不返回平台 token、secret、对象存储凭据、数据库连接串或管理员列表。SDK 路径固定为同源 `/dashboard-api/oauth/sdk.js`，配置接口不接受用户指定远程脚本地址。公开配置也采用 no-store；浏览器不得靠其结果改变服务端权限。

部署映射由 [部署环境](DEPLOYMENT-ENVIRONMENT.md)统一维护：`SESSION_TRANSPORT` 明确选择 cookie/header-compat，`BOT_SITE_KEY` 提供 botSiteKey，`UPLOAD_MAX_BYTES` 提供 uploadMaxBytes；maxFiles=5、uploadConcurrency=2 固定。旧 `NEXT_PUBLIC_BOT_SITE_KEY` 仅可作为过渡别名，同时配置且不同则拒绝启动；Java已显式绑定这些变量，不做Next.js构建时内联。Spring仍不会自动读取env示例；必须在启动前向进程注入。

## 4. 搜索、标签与列表分页

为复刻正在运行的原版页面，`/api/me/resources`、`/api/admin/reports`、`/api/admin/audit` 另接受精确的 `view=workspace`。本人列表返回最近100条所有状态，客户端先统计这100条再按标签栏筛选；举报返回最早100条open记录；审计返回最新200条。三个视图均无后续游标（nextCursor=null），拒绝cursor及非默认status组合。缺省模式继续使用原有带签名游标的分页API。页面采用固定窗口后，不再把本页数量显示为全库统计。

### 4.1 查询字段

`GET /api/resources` 只接受：

- `q`：缺省空字符串，trim 后最多 120 字符。
- `type`：可选 `pdf|docx|pptx|xlsx|txt|png|jpeg`；JPEG 同时覆盖 `.jpg` 和 `.jpeg`，类型按真实保存的 MIME 筛选。
- `tag`：可选单个标签，trim 后 1–30 字符。`tag` 一旦存在即覆盖兼容 collection；空 tag 不等于未传，应返回 400。
- `collection`：仅保留 `peer-advisors` 兼容值；未传 tag 时等价于 `tag=PA`。新 UI 使用统一标签筛选，不增加独立 PA 栏目。
- `cursor`：可选、最长 2000 字符的服务端不透明分页 token。

无 `sort` 参数：有 q 时按相关性降序、发布时间降序、UUID 降序；无 q 时按发布时间降序、UUID 降序。相关性保留现有 `simple` 全文、`pg_trgm`、标题/文件名/描述/标签匹配权重组合，见数据库设计。历史 PRD 中的任意排序入口没有实现依据，本次不扩展。

PA 判断必须与现有逻辑等价：`NFKC → lowercase → 去除非 ASCII a-z/0-9 字符`，规范键属于 `pa|peeradvisor|peeradvisors` 即统一为 `PA`。普通学生提交任一 PA 别名一律 403 `pa_tag_admin_only`，不能通过 PATCH 保留/重新赋予 PA。其他标签 trim 并按不区分大小写去重，保留首次展示文本，最多 10 个、每个最多 30 字符。

搜索 `highlights` 为 `{text,highlighted}` 段数组，绝不是 HTML。GET tags 将建议标签 `Notes,Revision,Worksheets,Guides,PA` 与来自 active 资源的最多 500 个不区分大小写标签合并；建议标签首先返回，其余按规范化名称排序。

### 4.2 分页 token

所有列表返回现有约定 `{items,nextCursor}`；管理员举报为兼容现有 `{reports,nextCursor}`。固定页大小：搜索/本人上传 20，管理员举报/审计 100，不新增 limit/offset 参数。空列表返回空数组与 `nextCursor:null`。

目标游标与旧实现不同：`base64url(payloadUTF8).base64url(HMAC-SHA256(key=CURSOR_SIGNING_KEY, message=payloadUTF8))`；payload 含版本、签发/过期时间（最长 1 小时）、列表类型、规范化过滤条件指纹和最后一项排序键。使用独立的至少 32 随机字节签名密钥。搜索绑定规范 q/type/有效 tag；本人列表绑定 userId + status；管理员列表绑定 admin userId + status/列表类型。内部排序时间保持 PostgreSQL 微秒精度，相关性用小数点后六位的十进制字符串保存，避免 Java double 或 JS 毫秒时间造成漏项。payload 是实现细节，前端只能原样回传。

旧 unsigned 游标、签名错误、过期、跨用户/跨列表或过滤条件不一致均返回 400 `invalid_cursor`。前端改变查询/标签/类型/状态须清空游标；收到 invalid_cursor 可提示重载第一页，不能静默重复追加。分页不是跨请求数据库快照：新发布、编辑和审核可使结果变化；游标只承诺在排序/过滤未变化的数据集上稳定翻页，不承诺跨并发修改的一致快照。

本人上传 `status=all|active|scanning|unavailable`：scanning 包含 pending/scanning；unavailable 包含 hidden/quarantined/deleted/failed；all 返回所有本人状态。筛选在 SQL 中发生后再分页，不先取 100 条后在前端筛选。按 createdAt/id 降序。管理员举报 `status=open|resolved|dismissed`，缺省 open，按 createdAt/id 升序。审计按 createdAt/id 降序。

## 5. 写操作、并发与重试

### 5.1 上传与发布

1. 每批前端选 1–5 个文件，最多 2 个并行传输；每个文件独立意图、资源和错误状态，不是资源包。标题 1–120、描述 0–2000、文件名 1–255；服务端规范化文件名并校验扩展名/MIME 配对。只允许 PDF、DOCX、PPTX、XLSX、TXT、PNG、JPG/JPEG。
2. 创建意图会分配随机 resourceId 与不可预测 ingress key。签名绑定大小、MIME、资源元数据，返回必需 headers；浏览器按 headers 执行 PUT，Content-Length 由浏览器按文件正文设置，不尝试在 JavaScript 中手工设置受限头。存储端 CORS/签名约束必须实测，不能因为 OpenAPI 写了约束就声称已实现。
3. POST complete 只接受当前作者，意图最长一小时。后端 HEAD 核对大小/MIME/资源元数据/ETag；使用 ETag 条件复制到浏览器不可写的随机快照，复核后以事务 CAS 将 pending 改为 scanning 并创建唯一 upload_scan_jobs。快照创建前后允许存储失败，失败时不发布。
4. 重复 complete 不生成第二个任务；资源为 scanning 返回 202，其余已存在状态返回 200（包括 deleted/hidden/quarantined/failed），客户端必须读取 status。并发 complete 只有一次 CAS 成功，失败者清理自己创建且确认未被引用的快照；提交结果不确定时不得删除可能已入队的快照。
5. 后台采用租约 token、最多三次尝试、30/60 秒退避。只有扫描 clean、文件真实类型匹配、SHA-256 合法且任务租约仍归本 worker、资源仍 scanning、作者仍 active 才能发布扫描的同一份内容。恶意或类型错误直接隔离；临时失败重试，耗尽后隔离。隐藏/删除/封禁不能被迟到 worker 覆盖。
6. 前端按每文件状态查询，已 active 才显示可下载。取消尚未发布的资源使用 DELETE，不能假装撤销已经发送的 PUT URL；可能留下的 ingress 对象由安全清理/Lifecycle 回收。

创建意图**不是幂等操作**，没有 Idempotency-Key 或去重表。网络超时后不自动重发 POST 创建意图；若已拿到 resourceId，则使用原 id 状态查询或重试 complete。未拿到响应时提示刷新本人上传核对或由用户明确重新创建；可能遗留的 pending 由过期清理回收。对同一个未过期 PUT URL 可重传同一份完整文件，但扫描使用不可写快照；一旦 complete 接受，应停止向该 ingress key 重传。PUT 超时可重试原 PUT，直到到期或用户取消；不得悄悄重新创建意图。

签名 GET 下载只有签发时校验 active；120 秒内已经签出的对象存储 URL 无法仅靠撤销本站会话立即失效。隐藏资源可阻止该资源新签名；封禁请求者阻止该请求者获得新签名，不能承诺撤销已签 URL。封禁上传者禁止其在途任务发布，但不自动隐藏其此前已 active 的资源；如需阻止其他学生下载这些资源，应另外执行治理隐藏/移除。

### 5.2 元数据、删除、举报与治理

- PATCH 是完整元数据替换（title、description、tags 均必填），只能修改非 deleted 资源。正文、作者、size、MIME、状态不能由客户端 PATCH。并发修改采用**最后成功提交覆盖**，不新增 version 列、ETag 或 If-Match；客户端提交成功后刷新服务端结果。
- DELETE 为作者软删除并写审计；管理员移除他人资源使用 moderate/remove 并提供原因。首次 200；已 deleted、不存在或无权限统一 404 `resource_unavailable`。状态效果可重复，但 HTTP 成功响应不是永远 200；超时后客户端通过本人列表核对 deleted 状态，不盲目把 404 当作删除失败。
- 同一举报者对同一资源最多一个 open 举报。重复创建返回 409 `report_already_open`；不能举报本人资源或非 active 资源，统一 404。举报不能直接改变资源状态。
- 驳回只作用于 open 举报，note 1–1000 字符，成功更新与审计同事务；已关闭/无效 ID 返回 404。`hide` 仅 active→hidden，`restore` 仅 hidden→active，`remove` 仅非 deleted→deleted。hide/restore 带 reportId 时仅处理该资源的匹配 open 举报；不匹配或非 open 的 reportId 不修改该举报，也不阻断资源治理，并在响应返回 `resolvedReportIds:[]`。remove 原子 resolve 该资源全部 open 举报，返回实际 resolvedReportIds；该显式响应扩充避免客户端误认为传入的 reportId 必定被处理。
- restore 不能把 quarantined、pending、scanning、failed 或 deleted 变成 active。remove 和 DELETE 均禁止迟到 worker 重新发布。每次治理要求原因、写脱敏审计。
- suspend 只作用于 active 用户，禁止管理员封禁自己（409 `cannot_suspend_self`）；变更状态、撤销全部会话、审计同事务。不存在/已封禁返回 404。超时后界面标记结果未确认，可在管理员审计中查找对应 user.suspend；本阶段不新增用户详情接口，审计证据不足时由管理员/运维核查，不能假装前端已查询目标用户状态。
- POST 举报/驳回/治理/封禁不承诺自动重放安全；客户端保留操作状态，503/网络超时后通过可用列表/详情/审计核对，无法确认则保持未知状态并由用户决定后续操作。任何 429 按 Retry-After 等待；需要 bot 挑战时必须获取与本次 action 绑定的新 token，不能重用已消费 token。

## 6. 错误、限流与机器人验证

通用错误形状：`{error:string, requestId?:string, retryAfter?:integer, issues?:[{path:string[],message:string}]}`。requestId 是服务端生成的非敏感关联标识，不能包含 token/URL；错误不返回 SQL、堆栈、原始外部响应或未知资源的存在信息。

| 状态 | 主要错误码与客户端处理 |
| --- | --- |
| 400 | invalid_request / invalid_query / invalid_cursor / invalid_upload / invalid_resource / invalid_report / invalid_action；修正输入，不自动重试 |
| 401 | unauthorized（本站会话缺失/过期/撤销/封禁）或 invalid_token（平台 token 无效）；重新登录 |
| 403 | forbidden（Origin/管理员权限）、suspended（登录准入）、pa_tag_admin_only、bot_challenge_required、bot_challenge_invalid |
| 404 | resource_unavailable / report_unavailable / user_unavailable；包含无权限或状态不允许的情况，避免存在性泄漏 |
| 409 | object_missing / object_mismatch / upload_expired / report_already_open / cannot_suspend_self / login_exchange_replayed |
| 410 | legacy_upload_disabled（默认关闭的旧正文上传入口）或 sdk_required（已弃用的服务端登录入口） |
| 413 | file_too_large（超过实际 UPLOAD_MAX_BYTES）或 request_too_large（JSON 正文超过 64 KiB） |
| 415 | unsupported_media_type 或 file_type_not_allowed |
| 429 | rate_limited；响应头 Retry-After（秒）与 retryAfter 同值 |
| 503 | platform_unavailable / search_unavailable / upload_unavailable / completion_unavailable / status_unavailable / download_unavailable / report_unavailable / service_unavailable / uploads_disabled / bot_challenge_unavailable / upload_worker_unavailable；依赖故障关闭受保护操作 |

管理员无权限是 403；资源级无权限统一 404。需要先执行的粗粒度 IP 限流可能在会话查询前返回 429/503，因此错误优先级不能被客户端用于推断会话是否有效。

保留当前 Redis 原子计数策略，按操作与经 HMAC 处理的 IP/user 分桶；风险阈值为计数达到 max(2,ceil(上限×0.8))，超限返回 429。默认窗口/IP/用户上限：search 60秒/120/60，upload 3600秒/30/10，complete 3600秒/60/20，upload_transfer 3600秒/40/12，upload_status 60秒/240/30，download 3600秒/300/120，resource_write 3600秒/180/60，report 86400秒/30/10，admin 3600秒/300/120，page 60秒/600/无用户限额，oauth_start 600秒/300/无用户限额。允许既有配置乘数与 OAuth IP 配置，不能退化为单实例内存限流。

路由到操作桶的映射固定如下：搜索、标签、本人列表和资源详情共用 search；创建意图用 upload；complete 用 complete；旧正文中转用 upload_transfer；批量状态用 upload_status；签发下载用 download；PATCH/DELETE 用 resource_write；创建举报用 report；所有 admin 读写用 admin；GET /api/me 与 logout 用 page 的 IP 配额且不交互挑战；本站会话交换用 oauth_start。公开 health/config 与已弃用的 start 入口由边缘请求总量保护，不查询业务数据库。内部任务使用独立凭据及有界执行，不能当作浏览器接口发起。共用操作桶意味着访问列表与详情合计消耗配额，压测时须核对不会误伤正常浏览与后台状态更新。

达到风险阈值时按操作要求 bot token：GET 搜索使用 `x-bot-token`；新列表/详情/标签/管理员读取同样可用该头；写操作沿用 JSON `botToken`（目标 metadata/admin 请求新增可选字段）；DELETE 使用 `x-bot-token`，不要求 DELETE 正文。旧二进制上传不启用交互挑战，仅限流。挑战 action 与操作一致：search/upload/complete/download/report/resource_write/admin；本人列表/详情/标签归 search。登录为 oauth_start。GET `/api/me` 与 logout 不发起交互挑战，仅共享限流。上传状态查询仅限流以免后台轮询不断触发验证。

验证服务必须核对 success、hostname、action、challenge_ts（绝对时差不超过五分钟），并用 Redis `SET NX EX 600` 防重放；token 与 secret 不记录。缺 token→required，验证不符/重放→invalid，外部服务或重放存储不可用→unavailable。前端挑战重试是用户操作的一部分，不是无限重发循环。

## 7. 内部任务与就绪

- `/api/internal/ready` 与 jobs 使用固定时间比较 CRON_SECRET，返回不含 secret 的结果；不能让浏览器读取 cron secret。ready 的 database/rateLimit/storage 布尔值只反映检查结果，**不代表** scanner、OAuth、bot verifier、恢复演练、浏览器 CORS 或上线验收全部完成。
- uploads 一次领取/尝试一个任务，返回 `{processed:false}` 或 `{processed:true,committed:boolean}`；processed=true 仅表示尝试过，不代表资源已发布。worker 与 cron 同时调用也遵循同一数据库租约；未能获得领取锁返回 processed=false。
- cleanup 有界处理（每轮候选/已结束任务各最多 200）；保护 queued/processing 任务输入，在短事务锁定复核并 retire 符合条件的状态，事务外删除对象，再以状态条件确认清理结果。个别失败保持可重试，不在长事务中等待对象存储 I/O。返回 inspected/cleaned/artifactsCleaned/expiredTransactions/expiredSessions。不可把 pending/ 整个前缀直接清空。

## 8. 与当前实现的显式差异及验收

1. 新增静态前端需要的公开配置、标签列表、本人列表、审计列表 JSON；本人列表/管理员列表从服务端页面查询改为有界游标分页。
2. 默认目标 cookie 与显式 header-compat 分开；当前登录只返回兼容 token 的事实保留，是否可改 cookie 取决于代理实测。业务 Bearer 会话入口在目标收敛为 cookie/显式 header profile。
3. 登出从当前 303 改为 200 JSON；旧 auth/start 的 302/410 保留。
4. 游标升级签名、过滤/权限范围绑定、过期与时间精度；旧游标不兼容。所有查询拒绝未知/重复参数，避免误用未实现的 sort。
5. DELETE 保持作者权限；管理员删除他人资源统一走 moderate/remove，要求原因并处理关联举报，保持产品要求的有效删除能力且不能绕过治理审计。
6. 管理员治理响应新增实际 resolvedReportIds；metadata/admin 请求新增可选 botToken，已有 UI 的静默错误必须显式显示。

实施验证覆盖范围与最新数量见 [实施状态](JAVA-IMPLEMENTATION-STATUS.md)：完整Java verify60项通过，随后上传定向12项通过，合计61个Java用例；Node15项、Java+Edge29项通过，其中PostgreSQL使用真实隔离库，浏览器外部平台/Redis/挑战有代理替身。真实SDK、平台Cookie链路、S3 CORS/签名与scanner端到端、平台配额/TLS、生产负载和恢复演练仍需独立验收；这些不因本地通过而自动完成。
