# Java 版本实施与验证状态

更新时间：2026-11-12（Asia/Shanghai）。工作分支：`codex/java-api-design`。Java 业务代码和原生前端已落地并完成本地构建；**尚未构建或发布 Launchpad Java 镜像，尚未切换生产流量**。

最新前端以用户确认的正在运行的siderlearn.com为交互参照，导航、返回、搜索、表单、提示、验证和上传重置已按原行为对齐。新增workspace视图恢复原本人100条/举报100条/审计200条窗口；本轮67个Java用例、18项前端测试及29项实际JAR联调通过。原版与Java运行对照及证据边界见 [前端交互对齐记录](FRONTEND-BEHAVIOR.md)。下文2026-11-11截图与快照属于先前检查点，不能代替本轮行为证据。

## 1. 已有实现与文件

| 内容 | 实现位置 / 状态 |
| --- | --- |
| Java 工程 | `backend/pom.xml`，Java 21、Spring Boot 4.1.2、Spring MVC、Spring JDBC、HikariCP；本地使用 Maven 3.9，仓库未提供 Maven Wrapper |
| 页面 | `backend/src/main/resources/static/`，原生 HTML/CSS/JavaScript；登录、资源搜索/详情/编辑、上传队列、本人列表、举报与管理页面 |
| 身份与安全 | 服务端 Launchpad userinfo、随机会话/HMAC、Cookie与显式 header-compat、角色/封禁核对、共享限流、风险挑战、同源与正文限制 |
| 资源与治理 | 全文/trigram 搜索及安全高亮、签名游标、PA 规则、作者删除、举报唯一约束、管理员审核/封禁、事务审计 |
| 上传与任务 | 私有签名 PUT、不可变快照、complete CAS+唯一任务、租约/fencing、三次有界重试、下载签名及安全清理 |
| 构建产物 | 本地 `mvn verify` 已生成 `backend/target/sider-1.0.0.jar`；target为构建输出，不作为源码提交 |
| 容器 | [backend/Dockerfile](../backend/Dockerfile)，Maven多阶段构建、Java21运行镜像、非root用户，监听 `0.0.0.0:8080`；本机无Docker工具，未验证镜像构建/启动 |
| Launchpad计划 | 根 `.launchpad/deploy.json` 已改为 `root=backend`、`runtime=dockerfile`、`port=8080`、`healthPath=/api/health` 与运行时变量引用；无迁移 `releaseCommand`、无启动DDL |
| 源码打包 | [package-java-launchpad.mjs](../scripts/package-java-launchpad.mjs)只收集审阅过的Java主源码/静态资源、pom、Dockerfile和计划，不收集真实env、旧Node入口或编译缓存 |
| CI | [java.yml](../.github/workflows/java.yml)包含Java21/Maven、隔离PostgreSQL历史schema与原生前端测试；本地检查不代表远端CI或平台已运行 |
| 旧版回切资料 | [旧Launchpad计划](../infra/legacy/launchpad-next.deploy.json)、根Node Dockerfile/Compose、旧Node源码和CI仍保留；不把它们当Java发布入口 |

新版本沿用既有七张表及Drizzle迁移历史，没有新增业务DDL或重建生产表。本地集成库由原有0000—0006 SQL初始化，不能据此声称生产数据兼容、恢复或迁移已验收。

## 2. 已确认的本地验证

| 检查 | 已确认结果 | 证据范围与限制 |
| --- | --- | --- |
| Java完整 `mvn verify` | 60项通过，0失败/0错误/0跳过：40项单元/边界测试、9项资源PostgreSQL集成、11项上传PostgreSQL集成 | 本地Java21、隔离真实PostgreSQL及合成记录；测试中的对象存储/扫描外部交互有替身，不证明真实云服务可用 |
| 后续上传集成定向 `mvn verify` | UploadFlowIntegrationTest 12/12通过，包含前11项及新增孤儿inventory防误删用例，重新生成JAR | 与前次完整检查合计61个不同Java用例已通过（40+9+12），不是单次全量61项记录 |
| 原生前端 Node 测试 | 15项通过 | 辅助逻辑、请求/状态处理与上传队列等；不等于浏览器/平台完整验收 |
| Java + Edge浏览器 | 最新29/29通过、零pageerror；覆盖Cookie/header-compat、实际HTTP ready成功/依赖故障/无cron401及旧上传默认410 | 真实JAR、PostgreSQL、CSP与Service Worker；外部平台/Redis/挑战由代理fixture替代，不证明真实Launchpad及云服务链路通过 |
| Docker / Launchpad | 未执行本地Docker构建、平台构建或发布 | 本机无Docker工具；平台资源、resolved plan、启动和回滚仍待验证 |

