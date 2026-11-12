# Java 迁移数据库访问设计

> 状态：实施访问合同，2026-11-11。对应 [Java 迁移 PRD](./JAVA-MIGRATION-PRD.md) 与 [API 设计](./API-DESIGN.md)，当前证据见 [实施状态](./JAVA-IMPLEMENTATION-STATUS.md)。
> Java + Spring Boot 数据访问已在 `backend/` 实现，并使用隔离 PostgreSQL 与合成数据验证资源、权限、事务和上传竞态。本文 SQL 仍是访问规则说明，实际执行以实现和测试为准，不表示每段示例均逐字执行。既有线上发布仍为原版本；表结构以 `src/db/schema.ts` 和 `drizzle/0000`—`0006` 为依据，未读取生产数据库元数据或执行生产 SQL。

## 1. 技术选择与边界

- Java 后端通过 Spring JDBC `NamedParameterJdbcTemplate` 访问 PostgreSQL，连接池使用 HikariCP；不引入 Hibernate/JPA 自动建表，不把 ORM 对象直接序列化给前端。
- HTML/CSS/JavaScript 前端只调用同源 API。浏览器不能持有数据库连接串或调用 SQL；业务权限由 Java 服务端与带权限条件的 SQL 共同执行。
- 保留已有 PostgreSQL、私有对象存储和扫描服务，不因语言迁移复制生产数据库、重置表、改变用户 UUID、Launchpad `sub` 或对象 key。
- Java 发布前不新增强制业务列；并发控制使用既有状态、行锁、条件更新及队列租约。所有外部 HTTP、对象存储、扫描器调用均在数据库事务之外。
- 当前 Drizzle 迁移及其 journal 继续作为唯一迁移来源。第一版 Java 服务只访问现有表，迁移工具在独立运维步骤运行；不同时启用 Flyway/Liquibase。未来完全移除 Node 工具链时，另做有审计记录的迁移历史接管设计，不能把 `0000` 当作空库基线重新执行。

Spring JDBC 管理连接及语句资源，并提供绑定命名参数和统一数据访问异常的能力；本文据此定义仓储接口，而非手工拼接请求 SQL。参见 [Spring JDBC 文档](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html)。

## 2. 数据源与连接预算

应用、扫描器、迁移作业的完整变量归属与主机网络见 [部署环境](DEPLOYMENT-ENVIRONMENT.md)。下表包含多个进程的合同，不代表应把所有变量注入应用：DATABASE_URL_UNPOOLED 的 DDL 身份仅提供给独立迁移作业，常驻 Java 使用低权限 DATABASE_URL。

### 2.1 环境变量

| 配置 | 目标约定 |
| --- | --- |
| `DATABASE_URL` | 应用用 `postgresql://user:password@host:port/database?...`；Neon 等池化服务使用应用池化地址 |
| `DATABASE_URL_UNPOOLED` | 独立迁移作业使用的直接连接；生产迁移必须显式配置，不自动回退池化地址 |
| `DATABASE_MAX_CONNECTIONS` | 单 JVM Hikari `maximumPoolSize`，默认 5；启动校验 1—20，并受总预算进一步限制 |
| `SESSION_TOKEN_PEPPER` | 与现有会话兼容的 HMAC 密钥；迁移时保持值不变，否则明确安排全部重新登录 |
| `SESSION_TTL_SECONDS` | 目标 3600，允许更短但不能超过 3600；不滑动延长绝对有效期 |
| `CURSOR_SIGNING_KEY` | 新增应用配置，独立随机密钥，至少 32 随机字节；只用于游标签名，不是数据库字段 |
| `SHSID_ADMIN_SUBS` | 精确匹配的管理员 Launchpad `sub` 集合；所有实例必须使用同一版本配置 |

不能简单给 `DATABASE_URL` 前面加 `jdbc:`：必须用 URI 解析器分别提取协议、主机、端口、库名、用户名、密码和允许的查询参数，再构造 `jdbc:postgresql://host:port/database` 与独立的 Hikari username/password 属性。凭据百分号解码只做一次；userinfo 以第一个分隔冒号区分用户与密码，编码的 `@`、`:`、`+` 不得被误解析，`+` 不按表单空格处理。支持显式端口与带方括号 IPv6；拒绝多主机、不支持的协议、空库名、重复敏感参数及未知参数，错误只输出配置名与错误类别。

