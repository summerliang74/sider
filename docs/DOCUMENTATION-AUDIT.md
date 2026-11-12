# Java 迁移文档交叉核对

核对日期：2026-11-11（Asia/Shanghai）。工作分支：`codex/java-api-design`。用户已明确应用环境为Launchpad；设计后已实施Java工程、原生前端、本地测试及仓库部署计划。平台只读查询限于手册/应用状态及变量名称/作用域，没有SSH、查询生产数据库、读取真实密钥值或发布。online/HTTP307状态快照仍属于原发布，不证明Java已运行或完整业务正常。最新证据见 [实施状态](JAVA-IMPLEMENTATION-STATUS.md)。

## 1. 文档效力与证据边界

新版本的需求与技术责任以 [Java 迁移 PRD](JAVA-MIGRATION-PRD.md) 为准；[API 设计](API-DESIGN.md)和 [OpenAPI](openapi.yaml)定义目标 HTTP 合同；[数据库访问设计](DATABASE-ACCESS.md)定义复用表结构、查询、事务和迁移约束；[部署环境设计](DEPLOYMENT-ENVIRONMENT.md)定义目标环境、运行配置与待验证事项。实施时发现冲突，须先同步这些文档，不能把旧代码的行为直接当成新合同。

既有PRD、Next.js源码、旧平台计划、根Node容器/Compose、运维手册及2026-11-10验收记录继续保留，作为旧版依据与回切资料。Java本地实现由backend源码、独立构建/测试证据支持；旧版本记录不能代替Java测试，更不能证明Java已部署或当前生产已再次通过验收。

本次检查把结论分为四类：

- **源码可核对事实**：本地文件存在、字段/默认值/调用关系可见；不等于线上正在运行相同版本。
- **目标设计差异**：Java 版本有意采用的新合同，不能误标为旧实现 bug 已修复。
- **旧文档偏差**：说明与本地实际代码不一致，需要更正、加注或明确停用。
- **上线待验证**：需要真实托管环境、代理、数据库、存储或浏览器证据；本次未执行。

## 2. 文档与配置矩阵