测试详情以 `backend/target/surefire-reports/` 及最终任务核对结果为准；重新修改代码后须复跑受影响检查。本页不引用2026-11-10原Next.js上线测试作为Java通过证据。

本地源码快照已生成在 `.tmp/java-launchpad/verified-20261111-2024`：49文件、239856字节；逐一源文件一致与私密文件排除检查通过，树摘要SHA-256为 `321bdca234c6adce01c1268cebc3458f3b34dd33f0aee32bdf5c85f99713c219`。这是未发布的本地快照，临时目录不作为持久交付或线上部署证据；隔离测试PostgreSQL已停止。

## 3. 平台运行时变量登记缺口

只读查询确认新计划35个运行时引用中已有26个变量名称/作用域；**未读取或验证真实值、授权、生产TLS或依赖可用性**。以下9个名称目前尚未登记，需在发布前按模板配置，不能仅因代码有默认值或旧别名就假定新引用能够解析：

| 待登记名称 | 配置依据 |
| --- | --- |
| `SPRING_PROFILES_ACTIVE` | production |
| `SERVER_ADDRESS` | 0.0.0.0 |
| `SERVER_PORT` | 8080，与平台计划一致 |
| `JAVA_TOOL_OPTIONS` | 按真实Launchpad配额核定，不直接复制未验收内存预算 |
| `SESSION_TRANSPORT` | cookie或明确的header-compat，依据真实代理验证选择 |
| `CURSOR_SIGNING_KEY` | 独立随机密钥，至少32字节；不复用pepper或cron secret |
| `UPLOAD_MAX_BYTES` | 默认52428800，修改须联动存储、scanner与浏览器验收 |
| `BOT_SITE_KEY` | 与真实注册origin匹配的公开site key；虽旧NEXT_PUBLIC_BOT_SITE_KEY名称存在，新计划明确引用BOT_SITE_KEY，仍须登记主名 |
| `UPLOAD_WORKER_ENABLED` | 正式启用上传时至少一个受监控实例为true |

本次没有创建这些变量或修改任何平台Secrets。其余26名已经存在，只是名称证据，不能作为配置完整或上线可用结论。

## 前端与原版对齐回归（2026-11-11）

根据现有 `app/` 与 `src/components/` 恢复Java原生页面的布局、文案和操作位置：品牌图标、侧栏管理分组、双栏登录、搜索筛选与结果标题、详情菜单、标签建议、本人上传列表、上传说明及管理页面。原 `app/styles.css` 完整复用，7个SVG按原路径复制；新增部分仅承载原生控件和长文本等边界。保留本站会话、安全DOM、权限、上传并发/取消/未知结果保护。本人列表的统计明确标为已加载范围，不冒充全量汇总。

本轮验证：

- 用原React组件和相同本地演示数据生成只读参照，资源页、登录页、上传不可用/可用页在1440与390宽度的8组截图，原始像素数据逐字节相同，选定主要区域的几何数据一致。此结果限于这些固定页面状态；不代表所有交互状态或线上真实数据完全相同。
- 最新Java页面通过29项真实JAR/隔离PostgreSQL/浏览器联调；外部平台、Redis及存储仍为明确的本地替身。
- 额外浏览器检查通过标签筛选/清除、详情更多菜单/标签建议/移除原因表单、手机文件类型筛选，以及等待机器人验证时取消文件并释放并发槽位。浏览器无页面错误，手机无横向溢出。
- 15项原生前端测试、静态资源零警告检查、4项鉴权控制器回归及JAR重新打包通过。此轮未重复全部数据库集成测试，先前61项证据范围仍按上文记录。

