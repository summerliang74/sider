package com.sider.resources;

import com.sider.admin.AdminRepository;
import com.sider.auth.*;
import com.sider.config.DatabaseUrl;
import com.sider.web.ApiException;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.support.TransactionTemplate;
import java.net.URI;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real PostgreSQL queries/transactions. Auth lock is mocked; its session rules have separate tests. */
@EnabledIfEnvironmentVariable(named="TEST_DATABASE_URL",matches=".+")
class ResourceRepositoryIntegrationTest {
    private JdbcTemplate sql;
    private NamedParameterJdbcTemplate named;
    private TransactionTemplate tx;
    private ResourceRepository resources;
    private AdminRepository adminRepository;
    private AuthService auth;
    private CurrentUser owner,other,admin;
    private String tag;
    private final MockHttpServletRequest request=new MockHttpServletRequest();
    private final List<UUID> ids=new ArrayList<>();
    @BeforeEach void setup() {
        String url=System.getenv("TEST_DATABASE_URL"),host=System.getenv("TEST_DATABASE_HOST");
        assertNotNull(host,"TEST_DATABASE_HOST must be explicitly configured");
        URI uri=URI.create(url);assertEquals(host,uri.getHost(),"explicit test host must match");
        assertTrue(Set.of("127.0.0.1","localhost","[::1]","::1").contains(uri.getHost()),"Resource integration tests run only on loopback");
        assertTrue(uri.getPath().contains("java_test"),"Use the isolated java_test database, never the application database");
        var parsed=DatabaseUrl.parse(url,false);var ds=new DriverManagerDataSource(parsed.jdbcUrl(),parsed.username(),parsed.password());ds.setConnectionProperties(parsed.properties());
        sql=new JdbcTemplate(ds);named=new NamedParameterJdbcTemplate(ds);tx=new TransactionTemplate(new DataSourceTransactionManager(ds));
        assertTrue(sql.queryForObject("SELECT current_database()",String.class).contains("java_test"));
        assertEquals(1,sql.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='upload_scan_jobs'",Integer.class),"root must migrate isolated test schema beforehand");
        owner=user("student");other=user("student");admin=user("admin");tag="t"+UUID.randomUUID().toString().replace("-","").substring(0,20);
        auth=mock(AuthService.class);when(auth.lockCurrent(any(CurrentUser.class),any())).thenAnswer(i->i.getArgument(0));
        var json=JsonMapper.builder().build();var cursor=new CursorService("integration-signing-key-at-least-32bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8),json,Clock.systemUTC());
        var audit=new AuditWriter(named,json);resources=new ResourceRepository(named,tx,cursor,auth,audit);adminRepository=new AdminRepository(named,tx,cursor,auth,audit);
    }
    private CurrentUser user(String role) {
        UUID id=UUID.randomUUID();String display="Synthetic "+role;
        sql.update("INSERT INTO users(id,launchpad_sub,display_name,org,verified,role) VALUES (?, ?, ?, 'synthetic-integration',false,CAST(? AS user_role))",id,"test:"+id,display,role);
        return new CurrentUser(id,display,null,null,"synthetic-integration",role);
    }
    private UUID resource(CurrentUser user,String status,String title,String...tags) {
        UUID id=UUID.randomUUID();ids.add(id);
        sql.execute((org.springframework.jdbc.core.ConnectionCallback<Void>) c->{
            var array=c.createArrayOf("text",tags);
            try(var statement=c.prepareStatement("INSERT INTO resources(id,author_id,title,description,tags,original_filename,object_key,mime_type,size_bytes,status,published_at) VALUES (?,?,?,'description',?,'file.pdf',?,'application/pdf',10,CAST(? AS resource_status),TIMESTAMPTZ '2026-11-11 01:00:00.123456+00')")) {
                statement.setObject(1,id);statement.setObject(2,user.id());statement.setString(3,title);statement.setArray(4,array);statement.setString(5,"pending/"+id+"/synthetic");statement.setString(6,status);statement.executeUpdate();
            }finally{array.free();}return null;
        });return id;
    }
    @AfterEach void cleanup() {
        if(sql==null||owner==null)return;
        for(var id:ids){sql.update("DELETE FROM resource_reports WHERE resource_id=?",id);sql.update("DELETE FROM upload_scan_jobs WHERE resource_id=?",id);sql.update("DELETE FROM audit_logs WHERE target_id=?",id);sql.update("DELETE FROM resources WHERE id=?",id);}
        for(var user:java.util.stream.Stream.of(owner,other,admin).filter(Objects::nonNull).toList()){sql.update("DELETE FROM audit_logs WHERE actor_id=? OR target_id=?",user.id(),user.id());sql.update("DELETE FROM sessions WHERE user_id=?",user.id());sql.update("DELETE FROM users WHERE id=?",user.id());}
    }
    @SuppressWarnings("unchecked") private static List<Map<String,Object>> items(Map<String,Object> page){return (List<Map<String,Object>>)page.get("items");}
    @Test void keysetPreservesSameMicrosecondTiesAndQueryBinding() {
        Set<UUID> expected=new HashSet<>();for(int i=0;i<25;i++)expected.add(resource(owner,"active","Same title",tag));
        var first=resources.search(new ResourceQueries.Search("", "pdf",tag,null));assertEquals(20,items(first).size());assertNotNull(first.get("nextCursor"));
        var second=resources.search(new ResourceQueries.Search("","pdf",tag,(String)first.get("nextCursor")));assertEquals(5,items(second).size());assertNull(second.get("nextCursor"));
        Set<UUID> actual=new HashSet<>();for(var row:items(first))assertTrue(actual.add((UUID)row.get("id")));for(var row:items(second))assertTrue(actual.add((UUID)row.get("id")));assertEquals(expected,actual);
        assertThrows(ApiException.class,()->resources.search(new ResourceQueries.Search("other","pdf",tag,(String)first.get("nextCursor"))));
    }
    @SuppressWarnings("unchecked") @Test void dashboardUsesFullCountsAndPadsQuietUtcBuckets() {
        var before=(Map<String,Object>)adminRepository.dashboard("24h").get("summary");
        resource(owner,"active","Dashboard active",tag);resource(owner,"deleted","Dashboard deleted",tag);
        var data=adminRepository.dashboard("24h");var summary=(Map<String,Object>)data.get("summary");
        assertEquals(((Number)before.get("totalResources")).longValue()+1,((Number)summary.get("totalResources")).longValue());
        assertEquals(((Number)before.get("newResources")).longValue()+2,((Number)summary.get("newResources")).longValue());
        assertEquals(((Number)before.get("resourceBytes")).longValue()+10,((Number)summary.get("resourceBytes")).longValue());
        var series=(List<Map<String,Object>>)data.get("series");assertEquals(24,series.size());
        for(var row:series){assertTrue(row.get("at").toString().endsWith("Z"));assertTrue(((Number)row.get("uploads")).longValue()>=0);}
        var tags=(List<Map<String,Object>>)data.get("tags");assertTrue(tags.stream().anyMatch(row->tag.equals(row.get("label"))&&((Number)row.get("value")).longValue()==1));
        assertEquals(7,((List<?>)adminRepository.dashboard("7d").get("series")).size());
        assertEquals(30,((List<?>)adminRepository.dashboard("30d").get("series")).size());
        assertThrows(ApiException.class,()->adminRepository.dashboard("invalid"));
    }
    @Test void rankedSearchEscapesLiteralWildcardsAndRetainsStructuredHighlights() throws Exception {
        UUID wanted=resource(owner,"active","100% notes",tag);resource(owner,"active","No percent symbol",tag);
        // Reuse one actual backend connection: a fresh DriverManager connection cannot prove SET LOCAL reset.
        try(var connection=Objects.requireNonNull(sql.getDataSource()).getConnection()) {
            var dataSource=new SingleConnectionDataSource(connection,true);
            var sameSql=new JdbcTemplate(dataSource);var sameNamed=new NamedParameterJdbcTemplate(dataSource);
            var sameTx=new TransactionTemplate(new DataSourceTransactionManager(dataSource));
            var json=JsonMapper.builder().build();
            var cursor=new CursorService("integration-signing-key-at-least-32bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8),json,Clock.systemUTC());
            var sameResources=new ResourceRepository(sameNamed,sameTx,cursor,auth,new AuditWriter(sameNamed,json));
            sameSql.queryForObject("SELECT word_similarity('a','b')",Float.class); // pg_trgm GUCs register when its library loads.
            sameSql.execute("SET pg_trgm.word_similarity_threshold = 0.7");
            String threshold=sameSql.queryForObject("SHOW pg_trgm.word_similarity_threshold",String.class);
            var results=sameResources.search(new ResourceQueries.Search("%","pdf",tag,null));assertEquals(1,items(results).size());assertEquals(wanted,items(results).getFirst().get("id"));assertTrue(items(results).getFirst().containsKey("highlights"));
            var terms=sameResources.search(new ResourceQueries.Search("notes","pdf",tag,null));assertEquals(wanted,items(terms).getFirst().get("id"));
            assertEquals(threshold,sameSql.queryForObject("SHOW pg_trgm.word_similarity_threshold",String.class),"transaction-local threshold must reset before this same pooled connection is reused");
        }
    }
    @Test void ownerAdminVisibilityAndAuthorOnlyDeleteAreEnforcedInSql() {
        UUID hidden=resource(owner,"hidden","Hidden",tag),deleted=resource(owner,"deleted","Deleted",tag);
        assertThrows(ApiException.class,()->resources.detail(hidden,other));assertNotNull(resources.detail(hidden,owner));assertNotNull(resources.detail(hidden,admin));
        assertThrows(ApiException.class,()->resources.detail(deleted,owner));assertThrows(ApiException.class,()->resources.detail(deleted,admin));
        assertEquals(2,items(resources.mine(owner,"all",null)).size());assertTrue(items(resources.mine(other,"all",null)).isEmpty());
        assertThrows(ApiException.class,()->resources.delete(hidden,admin,request));assertEquals("hidden",sql.queryForObject("SELECT status::text FROM resources WHERE id=?",String.class,hidden));
        assertEquals("deleted",resources.delete(hidden,owner,request).get("status"));assertEquals(1,sql.queryForObject("SELECT count(*) FROM audit_logs WHERE target_id=? AND action='resource.delete'",Integer.class,hidden));
    }
    @Test void storedPaAliasesAndMineGroupsAreFilteredBeforePaging() {
        resource(owner,"active","Legacy reserved alias",tag,"ＰＡ");resource(owner,"hidden","Hidden reserved alias",tag,"peer advisors");
        resource(owner,"pending","Pending",tag);resource(owner,"scanning","Scanning",tag);resource(owner,"failed","Failed",tag);resource(owner,"deleted","Deleted",tag);
        assertEquals(2,items(resources.mine(owner,"scanning",null)).size());assertEquals(3,items(resources.mine(owner,"unavailable",null)).size());
        var aliases=resources.search(new ResourceQueries.Search("","pdf","peer-advisors",null));
        assertTrue(items(aliases).stream().anyMatch(row->row.get("title").equals("Legacy reserved alias")));
        assertTrue(items(aliases).stream().noneMatch(row->row.get("title").equals("Hidden reserved alias")));
        assertTrue(((List<?>)resources.tags().get("tags")).contains("PA"));
    }
    @Test void mineWorkspaceTakesNewestHundredBeforeClientStatusFiltering() {
        List<UUID> ordered=new ArrayList<>();var start=OffsetDateTime.parse("2026-01-01T00:00:00Z");
        tx.executeWithoutResult(ignored->{
            for(int i=0;i<105;i++){
                String status=i<5?"scanning":List.of("active","pending","hidden","deleted").get(i%4);
                UUID id=resource(owner,status,"Workspace "+i,tag);ordered.add(id);
                sql.update("UPDATE resources SET created_at=? WHERE id=?",start.plusSeconds(i),id);
            }
            resource(other,"active","Another author's resource",tag);
        });
        var workspace=resources.mine(owner,"all",null,true);var rows=items(workspace);
        List<UUID> expected=new ArrayList<>(ordered.subList(5,105));Collections.reverse(expected);
        assertEquals(expected,rows.stream().map(row->(UUID)row.get("id")).toList());assertNull(workspace.get("nextCursor"));
        assertEquals(Set.of("active","pending","hidden","deleted"),rows.stream().map(row->row.get("status")).collect(java.util.stream.Collectors.toSet()));
        var scanningFirst=resources.mine(owner,"scanning",null);assertEquals(20,items(scanningFirst).size());assertNotNull(scanningFirst.get("nextCursor"));
        var scanningSecond=resources.mine(owner,"scanning",(String)scanningFirst.get("nextCursor"));assertEquals(10,items(scanningSecond).size());assertNull(scanningSecond.get("nextCursor"));
        assertEquals(new HashSet<>(ordered.subList(0,5)),items(scanningSecond).stream().filter(row->row.get("status").equals("scanning")).map(row->(UUID)row.get("id")).collect(java.util.stream.Collectors.toSet()),"default status paging includes the five older scanning rows outside the workspace window, alongside 25 pending rows");
        assertEquals(20,items(resources.mine(owner,"all",null)).size());assertNotNull(resources.mine(owner,"all",null).get("nextCursor"));
        assertThrows(ApiException.class,()->resources.mine(owner,"scanning",null,true));
        assertThrows(ApiException.class,()->resources.mine(owner,"all","",true));
    }
    @Test void reportsWorkspaceTakesOnlyTheOldestHundredOpenReports() {
        List<UUID> ordered=new ArrayList<>();var start=OffsetDateTime.parse("1900-01-01T00:00:00Z");
        tx.executeWithoutResult(ignored->{
            for(int i=0;i<105;i++){
                UUID resource=resource(owner,"active","Reported workspace "+i,tag),report=UUID.randomUUID();ordered.add(report);
                sql.update("INSERT INTO resource_reports(id,resource_id,reporter_id,reason,created_at) VALUES (?,?,?,'spam',?)",report,resource,other.id(),start.plusSeconds(i));
                if(i==0)sql.update("INSERT INTO resource_reports(resource_id,reporter_id,reason,status,created_at) VALUES (?,?, 'spam','dismissed',?)",resource,other.id(),start.minusSeconds(1));
            }
        });
        var workspace=adminRepository.reports(admin,"open",null,true);
        @SuppressWarnings("unchecked") var rows=(List<Map<String,Object>>)workspace.get("reports");
        assertEquals(ordered.subList(0,100),rows.stream().map(row->(UUID)row.get("id")).toList());assertNull(workspace.get("nextCursor"));
        assertTrue(rows.stream().allMatch(row->row.get("status").equals("open")));
        assertNotNull(adminRepository.reports(admin,"open",null).get("nextCursor"),"default report paging remains available");
        assertThrows(ApiException.class,()->adminRepository.reports(admin,"resolved",null,true));
        assertThrows(ApiException.class,()->adminRepository.reports(admin,"open","",true));
    }
    @Test void auditWorkspaceTakesTheNewestTwoHundredAndNeverReturnsACursor() {
        List<UUID> ordered=new ArrayList<>();var start=OffsetDateTime.now(ZoneOffset.UTC).plusDays(1);
        tx.executeWithoutResult(ignored->{
            for(int i=0;i<205;i++){
                UUID id=UUID.randomUUID();ordered.add(id);
                sql.update("INSERT INTO audit_logs(id,actor_id,action,target_type,target_id,metadata,created_at) VALUES (?,?,'resource.delete','resource',?,'{}'::jsonb,?)",id,admin.id(),owner.id(),start.plusSeconds(i));
            }
        });
        var workspace=adminRepository.audit(admin,null,true);List<UUID> expected=new ArrayList<>(ordered.subList(5,205));Collections.reverse(expected);
        assertEquals(expected,items(workspace).stream().map(row->(UUID)row.get("id")).toList());assertNull(workspace.get("nextCursor"));
        var paged=adminRepository.audit(admin,null);assertEquals(100,items(paged).size());assertNotNull(paged.get("nextCursor"));
        assertThrows(ApiException.class,()->adminRepository.audit(admin,"",true));
    }
    @Test void metadataArraysAndAuditShareOneRollbackBoundary() {
        UUID id=resource(owner,"active","Original",tag);
        var metadata=ResourcePolicy.validate("Changed","New description",List.of("Notes","Revision"),owner);
        resources.update(id,owner,request,metadata);assertEquals("Changed",sql.queryForObject("SELECT title FROM resources WHERE id=?",String.class,id));
        assertEquals(2,sql.queryForObject("SELECT cardinality(tags) FROM resources WHERE id=?",Integer.class,id));
        var failingAudit=mock(AuditWriter.class);doThrow(new IllegalStateException("synthetic audit failure")).when(failingAudit).append(any(),any(),any(),any(),any());
        var json=JsonMapper.builder().build();var cursors=new CursorService("integration-signing-key-at-least-32bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8),json,Clock.systemUTC());
        var failing=new ResourceRepository(named,tx,cursors,auth,failingAudit);
        assertThrows(IllegalStateException.class,()->failing.update(id,owner,request,ResourcePolicy.validate("Must rollback","",List.of(),owner)));
        assertEquals("Changed",sql.queryForObject("SELECT title FROM resources WHERE id=?",String.class,id));
    }
    @Test void reportsRespectUniquenessAndModerationDoesNotTouchUnrelatedReport() {
        UUID first=resource(owner,"active","First",tag),second=resource(owner,"active","Second",tag);
        @SuppressWarnings("unchecked") UUID report=(UUID)((Map<String,Object>)resources.report(second,other,request,"spam","").get("report")).get("id");
        var error=assertThrows(ApiException.class,()->resources.report(second,other,request,"spam",""));assertEquals("report_already_open",error.code());
        assertThrows(ApiException.class,()->resources.report(first,owner,request,"spam",""));
        var result=adminRepository.moderate(first,admin,request,"hide","Review",report);assertEquals(List.of(),result.get("resolvedReportIds"));
        assertEquals("open",sql.queryForObject("SELECT status::text FROM resource_reports WHERE id=?",String.class,report));
        assertEquals("active",adminRepository.moderate(first,admin,request,"restore","Restored",null).get("status"));
        var removed=adminRepository.moderate(second,admin,request,"remove","Removed",null);assertEquals(List.of(report),removed.get("resolvedReportIds"));
        assertEquals("resolved",sql.queryForObject("SELECT status::text FROM resource_reports WHERE id=?",String.class,report));
        assertEquals(1,((List<?>)adminRepository.reports(admin,"resolved",null).get("reports")).size());
    }
    @Test void concurrentReportsHaveExactlyOneOpenWinner() throws Exception {
        UUID id=resource(owner,"active","Concurrent report",tag);
        var start=new java.util.concurrent.CountDownLatch(1);
        try(var executor=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<Integer> submit=()->{start.await();try{resources.report(id,other,new MockHttpServletRequest(),"spam","");return 201;}catch(ApiException error){return error.status();}};
            var one=executor.submit(submit);var two=executor.submit(submit);start.countDown();
            var results=new ArrayList<>(List.of(one.get(10,java.util.concurrent.TimeUnit.SECONDS),two.get(10,java.util.concurrent.TimeUnit.SECONDS)));results.sort(Integer::compareTo);
            assertEquals(List.of(201,409),results);
            assertEquals(1,sql.queryForObject("SELECT count(*) FROM resource_reports WHERE resource_id=? AND status='open'",Integer.class,id));
        }
    }
    @Test void moderationAndAllReportResolutionsRollbackIfAuditFails() {
        UUID id=resource(owner,"active","Keep original state",tag);resources.report(id,other,request,"spam","");
        var failingAudit=mock(AuditWriter.class);doThrow(new IllegalStateException("synthetic audit failure")).when(failingAudit).append(any(),any(),any(),any(),any());
        var cursor=new CursorService("integration-signing-key-at-least-32bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8),JsonMapper.builder().build(),Clock.systemUTC());
        var failed=new AdminRepository(named,tx,cursor,auth,failingAudit);
        assertThrows(IllegalStateException.class,()->failed.moderate(id,admin,request,"remove","Must rollback",null));
        assertEquals("active",sql.queryForObject("SELECT status::text FROM resources WHERE id=?",String.class,id));
        assertEquals(1,sql.queryForObject("SELECT count(*) FROM resource_reports WHERE resource_id=? AND status='open'",Integer.class,id));
        assertEquals(0,sql.queryForObject("SELECT count(*) FROM audit_logs WHERE target_id=?",Integer.class,id));
    }
    @Test void suspensionRevokesEverySessionButCannotSuspendSelf() {
        sql.update("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES (?, ?,now()+interval '1 hour')",owner.id(),"synthetic:"+UUID.randomUUID());
        assertEquals("suspended",adminRepository.suspend(owner.id(),admin,request,"Test").get("status"));
        assertEquals(0,sql.queryForObject("SELECT count(*) FROM sessions WHERE user_id=? AND revoked_at IS NULL",Integer.class,owner.id()));
        assertEquals("cannot_suspend_self",assertThrows(ApiException.class,()->adminRepository.suspend(admin.id(),admin,request,"Test")).code());
    }
}