| 文件/组 | 本地核对结果 | 在 Java 迁移中的处理 |
| --- | --- | --- |
| [README](../README.md) | 已补Java工程、实施状态、Maven/原生前端检查和启动配置说明；下半部分保留原版 | Java命令与旧Node命令分开，复制env文件不等于注入配置 |
| [原 MVP PRD](../SHSID-Online-MVP-PRD.md)、[原完整 PRD](../SHSID-Online-PRD.md) | 已有迁移说明；仍保存 Next.js/React/TypeScript、原托管、旧 API 表与历史验收 | 作为旧基线保存；目标技术栈、会话 profile、API 分页等由新设计覆盖，不整体改写历史记录 |
| [前端视觉规则](../front-end_design.md) | Notion 风格的颜色、排版、细边框和无位移交互规则不依赖框架；含若干 Tailwind 风格类名示意 | 保留视觉要求，原生 CSS 表达；类名示例不构成必须引入 Tailwind/Vue/React 的要求 |
| [API-DESIGN](API-DESIGN.md)、[OpenAPI](openapi.yaml) | Java实现config/tags/mine/audit等API，logout、cursor、JSON限额和登录防重按新合同 | 已有本地运行证据，完整外部/生产验收待补；旧流式上传默认410，开关显式启用 |
| [DATABASE-ACCESS](DATABASE-ACCESS.md) | 复用现有七表及enum/生成列/部分索引；JDBC仓储与短事务已实现 | 隔离真实PostgreSQL完成资源/上传用例；没有新增生产DDL，生产数据/权限/TLS/恢复仍待验证 |
| [DEPLOYMENT-ENVIRONMENT](DEPLOYMENT-ENVIRONMENT.md) | 用户确认Launchpad托管JavaDocker容器；平台手册支持dockerfile，Java镜像、bridge/cookie及tier预算尚需验收 | UCloud只负责扫描，不作为应用主机；平台online快照不等于Java已发布 |
| [LAUNCHPAD-SETUP](LAUNCHPAD-SETUP.md) | 旧版适用范围已标注，allows、未接通的 discovery 操作与 health/readiness 用词已更正 | 历史平台说明保留；SDK/bridge 能力在迁移环境重新验证 |
| [OPERATIONS](OPERATIONS.md) | Launchpad应用+UCloud scanner的物理分工继续适用；Node worker/迁移命令属于旧实现 | 保留既有拓扑，Java容器、平台配额/变量、独立迁移及安全清理由新合同覆盖 |
| [MVP-TRACEABILITY](MVP-TRACEABILITY.md) | 实现及历史证据属于原版本；原表曾要求 beta 前强制删除 oauth_login_transactions | 标为历史矩阵；新目标暂保留该表仅历史清理，删除不是本阶段强制条件，不新增 DDL |
| [UPLOAD-PERFORMANCE-ACCEPTANCE](UPLOAD-PERFORMANCE-ACCEPTANCE.md) | 2026-11-10 测试/发布报告，明确合成夹具未覆盖真实 Launchpad 登录及负载/P95 | 原样保留日期与边界；作为迁移回归场景来源，不重新宣称当前线上或 Java 已通过 |
| [SCANNER-CONTRACT](SCANNER-CONTRACT.md) | 外部scanner请求/响应、SHA-256与快照语义沿用；Node驱动命令为旧版说明 | Java已实现同JVM调度与租约，实际UCloud扫描及平台生命周期仍待联调 |
| [FILE-PREVIEW-IMPACT](FILE-PREVIEW-IMPACT.md) | 在线预览已移出 MVP；性能分析针对历史 Next.js 中转 | 保留“不做预览”和避免文件正文中转的产品边界；不把历史带宽估算当新环境实测 |
| [NAVIGATION-PREFETCH](NAVIGATION-PREFETCH.md) | 预取规则/2026-11-10 测试依赖 Next.js RSC 与路由缓存 | 标为旧框架实现记录；原生前端需另测元数据预取，不预签下载/预读正文，不复用 RSC 指标 |
| [package.json](../package.json)、[旧CI](../.github/workflows/ci.yml)、[Java CI](../.github/workflows/java.yml) | 根Node入口继续保留；已新增backend/pom、Java21/Maven/隔离PG与原生前端CI | Java实施与旧版回切共存；本地verify成功不代表远端CI已执行。旧CI中的SHSID_ALLOWED_ORGS不证明准入策略启用 |
| [Dockerfile](../Dockerfile)、[compose.yaml](../compose.yaml) | Node24 镜像、3000 端口、Node worker；Docker CMD 目前会执行 migrate 后启动 | 不作为 Java 发布文件复用。目标迁移必须独立 release/运维步骤，不能把启动即 DDL 带入 Java |
| `.launchpad/deploy.json`、[Java Dockerfile](../backend/Dockerfile) | 当前根计划改为backend/dockerfile/8080、运行时引用、health及回滚观察；没有releaseCommand或启动DDL | Java计划尚未应用到平台；旧计划备份在 [infra/legacy](../infra/legacy/launchpad-next.deploy.json)，与根Node容器文件共同供回切评审 |
| [Java源码包工具](../scripts/package-java-launchpad.mjs) | 明确收集Java主源码/静态资源与构建计划，排除env、target、旧Node入口 | 只生成本地快照，不发布；平台resolved plan与镜像仍须验证 |
| `.launchpad.json` | 工作区有本地项目关联文件，被 .gitignore 忽略；与上行部署配置是不同文件 | 不把本地关联元数据当发布策略或密钥清单，不在文档暴露内容 |
| [.env.example](../.env.example)、[.env.production.example](../.env.production.example) | 已标注旧 Node 适用范围，生产示例的20/20已对齐为300/600起点；未改真实生产变量 | Java 使用独立模板；运行身份和迁移身份分开，不自动加载或覆盖现有真实环境 |
| [drizzle.config.ts](../drizzle.config.ts)、[scripts/migrate.mjs](../scripts/migrate.mjs) | 二者均优先 DATABASE_URL_UNPOOLED、缺失时回退 DATABASE_URL；脚本 max1、prepare:false | 旧迁移可保留为独立工具；生产必须明确 direct URL。JDBC 应用不启动时迁移、不改历史 journal |
| [infra/nginx/siderlearn.conf](../infra/nginx/siderlearn.conf) | 旧自托管模板应用3000、scanner8081，缺少dashboard-api；不是Launchpad生成的应用入口 | Java通过Launchpad平台入口/bridge，不在UCloud实施该模板的应用段；扫描TLS转发仍须核实实际URL |
| [scanner Compose](../services/malware-scanner/compose.yaml) | scanner仅UCloud主机127.0.0.1:8081映射、ClamAV3310私有 | Launchpad经受控HTTPS调用，不能访问自身localhost或假设私网可达；UCloud预算只算scanner/ClamAV/OpenClaw |
| [AGENTS.md](../AGENTS.md) | “我的服务器”的默认指向是UCloud，且允许用户另行指定；本次用户已明确Launchpad | 本次应用选择Launchpad，UCloud只保留扫描；不从AGENTS推导出必须自托管Java，也不覆盖OpenClaw |
| `test-results/` 中性能/部署报告 | 工作区存在旧测量及未跟踪产物；本次没有重新执行或认证其时效 | 保留用户原文件，不能作为 Java 验收结果提交或改写结论 |