JDBC URL 不携带 user/password；不允许查询参数覆盖提取出的凭据、TLS 策略或注入 `options`/自定义 `sslfactory`。启动时对允许项采用白名单（如 `sslmode`、`sslrootcert`、`channelBinding`），Node/libpq 的不兼容参数需要显式转换或报告不支持，不能默默忽略。原连接串、解析后的 `Properties`、数据库异常里的连接地址都不得进入日志、健康响应、追踪或页面。URL 参数会影响驱动属性优先级，参见 [pgJDBC 连接参数](https://jdbc.postgresql.org/documentation/use/)。

### 2.2 TLS 与池配置

生产应用和迁移都使用 `sslmode=verify-full`，验证证书链与主机名，并配置实际 CA 信任来源。原 Node 校验允许的 `sslmode=require` 只保证加密，不能直接视为 Java 目标的服务器身份验证；如果环境只有 `require`，先补证书/CA 配置再放行生产。仅明确的本机开发地址允许 `sslmode=disable`。禁止使用非验证 SSL factory 绕过错误。[pgJDBC SSL 文档](https://jdbc.postgresql.org/documentation/ssl/)解释了 `require`、`verify-ca` 与 `verify-full` 的差别。

| Hikari / JDBC 配置 | 初始目标值与说明 |
| --- | --- |
| 池数量 | 每 JVM 一个共享 DataSource；API 与同 JVM worker 共用，不按请求创建池 |
| `maximumPoolSize` / `minimumIdle` | 5 / 0；上线前按连接预算与冷连接指标调整 |
| `connectionTimeout` | 10 秒；池耗尽返回依赖不可用，不无界等待 |
| `idleTimeout` / `maxLifetime` | 300 秒 / 1500 秒；需小于供应商对应连接限制 |
| JDBC `connectTimeout` / `socketTimeout` | 10 秒 / 30 秒；独立于 S3、扫描 HTTP 超时 |
| JDBC `prepareThreshold` | 初版设为 0，避免依赖池化服务是否支持跨事务服务端 prepared statement；仍使用 JDBC 参数绑定 |
| 默认隔离级别 | `READ COMMITTED`；对关键竞争显式锁行，不全站提升为 SERIALIZABLE |
| 事务内限制 | `SET LOCAL statement_timeout='5s'`、`SET LOCAL lock_timeout='2s'`；复杂报表如需放宽单独评估 |
| SQL 调试日志 | 生产关闭 SQL 参数绑定、连接串和驱动细节日志；只保留 operation、duration、行数、脱敏错误码 |

预算公式：`API JVM 数 × 每池上限 + 独立 worker JVM 数 × 每池上限 + 同时迁移连接(1) + 运维预留 <= 数据库/池化服务允许的连接预算`。蓝绿发布须把新旧实例同时计入。相同 JVM worker 不重复计数；多个实例也不能各自假定独占数据库。示例：两个 Java JVM 各 5、新旧 Node 各自实际连接数、迁移 1 和运维预留之和必须先核算，不能仅因默认 5 就认定安全。

## 3. 现有结构的精确字典

以下 `NN` 表示 `NOT NULL`，`NULL` 表示可空，`—` 表示无默认。`timestamptz` 是 PostgreSQL `timestamp with time zone`。所有外键 `ON UPDATE NO ACTION`；除明确注明外无额外 CHECK/UNIQUE。字段长度、正数限制、状态转换、PA 权限主要由应用校验，不能声称已有数据库约束兜底。

### 3.1 枚举

```mermaid
erDiagram
  users ||--o{ sessions : user_id
  users ||--o{ resources : author_id
  resources ||--o| upload_scan_jobs : resource_id
  resources ||--o{ resource_reports : resource_id
  users ||--o{ resource_reports : reporter_id
  users o|--o{ resource_reports : handled_by
  users o|--o{ audit_logs : actor_id
```

`oauth_login_transactions` 无外键，独立于图中的业务关系；审计 target_id 为多态引用，不画成实际外键。

| 数据库类型 | 全部允许值 |
| --- | --- |
| `user_role` | `student`, `admin` |
| `user_status` | `active`, `suspended` |
| `resource_status` | `pending`, `scanning`, `active`, `hidden`, `quarantined`, `deleted`, `failed` |
| `report_reason` | `copyright_privacy`, `malware`, `inappropriate`, `spam`, `other` |
| `report_status` | `open`, `resolved`, `dismissed` |

`upload_scan_jobs.status` 是普通 `text`，其 `queued/processing/done/failed` 值是应用约定；现有 SQL 没有对应 PostgreSQL enum 或 CHECK。Java 不得用 `resource_status` 强转它。

### 3.2 `users`

| 列 | 类型 | 空值 | 默认 | 语义 / 约束 |
| --- | --- | --- | --- | --- |
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `launchpad_sub` | text | NN | — | 外部身份不可变键，唯一索引 |
| `email` | text | NULL | — | 可更新资料，不作唯一身份键 |
| `display_name` | text | NN | — | 展示名 |
| `avatar_url` | text | NULL | — | 可空图片 URL |
| `org` | text | NN | — | 外部资料快照；无 org 时使用 `personal:<sub>` |
| `verified` | boolean | NN | — | 外部资料快照，不作为当前登录阻断条件 |
| `role` | user_role | NN | `student` | 由管理员 sub 配置校正 |
| `status` | user_status | NN | `active` | 封禁后拒绝业务请求 |
| `created_at` | timestamptz | NN | `now()` | 创建时间 |
| `updated_at` | timestamptz | NN | `now()` | 无自动更新触发器，写入者须更新 |
| `last_login_at` | timestamptz | NN | `now()` | 最近成功资料更新/登录时间 |

索引：PK `users_pkey(id)`；唯一 B-tree `users_launchpad_sub_unique(launchpad_sub)`。无 email 唯一约束。

### 3.3 `sessions`

| 列 | 类型 | 空值 | 默认 | 语义 / 约束 |
| --- | --- | --- | --- | --- |
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `user_id` | uuid | NN | — | FK → users.id，DELETE CASCADE |
| `token_hash` | text | NN | — | peppered HMAC，唯一索引；不存原 token |
| `expires_at` | timestamptz | NN | — | 不可滑动延长的绝对有效期 |
| `created_at` | timestamptz | NN | `now()` | 创建时间 |
| `last_seen_at` | timestamptz | NN | `now()` | 可节流更新，不影响 expires_at |
| `revoked_at` | timestamptz | NULL | — | 非空即失效 |

索引：PK `sessions_pkey(id)`；唯一 B-tree `sessions_token_hash_unique(token_hash)`；B-tree `sessions_user_active_idx(user_id,expires_at)`，注意该名字虽有 active，但不是 partial index。FK 名 `sessions_user_id_users_id_fk`。

### 3.4 `oauth_login_transactions`

| 列 | 类型 | 空值 | 默认 | 语义 / 约束 |
| --- | --- | --- | --- | --- |
| `id` | uuid | NN | — | PK，由应用指定 |
| `state_hash` | text | NN | — | 历史服务端流程状态摘要 |
| `expires_at` | timestamptz | NN | — | 过期时间 |
| `consumed_at` | timestamptz | NULL | — | 已消费时间 |
| `created_at` | timestamptz | NN | `now()` | 创建时间 |

索引：PK `oauth_login_transactions_pkey(id)`；B-tree `oauth_login_transactions_expiry_idx(expires_at)`。无用户 FK。目标官方浏览器 SDK 继续负责 PKCE、state、nonce；Java 不另建第二套 PKCE 事务，保留本表仅兼容历史与到期清理，不写入新登录事务。

### 3.5 `resources`

| 列 | 类型 | 空值 | 默认 | 语义 / 约束 |
| --- | --- | --- | --- | --- |
| `id` | uuid | NN | `gen_random_uuid()` | PK；意图也可由应用预生成 UUID |
| `author_id` | uuid | NN | — | FK → users.id，DELETE RESTRICT |
| `title` | text | NN | — | 标题 |
| `description` | text | NN | `''` | 描述 |
| `tags` | text[] | NN | `ARRAY[]::text[]` | 非 NULL 数组 |
| `original_filename` | text | NN | — | 清理后的展示文件名 |
| `object_key` | text | NN | — | 当前权威对象 key，唯一索引；不进入公共 DTO |
| `mime_type` | text | NN | — | 上传声明，发布时更新为扫描检测值 |
| `size_bytes` | bigint | NN | — | 字节数，应用限制 `1..UPLOAD_MAX_BYTES` |
| `sha256` | text | NULL | — | 未扫描时可空；发布前必须有合规 SHA-256 |
| `search_text` | text GENERATED ALWAYS STORED | NULL | 生成表达式 | 数据库生成，禁止 INSERT/UPDATE 显式写入 |
| `search_vector` | tsvector GENERATED ALWAYS STORED | NULL | 生成表达式 | 数据库生成，禁止显式写入 |
| `status` | resource_status | NN | `pending` | 当前状态 |
| `moderation_reason` | text | NULL | — | 审核或系统隔离原因 |
| `created_at` | timestamptz | NN | `now()` | 意图创建时间 |
| `updated_at` | timestamptz | NN | `now()` | 最近状态/元数据修改 |
| `published_at` | timestamptz | NULL | — | 首次扫描通过发布时写入；hide/restore 不重新排名 |
| `deleted_at` | timestamptz | NULL | — | 软删除时间 |
| `object_deleted_at` | timestamptz | NULL | — | 现权威对象已确认删除时间，0001 增加 |

`search_text` 是 `coalesce(title,'') || ' ' || coalesce(original_filename,'') || ' ' || coalesce(public.immutable_text_array_to_string(tags),'') || ' ' || coalesce(description,'')`。`search_vector` 用 `simple` 配置拼接带权向量：title=A、original_filename=A、tags=B、description=C。生成列没有显式 NN 约束，即使当前表达式实际通常非 NULL，也不伪造已有约束。

索引：PK `resources_pkey(id)`；唯一 B-tree `resources_object_key_unique(object_key)`；partial B-tree `resources_active_published_idx(published_at DESC NULLS LAST,id DESC NULLS LAST) WHERE status='active'`；B-tree `resources_author_created_idx(author_id,created_at DESC NULLS LAST)`；GIN `resources_search_vector_idx(search_vector)`；GIN `resources_search_text_trgm_idx(search_text gin_trgm_ops)`。FK 名 `resources_author_id_users_id_fk`。

### 3.6 `upload_scan_jobs`

| 列 | 类型 | 空值 | 默认 | 语义 / 约束 |
| --- | --- | --- | --- | --- |
| `resource_id` | uuid | NN | — | PK，同时 FK → resources.id，DELETE CASCADE；每资源最多一任务 |
| `source_key` | text | NN | — | 浏览器仍可能写入的入口对象 |
| `snapshot_key` | text | NN | — | 仅服务端可写的不可变扫描输入 |
| `status` | text | NN | `queued` | 应用限定 queued/processing/done/failed |
| `attempts` | integer | NN | `0` | 每次领取递增，无数据库非负 CHECK |
| `available_at` | timestamptz | NN | `now()` | 下次可领取时间 |
| `lease_token` | uuid | NULL | — | 每次领取的新随机租约令牌 |
| `lease_until` | timestamptz | NULL | — | 租约截至时间 |
| `last_error` | text | NULL | — | 固定的脱敏原因码 |
| `source_deleted_at` | timestamptz | NULL | — | 该任务非权威副本已完成清理 |
| `created_at` | timestamptz | NN | `now()` | 入队时间 |
| `updated_at` | timestamptz | NN | `now()` | 最近任务状态变化 |

索引：PK `upload_scan_jobs_pkey(resource_id)`；B-tree `upload_scan_jobs_due_idx(status,available_at)`。FK 名 `upload_scan_jobs_resource_id_resources_id_fk`。source/snapshot 无单独唯一约束；不能靠它们防止重复任务，防重依据是 resource_id PK。

### 3.7 `resource_reports`

| 列 | 类型 | 空值 | 默认 | 语义 / 约束 |
| --- | --- | --- | --- | --- |
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `resource_id` | uuid | NN | — | FK → resources.id，DELETE RESTRICT |
| `reporter_id` | uuid | NN | — | FK → users.id，DELETE RESTRICT |
| `reason` | report_reason | NN | — | 原因枚举 |
| `details` | text | NN | `''` | 说明 |
| `status` | report_status | NN | `open` | 当前处理状态 |
| `handled_by` | uuid | NULL | — | FK → users.id，DELETE RESTRICT |
| `handled_at` | timestamptz | NULL | — | 处理时间 |
| `resolution_note` | text | NULL | — | 处理说明 |
| `created_at` | timestamptz | NN | `now()` | 创建时间 |

索引：PK `resource_reports_pkey(id)`；partial 唯一 B-tree `resource_reports_open_unique(resource_id,reporter_id) WHERE status='open'`；B-tree `resource_reports_queue_idx(status,created_at)`。三个 FK 名分别为 `resource_reports_resource_id_resources_id_fk`、`resource_reports_reporter_id_users_id_fk`、`resource_reports_handled_by_users_id_fk`。已处理后可再次举报；仅同时 open 的重复举报冲突。

### 3.8 `audit_logs`

| 列 | 类型 | 空值 | 默认 | 语义 / 约束 |
| --- | --- | --- | --- | --- |
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `actor_id` | uuid | NULL | — | FK → users.id，DELETE SET NULL；系统事件可空 |
| `action` | text | NN | — | 固定动作名 |
| `target_type` | text | NN | — | resource/user/report 等固定类型 |
| `target_id` | uuid | NULL | — | 多态目标，**没有 FK** |
| `metadata` | jsonb | NN | `'{}'::jsonb` | 有界、白名单、已脱敏元数据 |
| `created_at` | timestamptz | NN | `now()` | 事件创建时间 |

索引：PK `audit_logs_pkey(id)`；B-tree `audit_logs_target_idx(target_type,target_id,created_at)`。FK 名 `audit_logs_actor_id_users_id_fk`。当前不存在全局 `created_at,id` 分页索引；初版先按真实数据量验证，不无依据新增。

### 3.9 扩展、函数与历史

- 0003 创建 `pg_trgm` 扩展及 `public.immutable_text_array_to_string(text[])`（SQL、IMMUTABLE、PARALLEL SAFE），并增加两生成列与 GIN 索引。
- 0002 曾建立 `local_accounts`，0004 曾建立 `registration_invites`，两者均在 0005 删除。最终不是九张业务表，不恢复用户名密码或邀请注册。
- 0006 增加 `upload_scan_jobs`，在 Java 连接到的测试库须确认迁移已到这一版本；本设计不证明线上已经应用。
- 主键默认使用既有 `gen_random_uuid()`；不因切换 Java 改成自增 ID。无需要 Java 启动时创建的序列。

## 4. Java 访问层契约

`Controller → Service（权限、事务、外部服务编排）→ Repository（参数化 SQL + RowMapper）→ 共享 DataSource`。Repository 不读取 Cookie、不发 HTTP、不返回 `ResponseEntity`；Service 不在对象存储调用期间持有事务。DTO 字段与状态码见 API 文档。

| Repository / 方法 | 输入 / 返回 | 事务与必须条件 |
| --- | --- | --- |
| `UserRepository.upsertLaunchpadProfile` | 已由服务端 userinfo 验证的 profile → user row | 与会话签发同一事务；冲突键 launchpad_sub，不覆盖 status |
| `UserRepository.lockUsersOrdered` | 去重排序 UUID 列表与锁模式 → rows | 必须使用同一连接；防封禁/角色变更竞争 |
| `SessionRepository.findPrincipal` | HMAC token hash → session+user 或空 | 检查 active、expires、revoked；角色与配置校正 |
| `SessionRepository.insert/revoke/revokeAllForUser` | 新 token hash / userId → 行数 | 不接收原 token，不隐式续期 |
| `ResourceRepository.search` | 规范化 q/type/tag + 验证后的 cursor → 21 rows | 有 q 时事务内 SET LOCAL；返回20与nextCursor |
| `ResourceRepository.findForViewer` | resourceId,viewerId,isAdmin → DTO 或空 | active 或非deleted作者/管理员条件写在SQL |
| `ResourceRepository.listMine` | viewerId,status group,cursor → 21 rows | includes deleted，created_at DESC,id DESC |
| `ResourceRepository.listTags` | 当前已鉴权用户 → <=500 活跃标签+预设 | 不泄露隐藏/隔离资源标签 |
| `ResourceRepository.createPending` | 已验证 metadata,file,userId → id | pending、随机 key；签名失败不伪称成功 |
| `ResourceRepository.updateMetadata/softDelete` | actor,target,metadata → id/status 或空 | 编辑作者/管理员；DELETE仅作者；状态CAS+审计同一事务 |
| `UploadRepository.enqueueSnapshot` | resourceId,actorId,sourceKey,snapshotKey → outcome | pending CAS+唯一 job 插入原子提交 |
| `UploadRepository.listOwnedStatuses` | actorId,1..5个UUID → 状态DTO集合 | author_id 条件，不通过全库ID列表越权 |
| `ScanJobRepository.claim/settle` | worker租约 / 结果 → leased job / committed | 领取短事务；外部处理；有栅栏的结算短事务 |
| `ReportRepository.create` | reporter,resource,reason,details → id | active、非作者；partial唯一冲突409 |
| `ReportRepository.list` | admin,status,cursor → 101 rows | created_at ASC,id ASC；返回100 |
| `ModerationRepository.moderate/dismiss/suspend` | admin,target,reason → outcome | 状态CAS+关联举报+撤销会话+审计按动作原子提交 |
| `AuditRepository.append/list` | 白名单事件 / admin,cursor → id /101rows | append参加业务事务；查询 created_at DESC,id DESC |
| `CleanupRepository.claimExpired/confirmObjectDeleted` | 截止时间、批量上限 / expected key → 行数 | 锁行复核、先终态提交、事务外删除、再CAS标记 |

JDBC 映射：uuid ↔ `UUID`；timestamptz ↔ `OffsetDateTime`/`Instant`（精确保留微秒，不先转毫秒）；bigint ↔ `long`；numeric score ↔ `BigDecimal`；text[] 用 `Connection.createArrayOf("text",values)` 并及时释放 `java.sql.Array`；jsonb 使用 JSON 序列化器与 `CAST(:metadata AS jsonb)`，禁止 `Map.toString()`。枚举参数用 `CAST(:status AS resource_status)` 等显式类型转换，不拼接枚举字面量。

## 5. 查询、过滤与游标

### 5.1 输入规范化与权限边界

- `q` trim 后 0—120 字符；`type` 单值 enum：pdf/docx/pptx/xlsx/txt/png/jpeg，映射为服务端固定 MIME；不接收任意 SQL 列名或 order 表达式。
- `tag` 单值、trim 后1—30字符。`collection=peer-advisors` 仅在 tag 缺省时转成 PA；其他 collection 拒绝。不新增 PA 栏目。
- 有 q 按相关性、发布时间、UUID 降序；无 q 按发布时间、UUID 降序。目标没有 sort 参数。
- PA 判断：对标签 NFKC、lowercase、移除非 `[a-z0-9]` 后，结果为 `pa`、`peeradvisor`、`peeradvisors` 即保留标签；写入统一 `PA`。普通学生在创建或完整替换 tags 时提交任何别名都返回403，不能在去重/截断后才判断。包括作者编辑已含 PA 的资源时，学生仍不能提交 PA。
- 普通标签 trim、忽略大小写去重、保留首次展示拼写，最多10个，每个1—30字符。数据库不强制这些限制，所有写入口必须调用同一策略。

### 5.2 搜索 SQL（绑定参数示例）

`:q`、`:pattern`、`:mime`、`:tag`、`:is_pa`、`:has_cursor`、`:cursor_score`、`:cursor_time`、`:cursor_id` 都是 JDBC 绑定参数；无值用带 SQL 类型的 null。pattern 为 `%` + 将 q 中 `\`、`%`、`_` 逐字转义的字符串 + `%`。不把 q 插入 SQL 源码。`:limit` 固定为21，不由客户端任意放大。

有 q 时在同一短事务、同一连接执行：

```sql
SELECT set_config('pg_trgm.word_similarity_threshold', '0.3', true);
```

随后执行（无 q 可走独立的纯 newest 模板以便更好利用索引）：

```sql
WITH input AS (
  SELECT CAST(:q AS text) AS q,
         websearch_to_tsquery('simple', CAST(:q AS text)) AS tsq
), ranked AS (
  SELECT r.id, r.title, r.description, r.tags, r.original_filename,
         r.mime_type, r.size_bytes, u.display_name AS author_name,
         coalesce(r.published_at, r.created_at) AS page_time,
         CASE WHEN i.q = '' THEN 0::numeric ELSE round((
           ts_rank_cd(r.search_vector, i.tsq, 32)::numeric * 100
           + word_similarity(i.q, r.search_text)::numeric * 10
           + CASE WHEN r.title ILIKE :pattern ESCAPE E'\\' THEN 8 ELSE 0 END
           + CASE WHEN r.original_filename ILIKE :pattern ESCAPE E'\\' THEN 4 ELSE 0 END
           + CASE WHEN r.description ILIKE :pattern ESCAPE E'\\' THEN 2 ELSE 0 END
           + CASE WHEN array_to_string(r.tags,' ') ILIKE :pattern ESCAPE E'\\'
                  THEN 1 ELSE 0 END
         )::numeric, 6) END AS score
  FROM resources r
  JOIN users u ON u.id = r.author_id
  CROSS JOIN input i
  WHERE r.status = 'active'
    AND (CAST(:mime AS text) IS NULL OR r.mime_type = :mime)
    AND (CAST(:tag AS text) IS NULL OR
      (CAST(:is_pa AS boolean) AND EXISTS (
        SELECT 1 FROM unnest(r.tags) AS t(value)
        WHERE regexp_replace(lower(trim(normalize(t.value,NFKC))),
                             '[^a-z0-9]+','','g')
              IN ('pa','peeradvisor','peeradvisors')
      )) OR (NOT CAST(:is_pa AS boolean) AND EXISTS (
        SELECT 1 FROM unnest(r.tags) AS t(value)
        WHERE lower(trim(t.value)) = lower(CAST(:tag AS text))
      )))
    AND (i.q = '' OR r.search_vector @@ i.tsq
         OR r.search_text %> i.q
         OR r.search_text ILIKE :pattern ESCAPE E'\\')
)
SELECT id,title,description,tags,original_filename,mime_type,size_bytes,
       author_name,page_time,score
FROM ranked
WHERE NOT CAST(:has_cursor AS boolean)
   OR (score,page_time,id) <
      (CAST(:cursor_score AS numeric), CAST(:cursor_time AS timestamptz),
       CAST(:cursor_id AS uuid))
ORDER BY score DESC,page_time DESC,id DESC
LIMIT :limit;
```

在返回的20条数据上才生成 highlight；使用相同 `websearch_to_tsquery`、`ts_headline` 标记文本并解析为 `{text,highlighted}` 数组，前端以 textContent/`mark` 节点显示，不能把 ts_headline 结果当可信 HTML。原文字中的标记字符须先转义或采用安全分段回退，不能让输入伪造高亮标签。

`SET LOCAL` 不跨事务污染连接。索引支持与阈值语义参考 [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)。`coalesce(published_at,created_at)` 与现有 published_at 索引表达式不完全相同；当前索引是否足够须用隔离测试库的真实分布与执行计划确认，不在本设计声称必走某个索引。

### 5.3 游标契约

对 API 游标保持不透明字符串：`base64url(payloadUTF8) + '.' + base64url(HMAC_SHA256(CURSOR_SIGNING_KEY,payloadUTF8))`。验签用常数时间比较；base64url 严格解码，总长度上限2000个ASCII字符（亦为2000字节），签名通过后再验证结构、版本、有效期、字段范围与请求指纹。无合法游标时返回400 `invalid_cursor`，不能静默回到第一页。

内部 payload v1 含 `v=1`、`iat`、`exp`、`fingerprint`、`position`；不是公开响应 DTO。使用UTC epoch秒验证iat不在未来、exp>iat、exp-iat<=3600且当前时间<exp。fingerprint 是固定字段顺序 canonical JSON `{q,type,tag,status,scope}` 的 SHA-256 base64url：缺省统一为 null、q用trim值、type用合法enum、PA别名统一PA，其他tag trim+lowercase。`scope` 为 `resources`、`mine:<userUUID>`、`reports:<adminUUID>`、`audit:<adminUUID>`；status按接口默认值规范化，collection别名不再单独进入指纹。

资源搜索 position 含 score 固定6位十进制字符串、精确保留 PostgreSQL 微秒的 UTC 时间字符串、UUID。不要经 JavaScript Number 或 Java double 往返 score，不把时间截到毫秒。Mine/audit降序 position为created_at与id；reports升序用同两字段但谓词为 `>`。用户切换或任一筛选变化必须清空游标。旧版无签名游标明确不兼容，返回400，由新前端提示重新加载第一页并清空旧列表和游标，不得把第一页静默追加到原结果。

keyset 防止同分/同时间的静态结果重漏，不提供跨请求数据库快照：期间编辑标题改变score、隐藏/删除、改变标签时，结果可变；前端列表按id合并去重并允许重新搜索。不跨翻页长持数据库事务或保存连接。

### 5.4 其他列表与可见性 SQL

详情（作者和管理员可见非deleted；其他学生只能active）：

```sql
SELECT r.id,r.author_id,r.title,r.description,r.tags,r.original_filename,
       r.mime_type,r.size_bytes,r.status,r.published_at,u.display_name AS author_name
FROM resources r JOIN users u ON u.id=r.author_id
WHERE r.id=CAST(:id AS uuid)
  AND (r.status='active' OR
       (r.status<>'deleted' AND
        (r.author_id=CAST(:viewer AS uuid) OR CAST(:is_admin AS boolean))));
```

下载签名前单独查询 `WHERE id=:id AND status='active' AND object_deleted_at IS NULL`，所有角色一致，不因作者/管理员可看隔离详情就允许下载隔离文件；只在存储服务内部取得object_key。签名后已发出的120秒 URL仍可能在到期前可用，封禁/隐藏阻止后续签发，不承诺撤回已签 URL。

Mine：`WHERE author_id=:viewer`，status=all不加状态条件；active→active；scanning→pending/scanning；unavailable→hidden/quarantined/deleted/failed。附加 `(created_at,id)<(:time,:id)`，`ORDER BY created_at DESC,id DESC LIMIT21`。全部统计若需要，用独立按作者聚合，不能拿一页计数冒充全部资源数量。

Reports：`WHERE status=CAST(:status AS report_status)`，`(created_at,id)>(:time,:id)`，`ORDER BY created_at ASC,id ASC LIMIT101`；联合资源和举报人展示资料，不暴露连接、对象key或会话。Audit：`ORDER BY created_at DESC,id DESC LIMIT101`，以LEFT JOIN保留actor已删除/系统事件。首页无cursor时省略tuple谓词，后续20/100条固定page size。

Tags：仅对active资源 `unnest(tags)`，非空trim+lowercase去重后排序，最多500项，再与 `Notes,Revision,Worksheets,Guides,PA` 合并；普通学生仍可筛选PA，但赋予PA权限不由查询结果决定。

## 6. 事务、锁顺序与错误映射

默认短事务 `READ COMMITTED`，Spring通过事务管理器绑定同一连接。Repository不能私自另借连接完成同一事务的另一半；checked exception须显式rollback，不在事务内吞掉审计插入失败。需要互斥的目标写操作统一锁顺序：相关 `users` 按UUID排序 → 会话校验/撤销 → `resources` 按UUID排序 → `upload_scan_jobs` → `resource_reports` 按UUID排序 → append audit。claim只有job锁、不随后锁user/resource，是单独的例外。

普通业务写入以 `FOR SHARE` 锁定actor（及必要的资源作者）；角色修改/封禁以 `FOR UPDATE`，管理员跨用户动作把actor和target按UUID排序一次获取UPDATE锁，避免反向封禁造成死锁。会话鉴权的第一次只读结果不足以授权稍后的写事务：事务内锁定actor后必须再次检查用户状态、当前role配置与会话有效性。用户/资源锁只覆盖SQL，不跨HTTP调用。

`FOR SHARE` 与修改用户非键字段所需行锁冲突，可把封禁与扫描发布串行化；`FOR KEY SHARE` 对此不足。锁语义与事务级 advisory lock 的依据见 [PostgreSQL 显式锁](https://www.postgresql.org/docs/current/explicit-locking.html)。

| 数据库结果 | 服务行为 |
| --- | --- |
| 受权限/状态限制UPDATE返回0 | 按API契约404不可见或409已不可转换；不再无条件UPDATE兜底 |
| `23505` 且constraint为resource_reports_open_unique | 409 report_already_open；其他唯一冲突不能一律冒充重复举报 |
| `23503` | 回滚；并发目标不存在映射404/409，内部关系损坏记录脱敏告警 |
| `40P01` / `40001` | 仅纯数据库幂等事务最多重试2次（带抖动）；耗尽503；不重复HTTP或签发多个会话 |
| lock/statement timeout、连接不可用 | 回滚并503；不能降级为允许操作或未扫描发布 |
| commit结果未知 | 返回可重试错误，禁止据此删除可能已被提交事务引用的snapshot/output |

## 7. 会话与用户事务

服务端先执行同源、参数与风险校验，再在共享Redis原子预留一次access token交换：key使用与其他用途隔离的 `HMAC-SHA256(SESSION_TOKEN_PEPPER,"login-exchange:v1:"+accessToken)`，不把原token写入key/value；`SET ... NX EX 3900`，同一预留期间重复提交返回409 `login_exchange_replayed`，Redis不可用返回503。预留后在事务外完成Launchpad userinfo获取与校验，整个登录交换总时限60秒，会话绝对有效期不超过3600秒，3900秒预留覆盖这一时间段。此防重不等于token终身只能用一次，也不替代身份提供方对access token时效的校验。

Redis预留与PostgreSQL不是跨库原子事务：userinfo/数据库失败、响应丢失或提交结果未知，都保留预留直到TTL，不释放让并发/重放钻空隙。客户端重新走SDK取得新token，不能无提示地自动重放旧token；预留存储中只保存固定占位值。已有Node与Java若同时接收登录交换流量，必须同时执行同一预留协议，否则不能宣称跨版本防重已经成立；验收前不得双写登录。

持久化身份只认userinfo的sub，不认浏览器上传的用户对象，也不以email合并账户。profile不存在org时使用 `personal:<sub>`；org/verified只存快照，不新增学校组织推断规则。

登录事务：锁定已有sub行（不存在时先INSERT...ON CONFLICT，由唯一键串行化）→ upsert email/name/avatar/org/verified/role但保留status → suspended时拒绝、不签发会话 → 对管理员降级先撤销全部旧会话 → INSERT新会话 → COMMIT → 事务外写Cookie或明确启用的兼容传输。禁止把配置移除管理员后仅改role却遗留有效旧管理员会话。

token为32随机字节base64url；hash为 `base64url(HMAC-SHA256(SESSION_TOKEN_PEPPER,UTF8(token)))`，无padding，与当前Node格式一致。数据库仅存hash。有效会话查询必须同时满足：

```sql
SELECT s.id AS session_id,s.user_id,s.expires_at,u.launchpad_sub,u.role,
       u.display_name,u.email,u.avatar_url,u.org
FROM sessions s JOIN users u ON u.id=s.user_id
WHERE s.token_hash=:hash AND s.revoked_at IS NULL
  AND s.expires_at>now() AND u.status='active';
```

与当前管理员配置不一致时，在独立校正事务重新锁user并检查旧role；admin→student时同事务UPDATE role、撤销全部未撤销sessions，当前请求401。提升role也由精确sub配置产生，不能由请求role参数产生。注销执行 `UPDATE sessions SET revoked_at=now() WHERE token_hash=:hash AND revoked_at IS NULL`，重复执行仍安全，然后清Cookie/兼容存储。last_seen_at若更新最多每5分钟一次，不延长expires_at。

封禁事务必须锁actor与target、拒绝自封禁、再次鉴权actor admin，再将target active→suspended、撤销target全部未撤销会话、写user.suspend审计并提交。与同一个target行的SHARE锁竞争保证：先提交封禁则后来的发布/写操作被拒绝；先发布则封禁随后提交。封禁不自动隐藏已发布资源，若需要同时撤资源须独立产品决定，不隐式改变现有规则。

## 8. 元数据、删除、举报与审核

元数据先完整验证title1—120、description<=2000、tags<=10及PA规则。仅写title/description/tags/updated_at；filename、对象、大小、作者、状态、published_at不可通过PATCH更改。目标采用最后成功写入生效，不引入version列/If-Match承诺。

```sql
UPDATE resources SET title=:title,description=:description,tags=:tags,
                     updated_at=now()
WHERE id=CAST(:id AS uuid) AND status<>'deleted'
  AND (author_id=CAST(:actor AS uuid) OR CAST(:is_admin AS boolean))
RETURNING id,status;
-- 在同一事务中，成功返回后 INSERT audit_logs(action='resource.metadata_update',...)
```

DELETE仅允许资源作者（管理员可删除本人资源）；管理员下架他人资源必须调用moderate/remove并提交必填reason，不能绕开审核理由与治理审计。DELETE的SQL须明确 `author_id=:actor`，不能复用PATCH的管理员权限OR条件。设置status=deleted、deleted_at与updated_at，保持object_key和对象本体到保留期清理，写resource.delete审计；不直接调用S3。删除后详情404，mine可显示deleted元数据。重复DELETE按API定义404，不能再变更deleted_at延后清理。

举报事务锁active资源并验证reporter非author，INSERT resource_reports；partial唯一索引保证同一人同时最多一个open，不用先查再插入作为唯一防重。可以用 `ON CONFLICT (resource_id,reporter_id) WHERE status='open' DO NOTHING RETURNING id`，无返回映射409；保留旧举报历史。

审核hide仅active→hidden；restore仅hidden→active且保留published_at，不允许restore scanning/quarantined/failed绕过扫描；remove将非deleted资源软删除，并在同一事务把该资源全部open举报resolved。hide/restore带reportId时，举报UPDATE必须同时带report.id、resource_id、status=open条件；不匹配/已关闭则跳过该举报，但管理员对资源本身的合法审核继续成功，响应resolvedReportIds只列真正更新的举报。不得更新另一个资源的举报。dismiss仅open→dismissed，不顺便隐藏资源。审核、实际关联举报处理与audit必须全部成功或全部回滚；“跳过不匹配举报”是明确定义的业务结果，不等于吞掉数据库错误。

审计metadata是allowlist（动作原因、reportId、actorRole、changedFields等），拒绝token、hash、session、连接串、object URL/预签名URL。自由文本原因最多1000字符并去除URL/token样式；原请求不可整体写入jsonb。后台查询审计也不反向暴露原数据库异常。

## 9. 上传意图与完成

### 9.1 创建意图

每个文件创建独立resource，单批1—5个、浏览器最多2个PUT。服务器验证扩展名与声明MIME配对、1..50MiB默认上限、资源元数据和PA权限。生成UUID与192位以上随机入口key `pending/<id>/<random>`，短事务插入pending；事务外生成300秒签名PUT，约束对象key、content-type、content-length与resource metadata。签名失败留下可对账的pending，API不能返回伪造uploadUrl；重复create不是幂等操作，前端只有已知未创建时才重新create。

### 9.2 complete：对象快照与原子入队

1. 只读查询所属resource。非作者404；pending之外直接返回当前状态，不重复扫描或创建新job。作者对已deleted资源重试complete可以200返回 `{id,status:"deleted"}`，这只是幂等状态回显，不开放详情、下载或重建任务。
2. pending意图须未超过1小时。事务外HEAD source，严格匹配size、MIME、resourceId且ETag存在；条件copy `If-Match:etag` 到随机的仅服务端可写snapshot；再HEAD snapshot校验相同元数据。错误保持pending，不能发布source。
3. 短事务按锁顺序重新锁user/resource并重新鉴权，确认仍pending、author未封禁、source未变、仍未过期；执行CAS与唯一入队：

```sql
WITH accepted AS (
  UPDATE resources
  SET status='scanning',object_key=:snapshot,updated_at=now()
  WHERE id=CAST(:id AS uuid) AND author_id=CAST(:actor AS uuid)
    AND status='pending' AND object_key=:source
    AND created_at>now()-interval '1 hour'
  RETURNING id
)
INSERT INTO upload_scan_jobs(resource_id,source_key,snapshot_key)
SELECT id,:source,:snapshot FROM accepted
RETURNING resource_id;
```

4. 一个事务内CAS和INSERT一起成功。job PK冲突视为不变量异常并回滚，不采用 `ON CONFLICT DO NOTHING` 后留下资源scanning却关联错误snapshot。CAS输家读取已提交现状态；同resource重试complete不会再入队。
5. 确认事务没有提交引用且数据库复核无引用时，输家snapshot在事务外清理；提交结果未知则保留snapshot，由延迟对账处理，不能在catch里无条件删除。API资源处于scanning时202，其他可见既有状态200。

## 10. 扫描任务领取、租约与结算

### 10.1 领取

保持当前全局正常并发1：短事务先尝试 `SELECT pg_try_advisory_xact_lock(1936286821)`；失败返回no work，不等待。成功后检查任何 `status='processing' AND lease_until>now()`，若有则不再领取。然后选择due queued或lease过期processing，按available_at/resource_id稳定顺序，锁job行：

```sql
SELECT j.resource_id
FROM upload_scan_jobs j
WHERE (j.status='queued' AND j.available_at<=now())
   OR (j.status='processing' AND j.lease_until<=now())
ORDER BY j.available_at,j.resource_id
LIMIT 1 FOR UPDATE SKIP LOCKED;

UPDATE upload_scan_jobs
SET status='processing',attempts=attempts+1,
    lease_token=CAST(:new_token AS uuid),
    lease_until=now()+interval '5 minutes',updated_at=now()
WHERE resource_id=CAST(:id AS uuid)
RETURNING *;
```

事务提交释放advisory lock，然后在事务外加载所需资源/作者信息并处理。不能使用session级advisory锁，因为池化连接不由单worker长期持有。`SKIP LOCKED`只为队列避免等被占行，不用于普通搜索分页的一致性；语法参考 [PostgreSQL SELECT](https://www.postgresql.org/docs/current/sql-select.html)。

### 10.2 事务外处理

HEAD不可变snapshot→扫描器→校验clean、类型与SHA-256→条件copy同snapshot到确定性输出 `active/<resourceId>/<snapshot最后段>`。扫描器error/无效响应/临时网络失败可重试；infected、类型不符、object mismatch直接隔离。最大3次领取尝试，退避30/60秒；过期任务再次领取使attempts超过3时不再发起扫描，直接进入失败结算。

外部请求有硬超时，总工作预算须短于5分钟租约；不默认实现租约续期。lease过期后旧worker仍可能有尚未返回的I/O，因此“全局1”指有效租约并发1，并非租约过期时保证物理调用绝不重叠；权限安全依靠结算栅栏。输出copy成功而事务未知时保留对象；确定性key允许恢复，不能先删对象再问事务是否成功。

### 10.3 带栅栏结算

结算短事务先锁author user（SHARE）、resource（UPDATE）、job（UPDATE）；读取job并要求resource_id、status=processing、lease_token全匹配且 `lease_until>clock_timestamp()`。这里用真实时钟检查租约，而不只用事务起始时的now；拿锁耗时不能偷偷延长有效租约。任何条件失败返回committed=false，不触碰资源、任务或对象。

```sql
SELECT resource_id,attempts,lease_token,lease_until
FROM upload_scan_jobs
WHERE resource_id=CAST(:id AS uuid) AND status='processing'
  AND lease_token=CAST(:lease AS uuid) AND lease_until>clock_timestamp()
FOR UPDATE;
```

同时检查resource仍scanning、当前object_key仍该job.snapshot_key、作者active。clean且满足条件才UPDATE resource→active，写mime_type、sha256、object_key=output、published_at、updated_at，并将job→done、清lease；不可分开提交。

重试结果且仍可发布、attempts<3时将job→queued，available_at=当前时间+退避、last_error=固定原因、清lease，resource保持scanning。永久失败/耗尽将仍scanning资源→quarantined，job→failed。resource已被删除/隐藏等不可发布时只把job→failed，不把终态资源改回scanning或覆盖deleted；作者被封禁但资源仍scanning则隔离。最终job UPDATE必须再次带原lease_token、status=processing、lease_until>clock_timestamp()；若UPDATE行数不是1则**整个结算事务回滚**，包括此前的资源UPDATE。不能先提交资源变更，再单独判断租约。这个最后检查是结算的线性化点，事务持有job锁期间新领取者不能替换租约。

author SHARE锁必须保留到提交，封禁需同author UPDATE锁；这样阻止“先读active、封禁提交、扫描再发布”的竞争。所有资源修改与job结算遵循resource→job锁顺序；领取事务只锁job不随后锁resource，不能制造循环等待。外部副本可能成为孤儿，但失效worker永远不能发布数据库资源。

## 11. 清理、对账与故障恢复

现有cleanup代码在resource事务内执行S3删除，Java目标将它改为“终态声明→事务外删除→确认”的三段流程。无需新增cleanup列：使用既有status/moderation_reason记录仅系统可写的终态原因，object_deleted_at作为完成标记。

### 11.1 资源权威对象

候选每轮最多200：pending创建超过1小时；scanning更新超过15分钟且不存在queued/processing job；deleted超过默认7天保留期。任何资源有queued/processing任务时，**即使租约过期也先保护输入**，交给worker恢复/结算，再进入清理。

第一段短事务：按资源ID锁resource→job，重新检查当前状态、截止时间、object_deleted_at为空及不存在live job（live指queued/processing）；pending→failed并设置系统原因 `cleanup_upload_expired`；无job的超时scanning→quarantined并设置 `cleanup_scan_timeout`；deleted保持deleted。提交后的failed/quarantined这两个系统清理原因也列为重试候选，避免删除失败后永远失去重试入口。普通PATCH不可修改系统原因，审核restore仅hidden→active，不能复活这两个终态。

第二段事务外：用第一段冻结的expectedObjectKey删除对象；S3不存在也视为成功。不得删除当前仍active/hidden资源的权威对象。第三段短事务：再次锁resource/job复核终态、expectedObjectKey未变、无live job，再 `UPDATE ... SET object_deleted_at=now() WHERE object_deleted_at IS NULL`。若进程在外部删除后崩溃，下轮重复DELETE后补标记；若在声明后崩溃，下轮终态候选继续处理。无论何处失败都不需要在事务内等待网络。

### 11.2 扫描副本与孤儿

job done/failed、source_deleted_at为空且终态updated_at超过15分钟后才处理source_key、snapshot_key与确定性output。锁resource/job读取当前权威key，排除任何queued/processing job引用，提交后仅删除非权威副本，再CAS标记source_deleted_at；失败保持可重试。15分钟覆盖PUT签名300秒与worker租约5分钟，并为超时/崩溃留余量。终态job不可重新入队；新上传必须新resourceId。

copy完成到入队之间崩溃会留下无job引用snapshot，失效worker也可能留下output。定期存储清单对账只处理已超过宽限期、经数据库再次确认不被resources.object_key或任何live job source/snapshot/output引用的key；未知数据库状态一律保留。bucket Lifecycle是最后兜底，必须验证不会抢先删除live重试输入或任何权威active对象。不得仅按 `pending/` 前缀年龄直接删除所有对象。

### 11.3 其他保留

oauth历史事务expires_at早于当前一天、sessions.expires_at早于当前七天时分批删除；不要清除仍有效但用户暂时不活跃的会话。业务资源使用软删除，审计/举报保留，不通过级联硬删除掩盖历史。数据库和对象存储分别备份/恢复，恢复演练需检查资源权威key、job snapshot和对象实际存在性，不能只证明SQL可恢复。

## 12. 最小权限与迁移执行规则

创建角色/授权由运维凭据执行，本文不运行它们。应用role不是表owner，无SUPERUSER/CREATEDB/CREATEROLE/BYPASSRLS，无DDL或migration journal写权限；除必要public schema USAGE之外，不授CREATE。角色名用部署时确定值，以下是权限清单而非可直接对生产执行的脚本：

| 对象 | Java应用role所需权限 |
| --- | --- |
| 数据库 / public schema | CONNECT / USAGE |
| users,sessions,resources,upload_scan_jobs,resource_reports | SELECT,INSERT,UPDATE；仅sessions允许DELETE用于到期清理 |
| oauth_login_transactions | SELECT,DELETE；目标不INSERT新的SDK登录事务 |
| audit_logs | SELECT,INSERT；无UPDATE/DELETE |
| `immutable_text_array_to_string(text[])` 等业务函数 | 必要EXECUTE；扩展/函数创建仅迁移role |
| `drizzle.__drizzle_migrations` 及迁移schema | 应用不写；兼容性检查由独立只读运维步骤完成 |

现有UUID函数无应用序列授权需求。应用可UPDATE users.role是业务所需，故DB凭据必须只在受控服务端；数据库授权本身不能替代服务的管理员与session校验。目标没有宣称已启用RLS；连接到应用的任何API都必须先鉴权再调用Repository。

迁移role是独立高权限凭据，仅CI/运维步骤注入 `DATABASE_URL_UNPOOLED`，连接数1。先在隔离数据库按journal完整执行0000—0006、校验最终结构和数据兼容，再做Node/Java双实现只读对比。禁止应用启动时自动迁移、`ddl-auto=create/update`、重新hash旧迁移文件、清空Drizzle journal或伪造Flyway baseline。上线需要记录既有journal版本、目标代码版本、备份与回滚计划；本设计阶段不创建角色、不执行GRANT、不连接生产。

## 13. 实现与验收清单

| 场景 | 必须证明的结果 |
| --- | --- |
| schema兼容 | 从空隔离库执行7个历史迁移后与字典一致；0005后无local_accounts/invites；Java无DDL副作用 |
| URL解析/TLS | percent编码密码含@/:/+、IPv6、重复参数、错误CA、错误主机名都按规则处理；日志没有凭据；生产require不静默放行 |
| 池预算 | 并发API+worker与滚动发布不过连接预算；超时后连接回收，无每请求建池 |
| JDBC类型 | enum、空text[]、Unicode标签、jsonb、bigint、微秒时间往返正确；生成列从不写入 |
| 搜索 | `%`、`_`、引号、中文/Unicode、空查询、FTS/错词命中；同分同微秒超过20条翻页无静态重漏；SET LOCAL不污染下请求 |
| cursor | 签名篡改、过期、q/type/tag/status/user切换、旧unsigned cursor均400；不同页精确保留score6与微秒 |
| 权限 | outsider看不到非active；作者/admin看非deleted；所有角色均不能下载未active；无object_key泄露 |
| PA | PA、全角ＰＡ、peer-advisor(s)、大小写/空白/标点别名均不能由学生写入；管理员写入统一PA |
| session | 已有Node HMAC会话可验证；撤销/过期/封禁立即拒绝；管理员降级原子撤销；不根据客户端profile或email取得身份 |
| 写事务 | 注入audit失败使metadata/delete/moderate/suspend回滚；普通metadata并发最后提交成功值生效，不声称乐观锁 |
| 举报 | 并发双举报只有一个open，其余409；closed后再次举报可创建；跨资源/已关闭reportId不变、合法资源审核继续成功且resolvedReportIds为空 |
| 登录防重 | 共享Redis预留TTL3900、总交换时限60秒；并发同token仅一个进入userinfo，重复409；未知提交不释放预留；无SQL新表且不夸大成token终身单次使用 |
| complete | 双请求只有一个scanning/job；HEAD mismatch/源覆盖/过期不入队；commit未知不删除可能已引用snapshot |
| worker | 双实例只有一个有效租约；过期重领旧token不能结算；3次与30/60秒退避；崩溃恢复不发布未clean文件 |
| 封禁/删除竞争 | author封禁与clean settlement按锁串行；先删资源后迟到clean不会复活；无死锁或有界重试 |
| cleanup | 与complete/worker同时运行不删live输入；S3缓慢时无长DB事务；声明/删除/确认任一点崩溃后可恢复；误删不得标记成功 |
| 日志/恢复 | 失败只记录脱敏code；不记录token/hash/URL/SQL参数；数据库+对象恢复对账演练通过 |

这些是Java实现的待验收要求，不是本次文档工作已经通过的运行测试。下一阶段先实现与隔离测试验证仓储/事务，再联调同源API，最后才评估流量切换。
