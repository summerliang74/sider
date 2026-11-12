package com.sider.uploads;

import com.sider.config.SiderConfig;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class CleanupService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ObjectStore store;
    private final SiderConfig env;
    private final Map<String,String> inventoryCursors=new HashMap<>();
    public CleanupService(JdbcTemplate jdbc,TransactionTemplate tx,ObjectStore store,SiderConfig env){this.jdbc=jdbc;this.tx=tx;this.store=store;this.env=env;}
    @Scheduled(fixedDelay=900000,initialDelay=900000) public void tick(){
        if(!env.flag("UPLOAD_WORKER_ENABLED",true))return;
        try{cleanup();}catch(Exception e){org.slf4j.LoggerFactory.getLogger(CleanupService.class).warn("cleanup_unavailable");}
    }
    public Map<String,Object> cleanup(){
        int days=env.number("RESOURCE_DELETE_RETENTION_DAYS",7);
        String eligible="object_deleted_at IS NULL AND ("+
            "(status='pending' AND created_at<now()-interval '1 hour') OR "+
            "(status='scanning' AND updated_at<now()-interval '15 minutes') OR "+
            "(status='deleted' AND deleted_at<now()-(? * interval '1 day')) OR "+
            "(status IN ('failed','quarantined') AND moderation_reason IN ('cleanup_upload_expired','cleanup_scan_timeout'))) "+
            "AND NOT EXISTS(SELECT 1 FROM upload_scan_jobs j WHERE j.resource_id=resources.id AND j.status IN ('queued','processing'))";
        var ids=jdbc.queryForList("SELECT id FROM resources WHERE "+eligible+" ORDER BY id LIMIT 200",UUID.class,days);
        int cleaned=0;
        for(UUID id:ids)try{
            String key=tx.execute(s->{
                var rows=jdbc.queryForList("SELECT object_key,status FROM resources WHERE id=? AND "+eligible+" FOR UPDATE",id,days);
                if(rows.isEmpty())return null;
                var r=rows.getFirst();String status=(String)r.get("status");
                if(status.equals("pending"))jdbc.update("UPDATE resources SET status='failed',moderation_reason='cleanup_upload_expired',updated_at=now() WHERE id=?",id);
                if(status.equals("scanning"))jdbc.update("UPDATE resources SET status='quarantined',moderation_reason='cleanup_scan_timeout',updated_at=now() WHERE id=?",id);
                return (String)r.get("object_key");
            });
            if(key==null)continue;
            store.delete(key);
            cleaned+=jdbc.update("UPDATE resources SET object_deleted_at=now() WHERE id=? AND object_key=? AND object_deleted_at IS NULL AND status IN ('deleted','failed','quarantined') AND NOT EXISTS(SELECT 1 FROM upload_scan_jobs j WHERE j.resource_id=resources.id AND j.status IN ('queued','processing'))",id,key);
        }catch(Exception e){/* Retired rows stay eligible after network/commit failure. */}
        int artifacts=0;
        var finished=jdbc.queryForList("SELECT resource_id FROM upload_scan_jobs WHERE status IN ('done','failed') AND source_deleted_at IS NULL AND updated_at<now()-interval '15 minutes' ORDER BY resource_id LIMIT 200",UUID.class);
        for(UUID id:finished)try{
            var keys=tx.execute(s->{
                var resources=jdbc.queryForList("SELECT object_key FROM resources WHERE id=? FOR UPDATE",id);
                var jobs=jdbc.queryForList("SELECT source_key,snapshot_key FROM upload_scan_jobs WHERE resource_id=? AND status IN ('done','failed') AND source_deleted_at IS NULL AND updated_at<now()-interval '15 minutes' FOR UPDATE",id);
                if(resources.isEmpty()||jobs.isEmpty())return Set.<String>of();
                var j=jobs.getFirst();var result=new HashSet<String>(List.of((String)j.get("source_key"),(String)j.get("snapshot_key"),FilePolicy.outputKey(id,(String)j.get("snapshot_key"))));
                result.remove((String)resources.getFirst().get("object_key"));return result;
            });
            if(keys==null||keys.isEmpty())continue;
            for(String key:keys)store.delete(key);
            artifacts+=jdbc.update("UPDATE upload_scan_jobs SET source_deleted_at=now() WHERE resource_id=? AND status IN ('done','failed') AND source_deleted_at IS NULL",id);
        }catch(Exception e){/* terminal jobs cannot be reclaimed; retry copies later */}
        int transactions=jdbc.update("DELETE FROM oauth_login_transactions WHERE id IN (SELECT id FROM oauth_login_transactions WHERE expires_at<now()-interval '1 day' LIMIT 200)");
        int sessions=jdbc.update("DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at<now()-interval '7 days' LIMIT 200)");
        reconcileOrphans();
        return Map.of("inspected",ids.size(),"cleaned",cleaned,"artifactsCleaned",artifacts,"expiredTransactions",transactions,"expiredSessions",sessions);
    }
    /** Bounded inventory progress is only an optimization; restart safely starts over. */
    private synchronized void reconcileOrphans(){
        for(String prefix:List.of("pending/","active/"))try{
            var page=store.list(prefix,inventoryCursors.get(prefix));if(page==null)continue;
            boolean retry=false;
            for(var object:page.items())try{
                if(object.modified()==null||object.modified().isAfter(java.time.Instant.now().minusSeconds(900)))continue;
                String key=object.key();
                // Only keys from this application's immutable upload layout are eligible.
                if(!key.matches("(?:pending|active)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9-]+"))continue;
                Boolean referenced=jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM resources WHERE object_key=?) OR EXISTS(SELECT 1 FROM upload_scan_jobs WHERE source_key=? OR snapshot_key=? OR ('active/'||resource_id::text||'/'||substring(snapshot_key from '[^/]+$'))=?)",Boolean.class,key,key,key,key);
                if(Boolean.FALSE.equals(referenced))store.delete(key);
            }catch(Exception e){retry=true;}
            if(!retry){if(page.next()==null)inventoryCursors.remove(prefix);else inventoryCursors.put(prefix,page.next());}
        }catch(Exception e){org.slf4j.LoggerFactory.getLogger(CleanupService.class).warn("orphan_inventory_unavailable");}
    }
}