## 3. 已纠正或明确分界的文档偏差

以下偏差最初通过文档和目标合同纠正，随后Java实施已在backend落地。旧Node运行代码及现有线上发布未被替换；不能把Java本地修正或测试称为旧生产问题已经修复。

| 编号 | 发现与依据 | 纠正口径/处理边界 |
| --- | --- | --- |
| DOC-01 | LAUNCHPAD-SETUP 曾称 records org/verified/allows；src/db/schema.ts 无 allows，auth/users.ts 仅持久化 org/verified | 改为 allows 仅解析校验，不持久化、不作为当前登录阻断条件；平台受众变化前重新审批准入 |
| DOC-02 | discovery.ts 的 isOrgDiscoveryEligible 只有测试调用；实际 session route 直接 userinfo/upsert/session，不创建 discovery cookie；/auth/discovery 页面只消费该 cookie | 原“设置发现邮箱后登录自动展示sub”的步骤不可当作当前可用操作。标为退役/未接通，管理员sub由可信平台管理员提供或独立受控验证，不能授任意测试账户管理员 |
| DOC-03 | 官方浏览器 SDK 在 src/components/launchpad-login.tsx 为 `/dashboard-api/oauth/sdk.js` | 新目标固定同源正确路径；不采用猜测的 `/sdk.js`、`/auth/sdk.js` 或任意远程URL。保留callback由SDK承接 |
| DOC-04 | README 曾称 active-only detail，实际 getResourceForViewer 允许作者/admin查看非deleted资源 | 正确区分元数据可见性与active-only下载；deleted本人列表保留历史，但无详情/编辑/下载 |
| DOC-05 | README 曾仅称 server-streamed uploads；主路径实际为签名PUT、complete快照、持久化扫描 | 更正主路径直传；旧PUT中转只短期兼容。用户选择的每个文件是独立资源，不是文件包 |
| DOC-06 | 两原PRD API表曾列sort；GET resources route只读q/type/tag/collection/cursor，旧实现不应用sort | 两旧表已去除sort并说明固定排序；新合同无sort且拒绝未知参数，避免实现无效控件 |
| DOC-07 | LAUNCHPAD-SETUP 曾把healthPath=/api/health称readiness | /api/health仅进程存活；真正依赖就绪为cron授权的/api/internal/ready，且不包括OAuth/scanner/挑战全链路 |
| DOC-08 | .env.production.example 曾覆盖OAUTH_START_IP_LIMIT=20、CALLBACK=20；.env.example及env.ts默认300/600 | 旧生产示例已改为300/600起点，仍须学校共享出口压测；原20/20不能当代码默认或直接迁移生产 |
| DOC-09 | npm run db:migrate映射drizzle-kit migrate；安装的CLI含dotenv.config()，默认读.env，而不是Next.js的.env.local；drizzle.config.ts和migrate.mjs自身只读process.env | README“复制.env.local后运行”不足以保证迁移环境加载；文档应要求迁移进程显式注入direct URL/选定环境文件，不能为解决文档问题自动运行生产迁移；不能误称Drizzle完全不支持dotenv |
| DOC-10 | Next runtime可自动加载.env.local，不能由此推断Java自动读取同文件；示例Next public sitekey在build时内联 | 新前端用受限/api/config读公开值；Java配置通过环境/外部secret注入，secret不发浏览器；旧NEXT_PUBLIC名称可按部署映射兼容，但不是Spring默认特性 |
| DOC-11 | MVP-TRACEABILITY 曾要求beta前drop oauth_login_transactions；目标无DDL、现有cleanup还删该表过期记录 | 本阶段保留cleanup-only表，后续退役须单独迁移与兼容审查；不能让旧清单驱动无授权DROP |
| DOC-12 | 旧Docker启动迁移、旧cleanup事务内S3、unsigned游标、登录交换无共享预留 | Java已实现无启动DDL、三段清理、签名范围绑定游标与3900秒指纹预留；已做隔离测试，不宣称旧生产已修复 |
| DOC-13 | 旧root Nginx模板无bridge，不能视为Launchpad实际生成的vhost；本次曾误将应用写成UCloud自托管 | 已按用户更正为LaunchpadJavaDocker容器及平台入口/bridge；UCloud仅scanner，删除Java systemd/宿主目录要求，Cookie仍需实测 |
| DOC-14 | 原MVP矩阵称cookie-first transport，但当前login JSON仅发本站token，不设cookie | 历史事实写兼容token；目标cookie profile须验证后启用，header-compat必须显式配置，严禁自动回退与跨源重定向泄漏 |
| DOC-15 | Lifecycle示例无条件删除整个pending/，其中包含活跃扫描快照；云存储不读取任务表 | OPERATIONS和部署环境已明确禁止原样用于Java；实施须验证可清理标签/前缀或安全保留策略。示例JSON未部署或修改 |
| DOC-16 | 扫描器还累积chunks并Buffer.concat；应用和scanner有独立容量/文件限制 | 扫描侧测ClamAV/文件缓冲/OpenClaw峰值；Java按Launchpad实际tier配额单独测量，UCloud4GB不作为应用配额 |
| DOC-17 | OPERATIONS曾列独立HeadObject权限、遗漏readiness用ListBucket | 正文已改为对象读取授权HEAD、条件复制需源读/目标写、受限ListBucket；具体IAM按供应商核验 |
| DOC-18 | 旧Node示例没有Java会话profile、Spring地址/端口或签名游标键；站点key原为构建内联 | Java21/Boot4.1.2/Maven3.9与显式变量绑定已实施，模板与平台引用已补；只读检查发现9个新引用名待登记，实际运行环境/Secrets未改 |
| DOC-19 | 旧流式上传非新前端路径，长期打开会额外占用应用连接与正文资源 | Java的LEGACY_UPLOAD_ENABLED默认false，旧PUT返回410；显式开启才提供作者中转且仍受快照扫描约束 |

