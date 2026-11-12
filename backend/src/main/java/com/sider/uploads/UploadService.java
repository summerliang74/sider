package com.sider.uploads;

import com.sider.auth.AuthService;
import com.sider.auth.CurrentUser;
import com.sider.config.SiderConfig;
import com.sider.resources.ResourcePolicy;
import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.io.InputStream;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class UploadService {
    public record Resource(UUID id, UUID authorId, String title, String filename, String key, String mime, long size, String status, Instant created) {}
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ObjectStore store;
    private final AuthService auth;
    private final SiderConfig env;
    public UploadService(JdbcTemplate jdbc, TransactionTemplate tx, ObjectStore store, AuthService auth, SiderConfig env) { this.jdbc=jdbc; this.tx=tx; this.store=store; this.auth=auth; this.env=env; }
    public Map<String,Object> create(CurrentUser user, HttpServletRequest request, UploadController.Intent body) {
        if (!env.scannerEnabled()) throw new ApiException(503,"uploads_disabled");
        var meta=ResourcePolicy.validate(body.title(),body.description()==null?"":body.description(),body.tags()==null?List.of():body.tags(),user);
        String name=FilePolicy.filename(body.originalFilename());
        if (body.mimeType()==null || !FilePolicy.allowed(name,body.mimeType())) throw new ApiException(415,"file_type_not_allowed");
        if (body.sizeBytes()==null || body.sizeBytes()<=0) throw new ApiException(400,"invalid_upload");
        if (body.sizeBytes()>env.number("UPLOAD_MAX_BYTES",52_428_800)) throw new ApiException(413,"file_too_large");
        UUID id=UUID.randomUUID(); String key="pending/"+id+"/"+UUID.randomUUID()+UUID.randomUUID().toString().replace("-","");
        tx.executeWithoutResult(s->{
            auth.lockCurrent(user,request);
            jdbc.update(c->{ var p=c.prepareStatement("INSERT INTO resources(id,author_id,title,description,tags,original_filename,object_key,mime_type,size_bytes) VALUES(?,?,?,?,?,?,?,?,?)");
                p.setObject(1,id);p.setObject(2,user.id());p.setString(3,meta.title());p.setString(4,meta.description());p.setArray(5,c.createArrayOf("text",meta.tags().toArray()));p.setString(6,name);p.setString(7,key);p.setString(8,body.mimeType());p.setLong(9,body.sizeBytes());return p; });
        });
        return store.uploadUrl(key,id,body.mimeType(),body.sizeBytes());
    }
    public Resource find(UUID id) {
        return jdbc.query("SELECT id,author_id,title,original_filename,object_key,mime_type,size_bytes,status,created_at FROM resources WHERE id=?",(r,n)->map(r),id).stream().findFirst().orElse(null);
    }
    public Map<String,Object> complete(CurrentUser user, HttpServletRequest request, UUID id) {
        if (!env.scannerEnabled()) throw new ApiException(503,"uploads_disabled");
        Resource initial=owned(id,user);
        if (!initial.status().equals("pending")) return state(initial);
        if (initial.created().isBefore(Instant.now().minusSeconds(3600))) throw new ApiException(409,"upload_expired");
        var head=store.head(initial.key());
        if (!head.matches(id,initial.size(),initial.mime())) throw new ApiException(409,"object_mismatch");
        String snapshot="pending/"+id+"/snapshot-"+UUID.randomUUID()+UUID.randomUUID().toString().replace("-","");
        store.copy(initial.key(),snapshot,head.etag());
        if (!store.head(snapshot).matches(id,initial.size(),initial.mime())) { safeDelete(snapshot);throw new ApiException(409,"object_mismatch"); }
        // Storage precedes DB. An unknown commit must leave its snapshot intact.
        boolean accepted=Boolean.TRUE.equals(tx.execute(s->{
            auth.lockCurrent(user,request);
            var rows=jdbc.queryForList("SELECT status,object_key,created_at FROM resources WHERE id=? AND author_id=? FOR UPDATE",id,user.id());
            if(rows.isEmpty()) throw new ApiException(404,"resource_unavailable");
            var row=rows.getFirst();
            if(!"pending".equals(row.get("status"))) return false;
            int changed=jdbc.update("UPDATE resources SET status='scanning',object_key=?,updated_at=now() WHERE id=? AND author_id=? AND status='pending' AND object_key=? AND created_at>now()-interval '1 hour'",snapshot,id,user.id(),initial.key());
            if(changed==0) throw new ApiException(409,"upload_expired");
            jdbc.update("INSERT INTO upload_scan_jobs(resource_id,source_key,snapshot_key) VALUES(?,?,?)",id,initial.key(),snapshot);
            return true;
        }));
        if(!accepted) safeDelete(snapshot);
        return state(owned(id,user));
    }
    public void legacyUpload(CurrentUser user,HttpServletRequest request,UUID id,String mime,long length,InputStream body) {
        if(!env.flag("LEGACY_UPLOAD_ENABLED",false)) throw new ApiException(410,"legacy_upload_disabled");
        if(!env.scannerEnabled()) throw new ApiException(503,"uploads_disabled");
        Resource r=owned(id,user);
        if(!r.status().equals("pending")||r.created().isBefore(Instant.now().minusSeconds(300))) throw new ApiException(404,"resource_unavailable");
        if(length<=0||length>env.number("UPLOAD_MAX_BYTES",52_428_800)) throw new ApiException(413,"file_too_large");
        if(r.size()!=length||!r.mime().equals(mime)) throw new ApiException(409,"object_mismatch");
        // The object is never published until complete creates a verified immutable snapshot.
        store.upload(r.key(),id,mime,length,body);
    }
    public Map<String,Object> statuses(CurrentUser user,List<UUID> ids) {
        if(ids==null||ids.isEmpty()||ids.size()>5||new HashSet<>(ids).size()!=ids.size()||ids.contains(null)) throw new ApiException(400,"invalid_request");
        String placeholders=String.join(",",Collections.nCopies(ids.size(),"?"));
        List<Object> args=new ArrayList<>();args.add(user.id());args.addAll(ids);
        return Map.of("items",jdbc.query("SELECT id,status FROM resources WHERE author_id=? AND id IN ("+placeholders+")",(r,n)->Map.of("id",r.getObject("id",UUID.class),"status",r.getString("status")),args.toArray()));
    }
    public Map<String,Object> download(CurrentUser user,HttpServletRequest request,UUID id) {
        // Local presigning does not perform storage I/O. Hold the authorization
        // and resource locks through it so hide/delete/suspend serialize correctly.
        return tx.execute(s->{
            auth.lockCurrent(user,request);
            var rows=jdbc.queryForList("SELECT object_key,original_filename FROM resources WHERE id=? AND status='active' AND object_deleted_at IS NULL FOR SHARE",id);
            if(rows.isEmpty())throw new ApiException(404,"resource_unavailable");
            return store.downloadUrl((String)rows.getFirst().get("object_key"),(String)rows.getFirst().get("original_filename"));
        });
    }
    private Resource owned(UUID id,CurrentUser user) { Resource r=find(id);if(r==null||!r.authorId().equals(user.id())) throw new ApiException(404,"resource_unavailable");return r; }
    private Map<String,Object> state(Resource r) { return Map.of("id",r.id(),"status",r.status()); }
    private void safeDelete(String key) { try{store.delete(key);}catch(Exception ignored){} }
    private static Resource map(ResultSet r)throws SQLException { return new Resource(r.getObject("id",UUID.class),r.getObject("author_id",UUID.class),r.getString("title"),r.getString("original_filename"),r.getString("object_key"),r.getString("mime_type"),r.getLong("size_bytes"),r.getString("status"),r.getTimestamp("created_at").toInstant()); }
}
