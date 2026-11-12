package com.sider.uploads;

import com.sider.auth.AuthService;
import com.sider.auth.CurrentUser;
import com.sider.config.DatabaseUrl;
import com.sider.config.SiderConfig;
import com.sider.security.Credentials;
import com.sider.web.ApiException;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Real PostgreSQL/auth/transactions; the storage/scanner boundaries are synthetic.
 * No DDL, no production fallback, and no real file/scanner/provider traffic.
 */
@EnabledIfEnvironmentVariable(named="TEST_DATABASE_URL", matches=".+")
class UploadFlowIntegrationTest {
    private static final String MIME = "application/pdf";
    private static final String HASH = "ab".repeat(32);
    private static final long SIZE = 1024;
    private static final String PEPPER = "upload-integration-pepper-at-least-32bytes";
    private final List<UUID> ids = new ArrayList<>();
    private final Map<String, ObjectStore.Head> objects = new ConcurrentHashMap<>();
    private JdbcTemplate sql;
    private TransactionTemplate tx;
    private ObjectStore store;
    private ScannerClient scanner;
    private UploadService uploads;
    private ScanWorker worker;
    private CleanupService cleanup;
    private CurrentUser user;
    private String token;
    private AuthService auth;

    @BeforeEach void setup() {
        String url = System.getenv("TEST_DATABASE_URL");
        String expectedHost = System.getenv("TEST_DATABASE_HOST");
        assertNotNull(expectedHost, "Explicit TEST_DATABASE_HOST is mandatory");
        URI uri = URI.create(url);
        assertEquals(expectedHost, uri.getHost(), "Test host must exactly match the supplied guard");
        assertTrue(Set.of("127.0.0.1", "localhost", "[::1]", "::1").contains(uri.getHost()), "Upload integration tests run only on loopback");
        assertTrue(uri.getPath().contains("java_test"), "Use the isolated java_test database, never the application database");
        DatabaseUrl parsed = DatabaseUrl.parse(url, false);
        DriverManagerDataSource ds = new DriverManagerDataSource(parsed.jdbcUrl(), parsed.username(), parsed.password());
        ds.setConnectionProperties(parsed.properties());
        sql = new JdbcTemplate(ds);
        assertTrue(sql.queryForObject("SELECT current_database()", String.class).contains("java_test"));
        assertEquals(1, sql.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='upload_scan_jobs'", Integer.class), "Apply historical migrations to the isolated database before running this test");
        tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
        tx.setTimeout(10);
        SiderConfig config = new SiderConfig(new MockEnvironment()
                .withProperty("APP_BASE_URL", "https://synthetic-upload.school.test")
                .withProperty("SHSID_ADMIN_SUBS", "not-the-synthetic-student")
                .withProperty("SESSION_TRANSPORT", "cookie")
                .withProperty("SESSION_TOKEN_PEPPER", PEPPER)
                .withProperty("MALWARE_SCAN_URL", "https://synthetic-scanner.school.test/scan")
                .withProperty("UPLOAD_MAX_BYTES", "52428800"));
        auth = new AuthService(new NamedParameterJdbcTemplate(ds), tx, config);
        UUID userId = UUID.randomUUID();
        sql.update("INSERT INTO users(id,launchpad_sub,display_name,org,verified) VALUES (?,?,'Synthetic upload student','synthetic-integration',false)", userId, "java-upload-test:" + userId);
        user = new CurrentUser(userId, "Synthetic upload student", null, null, "synthetic-integration", "student");
        token = Credentials.randomToken();
        sql.update("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES (?,?,now()+interval '1 hour')", userId, Credentials.hmac(token, PEPPER));
        store = mock(ObjectStore.class);
        scanner = mock(ScannerClient.class);
        when(store.head(anyString())).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(), "Storage HEAD cannot hold a DB transaction");
            ObjectStore.Head head = objects.get(call.getArgument(0));
            if (head == null) throw new ApiException(409, "object_missing");
            return head;
        });
        doAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(), "Storage COPY cannot hold a DB transaction");
            String source = call.getArgument(0), target = call.getArgument(1), etag = call.getArgument(2);
            ObjectStore.Head head = objects.get(source);
            if (head == null || !head.etag().equals(etag)) throw new ApiException(409, "object_mismatch");
            objects.put(target, head);
            return null;
        }).when(store).copy(anyString(), anyString(), anyString());
        doAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(), "Storage DELETE cannot hold a DB transaction");
            objects.remove(call.getArgument(0));
            return null;
        }).when(store).delete(anyString());
        when(scanner.scan(any(), anyString())).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(), "Scanner I/O must be outside transactions");
            return new ScannerClient.Result("clean", MIME, HASH);
        });
        uploads = new UploadService(sql, tx, store, auth, config);
        worker = new ScanWorker(sql, tx, store, scanner, uploads, config);
        cleanup = new CleanupService(sql, tx, store, config);
    }

    private MockHttpServletRequest request() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("shsid_session", token));
        return request;
    }
    private UUID pending() {
        UUID id = UUID.randomUUID();
        ids.add(id);
        String key = "pending/" + id + "/synthetic-ingress";
        sql.update("INSERT INTO resources(id,author_id,title,original_filename,object_key,mime_type,size_bytes) VALUES (?,?,'Synthetic upload','file.pdf',?,?,?)", id, user.id(), key, MIME, SIZE);
        objects.put(key, new ObjectStore.Head(SIZE, MIME, id.toString(), "\"synthetic-etag\""));
        return id;
    }
    private UUID enqueued() {
        UUID id = pending();
        assertEquals("scanning", uploads.complete(user, request(), id).get("status"));
        return id;
    }
    private String value(UUID id, String expression) {
        // Expressions are constant test code, never user-controlled or supplied through env.
        return sql.queryForObject("SELECT " + expression + " FROM resources WHERE id=?", String.class, id);
    }
    private String job(UUID id, String expression) {
        return sql.queryForObject("SELECT " + expression + " FROM upload_scan_jobs WHERE resource_id=?", String.class, id);
    }
    private void due(UUID id) { sql.update("UPDATE upload_scan_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE resource_id=?", id); }
    private void assertQuarantined(UUID id) {
        assertEquals("quarantined", value(id,"status::text"));
        assertEquals("failed", job(id,"status"));
        assertNull(value(id,"sha256"));
        assertNull(value(id,"published_at::text"));
    }

    @AfterEach void removeSyntheticRows() {
        if (sql == null || user == null) return;
        for (UUID id : ids) {
            sql.update("DELETE FROM resource_reports WHERE resource_id=?", id);
            sql.update("DELETE FROM upload_scan_jobs WHERE resource_id=?", id);
            sql.update("DELETE FROM audit_logs WHERE target_id=?", id);
            sql.update("DELETE FROM resources WHERE id=? AND author_id=?", id, user.id());
        }
        sql.update("DELETE FROM audit_logs WHERE actor_id=? OR target_id=?", user.id(), user.id());
        sql.update("DELETE FROM sessions WHERE user_id=?", user.id());
        sql.update("DELETE FROM users WHERE id=? AND launchpad_sub=?", user.id(), "java-upload-test:" + user.id());
    }

    @Test void concurrentCompletionEnqueuesOneImmutableSnapshotAndRepeatedCompletionIsSafe() throws Exception {
        UUID id = pending();
        String source = value(id,"object_key");
        CyclicBarrier bothHeads = new CyclicBarrier(2);
        when(store.head(source)).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            bothHeads.await(5, TimeUnit.SECONDS);
            return objects.get(source);
        });
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<Map<String,Object>> complete = () -> { start.await(); return uploads.complete(user, request(), id); };
            var first = pool.submit(complete); var second = pool.submit(complete); start.countDown();
            assertEquals("scanning", first.get(10,TimeUnit.SECONDS).get("status"));
            assertEquals("scanning", second.get(10,TimeUnit.SECONDS).get("status"));
        }
        assertEquals(1, sql.queryForObject("SELECT count(*) FROM upload_scan_jobs WHERE resource_id=?",Integer.class,id));
        String snapshot = value(id,"object_key");
        assertNotEquals(source,snapshot);
        assertTrue(snapshot.startsWith("pending/" + id + "/snapshot-"));
        assertEquals(snapshot,job(id,"snapshot_key"));
        assertEquals(source,job(id,"source_key"));
        assertEquals("scanning",uploads.complete(user,request(),id).get("status"));
        // Ingress can change while signed PUT is live; scanning sees only frozen copy.
        objects.put(source,new ObjectStore.Head(SIZE+1,MIME,id.toString(),"\"overwritten-etag\""));
        assertEquals(Map.of("processed",true,"committed",true),worker.processOne());
        verify(scanner).scan(id,snapshot);
        verify(scanner,never()).scan(id,source);
        assertEquals("active",value(id,"status::text"));
        assertEquals(FilePolicy.outputKey(id,snapshot),value(id,"object_key"));
        assertEquals(HASH,value(id,"sha256"));
        assertNotNull(value(id,"published_at::text"));
        assertEquals("done",job(id,"status"));
        assertEquals("active",uploads.complete(user,request(),id).get("status"));
        assertEquals(1,sql.queryForObject("SELECT attempts FROM upload_scan_jobs WHERE resource_id=?",Integer.class,id));
    }

    @Test void sizeMismatchNeverCreatesSnapshotOrJob() {
        UUID id = pending(); String source = value(id,"object_key");
        objects.put(source,new ObjectStore.Head(SIZE+1,MIME,id.toString(),"\"wrong-length\""));
        ApiException failure=assertThrows(ApiException.class,()->uploads.complete(user,request(),id));
        assertEquals(409,failure.status());assertEquals("object_mismatch",failure.code());
        assertEquals("pending",value(id,"status::text"));
        assertEquals(0,sql.queryForObject("SELECT count(*) FROM upload_scan_jobs WHERE resource_id=?",Integer.class,id));
        verify(store,never()).copy(anyString(),anyString(),anyString());
    }

    @Test void infectedAndDetectedTypeMismatchAreQuarantinedWithoutPublishing() {
        UUID infected=enqueued();String infectedSnapshot=value(infected,"object_key");
        when(scanner.scan(infected,infectedSnapshot)).thenReturn(new ScannerClient.Result("infected",null,null));
        assertEquals(true,worker.processOne().get("committed"));assertQuarantined(infected);
        assertEquals("malware_detected",value(infected,"moderation_reason"));
        UUID mismatch=enqueued();String wrongSnapshot=value(mismatch,"object_key");
        when(scanner.scan(mismatch,wrongSnapshot)).thenReturn(new ScannerClient.Result("clean","image/png",HASH));
        assertEquals(true,worker.processOne().get("committed"));assertQuarantined(mismatch);
        assertEquals("file_type_mismatch",value(mismatch,"moderation_reason"));
        verify(store,never()).copy(eq(infectedSnapshot),startsWith("active/"),anyString());
        verify(store,never()).copy(eq(wrongSnapshot),startsWith("active/"),anyString());
    }

    @Test void transientFailureBacksOffThirtyThenSixtySecondsAndStopsAtThreeAttempts() {
        UUID id=enqueued();String snapshot=value(id,"object_key");
        when(scanner.scan(id,snapshot)).thenReturn(new ScannerClient.Result("error",null,null));
        assertEquals(true,worker.processOne().get("committed"));
        assertEquals("queued",job(id,"status"));assertEquals("scanning",value(id,"status::text"));
        Double firstDelay=sql.queryForObject("SELECT extract(epoch FROM available_at-clock_timestamp()) FROM upload_scan_jobs WHERE resource_id=?",Double.class,id);
        assertTrue(firstDelay>20&&firstDelay<=30,"first retry is scheduled thirty seconds later");
        assertEquals(false,worker.processOne().get("processed"));
        due(id);worker.processOne();
        Double secondDelay=sql.queryForObject("SELECT extract(epoch FROM available_at-clock_timestamp()) FROM upload_scan_jobs WHERE resource_id=?",Double.class,id);
        assertTrue(secondDelay>50&&secondDelay<=60,"second retry is scheduled sixty seconds later");
        due(id);worker.processOne();assertQuarantined(id);
        assertEquals(3,sql.queryForObject("SELECT attempts FROM upload_scan_jobs WHERE resource_id=?",Integer.class,id));
        verify(scanner,times(3)).scan(id,snapshot);
        assertEquals(false,worker.processOne().get("processed"));
    }

    @Test void changedLeaseTokenFencesOldWorkerAndExpiredLeaseCanBeRecovered() {
        UUID id=enqueued();String snapshot=value(id,"object_key");UUID newerToken=UUID.randomUUID();
        when(scanner.scan(id,snapshot)).thenAnswer(call->{
            sql.update("UPDATE upload_scan_jobs SET lease_token=? WHERE resource_id=?",newerToken,id);
            return new ScannerClient.Result("clean",MIME,HASH);
        });
        assertEquals(Map.of("processed",true,"committed",false),worker.processOne());
        assertEquals("scanning",value(id,"status::text"));assertNull(value(id,"sha256"));
        assertEquals(newerToken.toString(),job(id,"lease_token::text"));
        sql.update("UPDATE upload_scan_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE resource_id=?",id);
        when(scanner.scan(id,snapshot)).thenReturn(new ScannerClient.Result("clean",MIME,HASH));
        assertEquals(Map.of("processed",true,"committed",true),worker.processOne());
        assertEquals("active",value(id,"status::text"));assertEquals("done",job(id,"status"));
        assertEquals(2,sql.queryForObject("SELECT attempts FROM upload_scan_jobs WHERE resource_id=?",Integer.class,id));
    }

    @Test void leaseExpiringDuringScanPreventsPublicationUntilFreshAttempt() {
        UUID id=enqueued();String snapshot=value(id,"object_key");
        when(scanner.scan(id,snapshot)).thenAnswer(call->{
            sql.update("UPDATE upload_scan_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE resource_id=?",id);
            return new ScannerClient.Result("clean",MIME,HASH);
        });
        assertEquals(Map.of("processed",true,"committed",false),worker.processOne());
        assertEquals("scanning",value(id,"status::text"));assertNull(value(id,"published_at::text"));
        when(scanner.scan(id,snapshot)).thenReturn(new ScannerClient.Result("clean",MIME,HASH));
        assertEquals(true,worker.processOne().get("committed"));assertEquals("active",value(id,"status::text"));
    }

    @Test void deletionDuringScanCannotBeResurrectedByCleanResult() {
        UUID id=enqueued();String snapshot=value(id,"object_key");
        when(scanner.scan(id,snapshot)).thenAnswer(call->{
            sql.update("UPDATE resources SET status='deleted',deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=?",id);
            return new ScannerClient.Result("clean",MIME,HASH);
        });
        worker.processOne();assertEquals("deleted",value(id,"status::text"));
        assertEquals("failed",job(id,"status"));assertNull(value(id,"published_at::text"));assertNull(value(id,"sha256"));
        assertEquals("deleted",uploads.complete(user,request(),id).get("status"));
    }

    @Test void authorSuspensionDuringScanQuarantinesInsteadOfPublishing() {
        UUID id=enqueued();String snapshot=value(id,"object_key");
        when(scanner.scan(id,snapshot)).thenAnswer(call->{
            sql.update("UPDATE users SET status='suspended' WHERE id=?",user.id());
            sql.update("UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=?",user.id());
            return new ScannerClient.Result("clean",MIME,HASH);
        });
        worker.processOne();assertQuarantined(id);
        assertEquals("upload_cancelled",value(id,"moderation_reason"));
        assertThrows(ApiException.class,()->auth.require(request()),"real session now rejects the suspended author");
    }

    @Test void alreadySuspendedAuthorIsRejectedBeforeStorageOrScannerIo() {
        UUID id=enqueued();
        sql.update("UPDATE users SET status='suspended' WHERE id=?",user.id());
        clearInvocations(store,scanner);
        worker.processOne();
        assertQuarantined(id);
        verifyNoInteractions(store,scanner);
    }

    @Test void cleanupProtectsLiveJobInputEvenWhenOldOrLeaseExpired() {
        UUID id=enqueued();String source=job(id,"source_key"),snapshot=value(id,"object_key");
        sql.update("UPDATE resources SET updated_at=clock_timestamp()-interval '2 hours' WHERE id=?",id);
        cleanup.cleanup();
        assertEquals("scanning",value(id,"status::text"));assertNull(value(id,"object_deleted_at::text"));
        verify(store,never()).delete(source);verify(store,never()).delete(snapshot);
        sql.update("UPDATE upload_scan_jobs SET status='processing',lease_token=?,lease_until=clock_timestamp()-interval '1 hour' WHERE resource_id=?",UUID.randomUUID(),id);
        cleanup.cleanup();
        assertEquals("scanning",value(id,"status::text"));assertNull(value(id,"object_deleted_at::text"));
        verify(store,never()).delete(source);verify(store,never()).delete(snapshot);
    }

    @Test void cleanupRetiresExpiredPendingBeforeNetworkDeleteAndRetriesFailedDelete() {
        UUID id=pending();String source=value(id,"object_key");
        sql.update("UPDATE resources SET created_at=clock_timestamp()-interval '2 hours' WHERE id=?",id);
        AtomicInteger calls=new AtomicInteger();
        doAnswer(call->{
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            assertEquals("failed",value(id,"status::text"),"retirement must commit before object I/O");
            if(calls.incrementAndGet()==1)throw new ApiException(503,"synthetic_storage_failure");
            objects.remove(source);return null;
        }).when(store).delete(source);
        cleanup.cleanup();
        assertEquals("cleanup_upload_expired",value(id,"moderation_reason"));assertNull(value(id,"object_deleted_at::text"));
        assertTrue(objects.containsKey(source));
        assertEquals(1,cleanup.cleanup().get("cleaned"));
        assertNotNull(value(id,"object_deleted_at::text"));assertFalse(objects.containsKey(source));
        cleanup.cleanup();verify(store,times(2)).delete(source);
        assertEquals(0,sql.queryForObject("SELECT count(*) FROM upload_scan_jobs WHERE resource_id=?",Integer.class,id));
    }

    @Test void orphanInventoryDeletesOnlyOldValidUnreferencedObjectsAndProtectsEveryDatabaseReference() {
        UUID freshResource=pending(),liveJob=enqueued();
        String resourceKey=value(freshResource,"object_key");
        String source=job(liveJob,"source_key"),snapshot=job(liveJob,"snapshot_key");
        String output=FilePolicy.outputKey(liveJob,snapshot);
        String oldPending="pending/"+UUID.randomUUID()+"/orphan-ingress";
        String oldActive="active/"+UUID.randomUUID()+"/snapshot-orphan";
        String newPending="pending/"+UUID.randomUUID()+"/new-orphan";
        String malformed="pending/not-a-uuid/unknown-layout";
        String uuidLikeMalformed="pending/"+"-".repeat(36)+"/unknown-layout";
        Instant old=Instant.now().minusSeconds(1800),fresh=Instant.now();
        List<ObjectStore.Key> pendingInventory=List.of(
                new ObjectStore.Key(oldPending,old),new ObjectStore.Key(newPending,fresh),
                new ObjectStore.Key(resourceKey,old),new ObjectStore.Key(source,old),
                new ObjectStore.Key(snapshot,old),new ObjectStore.Key(malformed,old),
                new ObjectStore.Key(uuidLikeMalformed,old));
        List<ObjectStore.Key> activeInventory=List.of(new ObjectStore.Key(oldActive,old),new ObjectStore.Key(output,old));
        for(String key:List.of(oldPending,oldActive,newPending,resourceKey,source,snapshot,output,malformed,uuidLikeMalformed))
            objects.putIfAbsent(key,new ObjectStore.Head(SIZE,MIME,UUID.randomUUID().toString(),"\"synthetic-inventory-etag\""));
        when(store.list(anyString(),nullable(String.class))).thenAnswer(call->{
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(),"Inventory I/O must not hold DB transactions");
            assertNull(call.getArgument(1),"First bounded inventory pass starts with no continuation");
            return switch((String)call.getArgument(0)) {
                case "pending/" -> new ObjectStore.Page(pendingInventory,"next-pending-page");
                case "active/" -> new ObjectStore.Page(activeInventory,"next-active-page");
                default -> throw new AssertionError("Unexpected inventory prefix");
            };
        });
        clearInvocations(store,scanner);
        cleanup.cleanup();
        // Fresh rows and queued job avoid the separate expiry/terminal-copy paths.
        assertEquals("pending",value(freshResource,"status::text"));
        assertEquals("scanning",value(liveJob,"status::text"));
        assertEquals("queued",job(liveJob,"status"));
        assertEquals(resourceKey,value(freshResource,"object_key"));
        assertEquals(source,job(liveJob,"source_key"));assertEquals(snapshot,job(liveJob,"snapshot_key"));
        assertNull(value(freshResource,"object_deleted_at::text"));assertNull(value(liveJob,"object_deleted_at::text"));
        org.mockito.ArgumentCaptor<String> deleted=org.mockito.ArgumentCaptor.forClass(String.class);
        verify(store,times(2)).delete(deleted.capture());
        assertEquals(Set.of(oldPending,oldActive),Set.copyOf(deleted.getAllValues()));
        assertFalse(objects.containsKey(oldPending));assertFalse(objects.containsKey(oldActive));
        for(String protectedKey:List.of(newPending,resourceKey,source,snapshot,output,malformed,uuidLikeMalformed)) {
            assertTrue(objects.containsKey(protectedKey),"Keep new, referenced or malformed object: "+protectedKey);
            verify(store,never()).delete(protectedKey);
        }
        verify(store).list("pending/",null);verify(store).list("active/",null);
        verify(store,times(2)).list(anyString(),nullable(String.class));
        verifyNoInteractions(scanner);
    }
}
