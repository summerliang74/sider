# 上传性能改造与 PRD 验收记录

日期：2026-11-10（Asia/Shanghai）。对应 MVP PRD v0.6、完整 PRD v0.7。

本次完成代码修改、测试和需求核对。0006 迁移已应用到生产，新版本及后台 worker 已部署到 `https://siderlearn.com`，生产浏览器直传、自动扫描、搜索和下载链路通过。其余 PRD / M0 门槛仍按独立证据验收。

## 变更与需求对应

| 需求 | 实现 | 验证与结论 |
|---|---|---|
| MVP-UPLOAD-01；UPLOAD-01–02 | 共享元数据、每批 1–5 个独立资源、最多 2 个并行传输、逐文件进度/取消/重试 | 队列单元测试和移动端浏览器流程通过；单文件错误不阻断其他文件 |
| MVP-UPLOAD-02–05；UPLOAD-03–06、09 | 300 秒预签名 PUT，绑定私有 pending key、长度、类型、资源标识；文件正文直达 OSS | 真实 OSS 正向上传、错误长度/类型拒绝、50 MiB 边界与生产浏览器 CORS 通过 |
| MVP-UPLOAD-06；UPLOAD-07–08、10 | HEAD 校验、ETag 条件复制成浏览器无写权限的快照；资源状态与唯一任务在同一事务提交；202/scanning | 同时 complete 只产生一个任务；源对象覆盖不改变扫描/发布内容；路由返回码通过 |
| MVP-UPLOAD-07；UPLOAD-10–11 | 持久化任务，5 分钟租约，唯一令牌防止过期 worker 写回；一次只领取一个任务；最多 3 次，30/60 秒退避 | 数据库并发领取、过期租约回收、旧结果拒绝、扫描错误耗尽、恶意文件、删除/封禁均通过 |
| MVP-UPLOAD-08；UPLOAD-13 | 清理前锁定并复核资源；保护 queued/processing 任务，延后清理不再使用的副本 | 真实数据库 + 模拟存储检查通过；对象存储 Lifecycle 配置仍待生产证据 |
| MVP-UPLOAD-09；UPLOAD-12 | clean 响应必须包含 SHA-256，发布时持久化 | 哈希保存已实现；重复文件提示尚未实现，保留为 P1 缺口 |
| MVP-UPLOAD-10；UPLOAD-14 | 保留旧流式接口兼容；新增 worker 服务及发布步骤 | 隔离环境和生产域名真实浏览器链路通过；生产进程强制终止后的租约恢复仍待演练 |
| 性能和可观测性 | complete 服务耗时、从意图创建到完成的耗时、任务等待/扫描耗时、搜索 API 耗时 | 已增加脱敏指标；没有生产前后对比或负载数据，不能断言 P95 或发布时限已达标 |

## 已执行的检查

| 检查 | 结果 | 范围 |
|---|---|---|
| `npm test` | 118 通过；16 个外部集成用例默认跳过 | 31 个测试文件；包含队列、响应运行时校验、complete 和内部 worker 路由 |
| 独立 PostgreSQL 上传流程集成测试 | 12/12 通过 | 真实数据库事务、并发和租约；存储与 scanner 为模拟实现 |
| `npm run scanner:test` | 3/3 通过 | scanner 输入约束、文件签名识别、ClamAV 响应解析 |
| 真实私有 OSS 适配器测试 | 4/4 通过 | 用户配置 CORS 后复测：PUT/HEAD/COPY/GET、不可变快照、长度/类型约束、50 MiB、允许来源及未授权来源预检均通过 |
| Edge 真实 OSS 直传 + 受管理 worker | 5/5 文件发布，最大双并发 | 浏览器以生产 origin 加载本地生产构建，应用请求代理到隔离数据库；OSS 请求不拦截，实际执行 CORS 和 PUT；真实扫描、SHA-256 和状态轮询通过。5 个 64 KiB 文本文件用时 16,829 ms；不代表生产 P95 |
| 真实外部服务链路，Node HTTP 客户端 | 8 项通过 | 本地生产构建连接独立数据库、真实 OSS、真实 UCloud 扫描器和共享限流服务；验证 PUT、202、扫描前禁止下载、扫描发布、SHA-256、作者状态查询、搜索和签名下载内容一致性。未模拟上传/扫描接口，但不经过浏览器 CORS |
| Edge 无头浏览器，生产构建，390 × 844 | 10 项通过 | SSR 使用临时数据库与合成账号；intent/PUT/complete/status 由浏览器拦截模拟。覆盖双并发、单文件失败/重试、扫描到发布、无跨域会话泄露、无横向溢出、新批次重置 |
| `npm run lint`、`npm run typecheck` | 通过 | ESLint 零告警、严格 TypeScript |
| `npm run db:check` | 通过 | 迁移元数据一致性；使用不连接数据库的占位 URL |
| `npm run build:strict` | 通过 | 最新实现的优化构建和类型检查 |
| 生产域名 Edge 浏览器 + 自动 worker | 7 项通过，11,856 ms | 真实生产入口、OSS CORS/PUT、202、自动扫描发布、SHA-256、搜索、签名下载一致性及无跨域会话泄漏；一个合成小文本文件，扫描 1 次 |
| 生产公开冒烟检查 | 15/15 通过 | 健康、登录入口、安全响应头、受保护页面、匿名 API 拒绝和跨域修改拒绝 |