## 4. 新设计之间必须保持一致的合同

- **身份边界**：Launchpad官方SDK管理PKCE；Java调用userinfo，sub唯一；org/verified为快照，allows不入库；无本地密码注册、伪造登录或第二套OAuth状态机。
- **会话**：最长3600秒，沿用HMAC hash；登录交换预留Redis指纹3900秒且总处理期限60秒，重复409；不能声称token终身单次使用。cookie默认目标与header-compat显式替代，代理能力未解决。
- **权限**：公开搜索仅active，详情作者/admin非deleted；所有角色下载仅active；PATCH作者/admin；DELETE仅作者；admin删除他人用带原因moderate/remove。封禁上传者不自动隐藏既有active资源，但其在途任务不得发布。
- **标签**：PA的NFKC/ASCII别名规则与现有代码一致；普通学生即使提交未改变的PA也403，可移除PA再保存或请求admin编辑。
- **列表**：q/type/tag，显式tag覆盖peer-advisors兼容alias；无sort。搜索/本人20，admin举报/审计100；mine状态分组含deleted；cursor签名、过滤/身份绑定、微秒时间与十进制score，过期/旧格式400。
- **上传**：默认50MiB、配置上限500MiB、int64；每批1–5、最多2并行；创建意图非幂等，响应丢失不得自动POST重放；complete只作者、同一资源唯一job，scanning202，其余既有状态200，status决定UI含义。
- **后台安全**：存储/扫描I/O在事务外，短事务CAS、租约token与实际时钟栅栏；删除/封禁不能被迟到clean覆盖。cleanup保护所有queued/processing输入，不直接删除pending整个前缀。
- **客户端保护**：JSON64KiB上限、文本UTF-16长度规则且不改写opaque凭据、no-store、错误不泄密；JS用安全DOM输出；带会话自定义头的请求不能跟随跨源重定向。
- **运维**：应用role无DDL、审计append-only；direct迁移独立执行；Java21/Boot4.1.2、JavaDockerfile/CI/根平台计划已提供，旧Node文件仅回切，不冒充Java发布产物。