`GET /api/config` 新增公开布尔 `uploadsEnabled`，仅表示扫描器已配置，用于沿用原版上传页的暂不可用提示；不公开扫描地址/密钥，也不保证实时健康，后端继续独立验证。OpenAPI和API文档已同步。

本地预览监听 `http://127.0.0.1:8791`，使用独立 `sider_java_preview` 库和演示身份，不加载生产环境文件，未接真实文件上传下载。服务在本轮结束时保持运行。最新未发布源码快照为 `.tmp/java-launchpad/frontend-aligned-20261111`；上文49文件快照属于先前检查点，不再代表当前源码。

## 4. 运行、配置与兼容开关

先安装Java21与Maven3.9，在进程环境显式注入 [Java变量模板](examples/java-production.env.example) 的实际值。Spring不会自动读取该示例、`.env.local` 或 `.env.production`；复制文件本身不足以启动应用。生产值通过Launchpad运行时Secrets/Variables引用注入，不进入镜像构建层。

```text
mvn -B -ntp -f backend/pom.xml verify
node --test scripts/vanilla-*.test.mjs
java -jar backend/target/sider-1.0.0.jar
node scripts/package-java-launchpad.mjs <release-tag>
```

完整PostgreSQL测试必须显式注入独立的 `TEST_DATABASE_URL` 与匹配的 `TEST_DATABASE_HOST`，并在该隔离库初始化历史迁移；没有这些值时集成测试可能跳过，不能把普通 `verify` 成功解释为所有数据库用例通过。不得使用生产连接或把 `DATABASE_URL` 自动当测试库。打包命令只生成本地源码快照，不发布。

`LEGACY_UPLOAD_ENABLED` 默认 `false`：旧 `PUT /api/resources/{id}/upload` 在完成基础同源、身份与限流入口检查后返回410 `legacy_upload_disabled`。新前端仅使用对象存储签名PUT直传。明确启用旧中转接口后才允许作者中转正文，并仍须通过相同快照与扫描流程；此开关不提供绕过扫描的路径。

清理实现每轮最多处理200资源、200结束任务；另对 `pending/` 和 `active/` 各枚举一页最多200对象并使用continuation token逐轮推进。仅对超过15分钟、符合应用key布局、且不被任何资源权威key或任务source/snapshot/output引用的对象执行孤儿删除；逐项失败保留页重试，重启可以安全从头枚举，进度不是业务状态。应用存储身份因此需要这两个prefix的受限 `ListBucket`，以及必要对象读/写/删除权限；scanner仍使用独立只读身份。不能直接套用删除整个 `pending/` 的两天Lifecycle规则。

## 5. 仍需完成的上线验收

1. 后续代码变更的受影响测试回归，以及本地构建/浏览器证据归档；继续明确每项是否使用真实依赖。
2. Launchpad Java镜像构建/启动、实际CPU/内存/线程/出站配额、容器端口与resolved plan、休眠/终止/worker恢复。
3. 真实Launchpad SDK、注册origin、同源bridge、保留callback、Cookie透传；header-compat仅显式启用，不能自动降级。
4. 真实S3兼容服务的TLS、IAM、CORS、签名大小/类型约束、50MiB边界与双文件并发；真实scanner/ClamAV、SHA-256、故障重试与租约恢复。
5. 生产数据库 `verify-full` 与CA/主机名、低权限账户、连接总预算、既有数据/会话兼容；备份恢复、Secret轮换、回滚/回切及监控。

这些门槛没有因本地测试通过而关闭。UCloud仅承担独立scanner及既有OpenClaw，不作为Java应用主机。本次未修改平台Secrets、生产数据库、DNS、防火墙或UCloud服务，也未发布。发布需在具体版本、变量引用和回切方案可审阅后取得最终确认。
