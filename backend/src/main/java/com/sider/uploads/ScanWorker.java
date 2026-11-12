package com.sider.uploads;

import com.sider.config.SiderConfig;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ScanWorker {
    public record Job(UUID id,UUID authorId,String source,String snapshot,int attempts,UUID lease) {}
    private record Outcome(String kind,String reason,String key,String mime,String sha) {}
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ObjectStore store;
    private final ScannerClient scanner;
    private final UploadService resources;
    private final SiderConfig env;
    public ScanWorker(JdbcTemplate jdbc,TransactionTemplate tx,ObjectStore store,ScannerClient scanner,UploadService resources,SiderConfig env){this.jdbc=jdbc;this.tx=tx;this.store=store;this.scanner=scanner;this.resources=resources;this.env=env;}
    @Scheduled(fixedDelay=5000,initialDelay=5000) public void tick(){
        if(!env.flag("UPLOAD_WORKER_ENABLED",true)||!env.scannerEnabled())return;
        try{processOne();}catch(Exception e){org.slf4j.LoggerFactory.getLogger(ScanWorker.class).warn("upload_worker_unavailable");}
    }
    public Job claim(){return tx.execute(s->{
        if(!Boolean.TRUE.equals(jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(1936286821)",Boolean.class)))return null;
        if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM upload_scan_jobs WHERE status='processing' AND lease_until>clock_timestamp())",Boolean.class)))return null;
        var rows=jdbc.queryForList("SELECT resource_id,source_key,snapshot_key,attempts FROM upload_scan_jobs WHERE (status='queued' AND available_at<=clock_timestamp()) OR (status='processing' AND lease_until<=clock_timestamp()) ORDER BY available_at,resource_id LIMIT 1 FOR UPDATE SKIP LOCKED");
        if(rows.isEmpty())return null;var r=rows.getFirst();UUID id=(UUID)r.get("resource_id");UUID lease=UUID.randomUUID();
        int attempt=((Number)r.get("attempts")).intValue()+1;
        jdbc.update("UPDATE upload_scan_jobs SET status='processing',attempts=?,lease_token=?,lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() WHERE resource_id=?",attempt,lease,id);
        UUID author=jdbc.queryForObject("SELECT author_id FROM resources WHERE id=?",UUID.class,id);
        return new Job(id,author,(String)r.get("source_key"),(String)r.get("snapshot_key"),attempt,lease);
    });}
    public Map<String,Object> processOne(){
        Job job=claim();if(job==null)return Map.of("processed",false);
        Outcome outcome;
        try{outcome=process(job);}catch(Exception e){outcome=new Outcome("retry","scan_dependency_unavailable",null,null,null);}
        boolean committed=settle(job,outcome);
        org.slf4j.LoggerFactory.getLogger(ScanWorker.class).info("scan_attempt outcome={} attempt={} committed={}",outcome.kind(),job.attempts(),committed);
        return Map.of("processed",true,"committed",committed);
    }
    private Outcome process(Job j){
        var r=resources.find(j.id());
        if(r==null||!r.status().equals("scanning")||!r.key().equals(j.snapshot()))return failed("upload_cancelled");
        if(!"active".equals(jdbc.queryForObject("SELECT status::text FROM users WHERE id=?",String.class,j.authorId())))return failed("upload_cancelled");
        if(j.attempts()>3)return failed("scan_retries_exhausted");
        var head=store.head(j.snapshot());
        if(!head.matches(j.id(),r.size(),r.mime()))return failed("object_mismatch");
        var result=scanner.scan(j.id(),j.snapshot());
        if(result.status().equals("error"))return new Outcome("retry","scanner_unavailable",null,null,null);
        if(result.status().equals("infected"))return failed("malware_detected");
        if(!FilePolicy.allowed(r.filename(),result.mime()))return failed("file_type_mismatch");
        if(result.sha256()==null||!result.sha256().matches("[a-f0-9]{64}"))return new Outcome("retry","invalid_scanner_response",null,null,null);
        String output=FilePolicy.outputKey(j.id(),j.snapshot());store.copy(j.snapshot(),output,head.etag());
        return new Outcome("active",null,output,result.mime(),result.sha256());
    }
    private Outcome failed(String reason){return new Outcome("failed",reason,null,null,null);}
    private boolean settle(Job j,Outcome outcome){return Boolean.TRUE.equals(tx.execute(s->{
        var users=jdbc.queryForList("SELECT status FROM users WHERE id=? FOR SHARE",j.authorId());
        var rows=jdbc.queryForList("SELECT status,object_key FROM resources WHERE id=? FOR UPDATE",j.id());
        var jobs=jdbc.queryForList("SELECT attempts FROM upload_scan_jobs WHERE resource_id=? AND status='processing' AND lease_token=? AND lease_until>clock_timestamp() FOR UPDATE",j.id(),j.lease());
        if(jobs.isEmpty()||rows.isEmpty())return false;
        var resource=rows.getFirst();
        boolean publishable="scanning".equals(resource.get("status"))&&j.snapshot().equals(resource.get("object_key"))&&!users.isEmpty()&&"active".equals(users.getFirst().get("status"));
        String target="failed";String error=publishable?outcome.reason():"upload_cancelled";
        if(publishable&&outcome.kind().equals("retry")&&j.attempts()<3){
            target="queued";
        }else if(publishable&&outcome.kind().equals("active")){
            jdbc.update("UPDATE resources SET status='active',object_key=?,mime_type=?,sha256=?,published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=? AND status='scanning'",outcome.key(),outcome.mime(),outcome.sha(),j.id());
            target="done";error=null;
        }else if("scanning".equals(resource.get("status"))){
            jdbc.update("UPDATE resources SET status='quarantined',moderation_reason=?,updated_at=clock_timestamp() WHERE id=? AND status='scanning'",error,j.id());
        }
        int changed=jdbc.update("UPDATE upload_scan_jobs SET status=?,last_error=?,available_at=clock_timestamp()+(? * interval '1 second'),lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE resource_id=? AND status='processing' AND lease_token=? AND lease_until>clock_timestamp()",target,error,30*(1<<Math.clamp(j.attempts()-1,0,2)),j.id(),j.lease());
        if(changed!=1){s.setRollbackOnly();return false;}return true;
    }));}
}