## 5. 剩余验证与实施门槛

初始设计阶段的静态核对与后续运行测试分开记录。完整Java verify60项与后续上传定向12项通过，合计61个不同Java用例，另有Node15项和Java+Edge29项通过；数据库使用真实隔离PostgreSQL，存储/扫描集成用例有替身，浏览器外部平台/Redis/挑战有代理fixture。仍须补齐下列真实环境证据：

1. **Launchpad运行**：Java Docker镜像/实际resolved plan/监听0.0.0.0及端口、tier配额/出站网络、bridge/origin/SDK/TLS/Cookie；不满足时不得以假登录或自动改投UCloud代替。
2. **隔离与存量兼容**：本地Java构建、隔离schema与事务用例已执行；生产TLS/CA/权限、实际连接预算、存量数据/会话和恢复仍待验证，不能用本地无TLS的隔离库代替。
3. **浏览器全链路**：真实Launchpad登录、cookie与显式兼容profile、多标签登出、状态恢复、对象存储CORS/签名、50MiB边界、双文件并发、异常重试与安全DOM。
4. **后台与故障**：并发complete、lease过期旧worker、崩溃恢复、删除/封禁竞态、共享限流、机器人action/时间/重放、cleanup与Lifecycle不误删输入。
5. **资源与运维**：Launchpad应用/worker的配额与生命周期、UCloud上scanner/ClamAV/OpenClaw的独立预算、学校共享出口负载/P95、secret分离/轮换、DB+对象恢复、回滚与告警。小样本历史用时不代替这些门槛。

本次实施未修改原平台运行配置、生产Secrets、生产数据库或UCloud服务。真实环境门槛通过并完成具体版本/配置引用/回切方案审阅后，才进入最终发布确认。

## 6. 设计阶段的历史静态验证

初始设计阶段补充了部署环境、应用/scanner变量模板，以及旧资料的适用范围说明。以下数量记录那一阶段的静态检查，不作为当前代码/链接总数或运行验收数量。

2026-11-11 静态检查通过：16份Markdown文档的代码围栏和91个本地链接；两份新环境模板共44个变量的格式、重复键、角色隔离、上传/扫描上限匹配；OpenAPI 27个操作、37个schema、49项示例/默认值；数据库快照7表72字段及索引/外键名称；`git diff --check`。校验工具依赖在忽略的.tmp目录，未更改项目依赖。

该设计阶段未执行Java构建或数据库SQL。随后实施已修改代码、仓库计划和CI并执行本地构建/隔离SQL/浏览器测试，不能继续把当前分支称为“仅修改文档”。真实.env/Secrets值与生产数据库未读取或修改；工作区原有next-env.d.ts、package-lock.json和test-results改动保持原状。只读平台状态仍属于现有发布，没有SSH、部署、DNS或防火墙变更。

## 7. 实施阶段收尾

最新源码、部署计划、测试结果及仍待完成的外部验收统一记录在 [Java实施状态](JAVA-IMPLEMENTATION-STATUS.md)。根Launchpad计划已替换为Java，旧计划另行备份；本地JAR已生成。完整Maven verify60项无跳过，后续UploadFlowIntegrationTest定向12/12通过（包括新增孤儿inventory防误删用例），合计61个不同Java用例通过，不能写成单次全量61项。15项Node及最新29项Edge检查通过、零pageerror；后者追加了实际HTTP的ready成功/失败、无cron401及旧上传默认410。

实施后静态复核为OpenAPI27个操作、37个schema、50项示例/默认值及7表72字段对照；与第6节旧静态数字分开记录。当前静态资源无内容哈希，全部响应保守no-store，未宣称哈希缓存已实现。

平台变量只读核对只确认名称与作用域：35个运行时引用中已有26名，另有9名待按模板登记；未检查真实值、生产TLS或权限，也没有写入平台。具体名单与发布阻断项见实施状态。没有本地Docker或平台镜像构建证据，没有Java线上发布或生产业务验收结论。