数据库测试使用独立的 schema-only 临时分支 `codex/upload-queue-test-20261110`，没有复制生产用户数据。测试只创建合成记录并在结束时清理；分支设为 2026-11-11 15:22（Asia/Shanghai）自动到期。连接串仅通过进程环境注入，没有改写本地 `.env.local` 或生产分支配置。

OSS 测试只使用随机 `pending/<uuid>/test-*` 合成对象并在结束后删除。浏览器截图保存在本地忽略目录 `.tmp/upload-browser/mobile.png`，浏览器测试脚本为 `.tmp/upload-browser/verify.mjs`。这些模拟请求证明前端交互，不证明 OSS 跨域或生产登录链路。

真实服务链路脚本为 `.tmp/upload-browser/verify-live.mjs`，同样只使用临时数据库中的合成账号和随机私有对象，结束后清理数据库记录与存储副本。单个合成小文本文件的 complete 用时 1,404 ms，worker 端点扫描并发布用时 2,691 ms。这里只是一个 HTTP 客户端样本，不代表学校网络、大文件、并发负载或 P95；测试会话由夹具创建，不覆盖 Launchpad 登录。新批次重置也已核对标签随表单一起清空。

## 发布结果与剩余验收

1. **OSS CORS 阻断已解除。** 用户添加规则后，17:08（Asia/Shanghai）预检通过，17:11 完整适配器 4/4 通过；准确来源、PUT、必需请求头及未授权来源拒绝均已验证。
2. 真实浏览器直传已在隔离数据库及生产域名通过。生产测试脚本为 `.tmp/upload-browser/verify-production-upload.mjs`，截图为 `.tmp/upload-browser/production-mobile.png`；测试会话由合成夹具提供，不覆盖 Launchpad 真实登录。生产测试账号、资源、任务和随机存储副本已清理。
3. `0006_upload_scan_queue.sql` 已于 2026-11-10 应用到生产并核对 7 条迁移及 12 个队列表字段。Launchpad 构建 `01M72TNAP3EX4FK590FMQ2ZE4A` 成功，部署 `01M72TVMA5FG2AHXP0QXNNTDPE` 为 live。源码发布入口 `scripts/start-next.mjs` 同时管理应用和 worker；平台原生 `npm ci`、健康检查和回滚机制保留。
4. 验证真实 worker 被终止后的租约恢复、扫描服务不可用时的退避与隔离、清理任务和 pending 生命周期。数据库连接池关闭/重开测试不等同于生产进程强制终止演练。
5. 采集预期用户负载下的页面/搜索 P95、上传到发布时延及队列积压；PRD 的页面 ≤1 秒、搜索 ≤800 ms、发布 ≤3 分钟仍是待测目标。

源码发布使用 npm 11 原生 `npm-shrinkwrap.json` 保留已提交依赖版本，因为当前 CLI 不收集 `package-lock.json`。使用 `node scripts/package-launchpad.mjs <tag>` 生成不含密钥及本地容器入口的发布快照。代理返回 504 时后台构建可能继续运行，应先查询构建/部署状态再决定是否重试，避免重复部署。

## 复测命令（PowerShell）

```powershell
$env:TEST_LIVE_STORAGE = '1'
$env:APP_BASE_URL = 'https://siderlearn.com'
node --env-file=.env.local node_modules/vitest/vitest.mjs run src/lib/storage-live.integration.test.ts
```

仅复测 CORS 时追加 `-t 'browser preflight'`。该用例同时检查允许来源、PUT 方法、必需请求头和未授权来源；允许来源失败时不会继续负向检查。

数据库集成测试必须显式注入独立分支的 `TEST_DATABASE_URL` 和经核对的 `TEST_DATABASE_HOST`，再执行：

```powershell
npx vitest run src/lib/upload-flow.integration.test.ts --testTimeout=30000 --hookTimeout=60000
```

测试不会回退使用应用的 `DATABASE_URL`，且会拒绝已有用户数据的数据库。临时分支到期后需重新创建仅含表结构的分支。
