package com.sider.admin;

import com.sider.auth.*;
import com.sider.resources.*;
import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.namedparam.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.*;
import java.util.*;

@Repository
public class AdminRepository {
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final CursorService cursors;
    private final AuthService auth;
    private final AuditWriter audit;
    public AdminRepository(NamedParameterJdbcTemplate jdbc,TransactionTemplate transactions,CursorService cursors,AuthService auth,AuditWriter audit) {
        this.jdbc=jdbc;this.transactions=transactions;this.cursors=cursors;this.auth=auth;this.audit=audit;
    }
    public Map<String,Object> reports(CurrentUser user,String status,String rawCursor) {
        return reports(user,status,rawCursor,false);
    }
    public Map<String,Object> reports(CurrentUser user,String status,String rawCursor,boolean workspace) {
        if(workspace&&(rawCursor!=null||!"open".equals(status)))throw new ApiException(400,"invalid_query");
        String scope="reports:"+user.id();var filter=new CursorService.Filter(null,null,null,status);var pos=workspace?null:cursors.decode(rawCursor,scope,filter,false);
        var params=new MapSqlParameterSource("status",status).addValue("limit",workspace?100:101);String paging="";
        if(pos!=null){paging=" AND (p.created_at,p.id)>(:time,:id)";params.addValue("time",OffsetDateTime.ofInstant(pos.time(),ZoneOffset.UTC)).addValue("id",pos.id());}
        var rows=jdbc.query("""
            SELECT p.id,p.resource_id,r.title AS resource_title,r.status AS resource_status,r.author_id,
                   u.display_name AS reporter_name,p.reason,p.details,p.status,p.created_at,p.handled_at,p.resolution_note
            FROM resource_reports p JOIN resources r ON r.id=p.resource_id JOIN users u ON u.id=p.reporter_id
            WHERE p.status=CAST(:status AS report_status)
            """+paging+" ORDER BY p.created_at ASC,p.id ASC LIMIT :limit",params,(rs,n)->{
                var id=rs.getObject("id",UUID.class);var time=ResourceRepository.instant(rs,"created_at");Map<String,Object> m=new LinkedHashMap<>();
                m.put("id",id);m.put("resourceId",rs.getObject("resource_id",UUID.class));m.put("resourceTitle",rs.getString("resource_title"));m.put("resourceStatus",rs.getString("resource_status"));
                m.put("authorId",rs.getObject("author_id",UUID.class));m.put("reporterName",rs.getString("reporter_name"));m.put("reason",rs.getString("reason"));m.put("details",rs.getString("details"));
                m.put("status",rs.getString("status"));m.put("createdAt",time);m.put("handledAt",ResourceRepository.instant(rs,"handled_at"));m.put("resolutionNote",rs.getString("resolution_note"));return new Row(m,new CursorService.Position(id,time,null));
            });
        return ResourceRepository.page("reports",rows.stream().limit(100).map(Row::item).toList(),!workspace&&rows.size()>100?cursors.encode(scope,filter,rows.get(99).position()):null);
    }
    private record Row(Map<String,Object> item,CursorService.Position position) {}
    /** One consistent snapshot; UTC buckets include quiet hours/days with zero values. */
    @org.springframework.transaction.annotation.Transactional(readOnly=true, isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ, timeout=5)
    public Map<String,Object> dashboard(String range) {
        int buckets=switch(range){case "24h"->24;case "7d"->7;case "30d"->30;default->throw new ApiException(400,"invalid_query");};
        boolean hourly=range.equals("24h");
        var now=Objects.requireNonNull(jdbc.queryForObject("SELECT current_timestamp",Map.of(),OffsetDateTime.class)).toInstant();
        var end=hourly?now.truncatedTo(java.time.temporal.ChronoUnit.HOURS):now.truncatedTo(java.time.temporal.ChronoUnit.DAYS);
        var start=end.minus(buckets-1,hourly?java.time.temporal.ChronoUnit.HOURS:java.time.temporal.ChronoUnit.DAYS);
        var params=new MapSqlParameterSource("start",OffsetDateTime.ofInstant(start,ZoneOffset.UTC))
            .addValue("end",OffsetDateTime.ofInstant(end,ZoneOffset.UTC)).addValue("now",OffsetDateTime.ofInstant(now,ZoneOffset.UTC))
            .addValue("step",hourly?"1 hour":"1 day").addValue("unit",hourly?"hour":"day");
        var summary=jdbc.queryForMap("""
            SELECT (SELECT count(*) FROM resources WHERE status<>'deleted') AS "totalResources",
              (SELECT count(*) FROM resources WHERE status='active') AS "activeResources",
              (SELECT count(*) FROM users) AS "totalUsers",
              (SELECT count(*) FROM resource_reports WHERE status='open') AS "openReports",
              (SELECT coalesce(sum(size_bytes),0) FROM resources WHERE status<>'deleted') AS "resourceBytes",
              (SELECT count(*) FROM resources WHERE created_at>=:start AND created_at<=:now) AS "newResources",
              (SELECT count(*) FROM users WHERE created_at>=:start AND created_at<=:now) AS "newUsers"
            """,params);
        var series=jdbc.queryForList("""
            WITH buckets AS (SELECT generate_series(CAST(:start AS timestamptz) AT TIME ZONE 'UTC',CAST(:end AS timestamptz) AT TIME ZONE 'UTC',CAST(:step AS interval)) AT TIME ZONE 'UTC' AS bucket),
            events AS (
              SELECT created_at AS at,1 AS uploads,0 AS bytes,0 AS reports,0 AS handled FROM resources WHERE created_at>=:start AND created_at<=:now
              UNION ALL SELECT created_at,0,size_bytes,0,0 FROM resources WHERE created_at>=:start AND created_at<=:now
              UNION ALL SELECT created_at,0,0,1,0 FROM resource_reports WHERE created_at>=:start AND created_at<=:now
              UNION ALL SELECT handled_at,0,0,0,1 FROM resource_reports WHERE handled_at>=:start AND handled_at<=:now
            ), totals AS (
              SELECT date_trunc(:unit,at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket,
                sum(uploads) AS uploads,sum(bytes) AS bytes,sum(reports) AS reports,sum(handled) AS handled FROM events GROUP BY 1
            ) SELECT to_char(b.bucket AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
                coalesce(t.uploads,0) AS uploads,coalesce(t.bytes,0) AS bytes,
                coalesce(t.reports,0) AS reports,coalesce(t.handled,0) AS handled
              FROM buckets b LEFT JOIN totals t USING(bucket) ORDER BY b.bucket
            """,params);
        var statuses=jdbc.queryForList("SELECT status::text AS label,count(*) AS value FROM resources GROUP BY status ORDER BY value DESC,label",params);
        var actions=jdbc.queryForList("SELECT action AS label,count(*) AS value FROM audit_logs WHERE created_at>=:start AND created_at<=:now GROUP BY action ORDER BY value DESC,label LIMIT 8",params);
        var tags=jdbc.queryForList("SELECT tag AS label,count(*) AS value FROM resources CROSS JOIN LATERAL (SELECT DISTINCT unnest(tags) AS tag) t WHERE status='active' GROUP BY tag ORDER BY value DESC,label LIMIT 8",params);
        var types=jdbc.queryForList("SELECT mime_type AS label,count(*) AS value FROM resources WHERE status='active' GROUP BY mime_type ORDER BY value DESC,label LIMIT 8",params);
        return Map.of("range",range,"generatedAt",now.toString(),"summary",summary,"series",series,"statuses",statuses,"actions",actions,"tags",tags,"types",types);
    }
    public Map<String,Object> audit(CurrentUser user,String rawCursor) {
        return audit(user,rawCursor,false);
    }
    public Map<String,Object> audit(CurrentUser user,String rawCursor,boolean workspace) {
        if(workspace&&rawCursor!=null)throw new ApiException(400,"invalid_query");
        String scope="audit:"+user.id();var filter=new CursorService.Filter(null,null,null,null);var pos=workspace?null:cursors.decode(rawCursor,scope,filter,false);
        int size=workspace?200:100;
        var params=new MapSqlParameterSource("limit",workspace?size:size+1);String paging="";
        if(pos!=null){paging=" WHERE (a.created_at,a.id)<(:time,:id)";params.addValue("time",OffsetDateTime.ofInstant(pos.time(),ZoneOffset.UTC)).addValue("id",pos.id());}
        var rows=jdbc.query("SELECT a.id,u.display_name AS actor,a.action,a.target_type,a.target_id,a.metadata,a.created_at FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id"+paging+" ORDER BY a.created_at DESC,a.id DESC LIMIT :limit",params,(rs,n)->{
            var id=rs.getObject("id",UUID.class);var time=ResourceRepository.instant(rs,"created_at");Map<String,Object> m=new LinkedHashMap<>();
            m.put("id",id);m.put("actor",rs.getString("actor"));m.put("action",rs.getString("action"));m.put("targetType",rs.getString("target_type"));m.put("targetId",rs.getObject("target_id",UUID.class));m.put("metadata",audit.safeMetadata(rs.getString("metadata")));m.put("createdAt",time);return new Row(m,new CursorService.Position(id,time,null));
        });
        return ResourceRepository.page("items",rows.stream().limit(size).map(Row::item).toList(),!workspace&&rows.size()>size?cursors.encode(scope,filter,rows.get(size-1).position()):null);
    }
    public Map<String,Object> moderate(UUID id,CurrentUser actor,HttpServletRequest request,String action,String reason,UUID reportId) {
        return transactions.execute(tx->{
            lockActor(actor,request);
            var resource=jdbc.query("SELECT status FROM resources WHERE id=:id AND status<>'deleted' FOR UPDATE",Map.of("id",id),(rs,n)->rs.getString("status"));
            if(resource.isEmpty() || (action.equals("hide")&&!resource.getFirst().equals("active")) || (action.equals("restore")&&!resource.getFirst().equals("hidden")))throw new ApiException(404,"resource_unavailable");
            String target=switch(action){case "hide"->"hidden";case "restore"->"active";default->"deleted";};
            var params=new MapSqlParameterSource("id",id).addValue("target",target).addValue("reason",reason).addValue("actor",actor.id()).addValue("report",reportId);
            jdbc.update("UPDATE resources SET status=CAST(:target AS resource_status),moderation_reason=:reason,updated_at=now()"+(action.equals("remove")?",deleted_at=now()":"")+" WHERE id=:id",params);
            List<UUID> resolved=List.of();
            if(action.equals("remove")||reportId!=null) {
                // Lock report rows in canonical order before changing them; mismatched optional ID is a no-op.
                String filter=action.equals("remove")?"":" AND id=:report";
                jdbc.query("SELECT id FROM resource_reports WHERE resource_id=:id AND status='open'"+filter+" ORDER BY id FOR UPDATE",params,(rs,n)->rs.getObject("id",UUID.class));
                resolved=jdbc.query("UPDATE resource_reports SET status='resolved',handled_by=:actor,handled_at=now(),resolution_note=:reason WHERE resource_id=:id AND status='open'"+filter+" RETURNING id",params,(rs,n)->rs.getObject("id",UUID.class));
            }
            Map<String,Object> metadata=new LinkedHashMap<>();metadata.put("reason",reason);metadata.put("reportId",reportId==null?null:reportId.toString());
            audit.append(actor.id(),"resource."+action,"resource",id,metadata);
            return Map.of("status",target,"resolvedReportIds",resolved.stream().sorted().toList());
        });
    }
    public Map<String,Object> dismiss(UUID id,CurrentUser actor,HttpServletRequest request,String note) {
        // Lookup does not hold a lock. We must acquire resource before report to match all other governance paths.
        var targets=jdbc.query("SELECT resource_id FROM resource_reports WHERE id=:id",Map.of("id",id),(rs,n)->rs.getObject("resource_id",UUID.class));
        if(targets.isEmpty())throw new ApiException(404,"report_unavailable");UUID resourceId=targets.getFirst();
        return transactions.execute(tx->{
            lockActor(actor,request);
            jdbc.query("SELECT id FROM resources WHERE id=:id FOR UPDATE",Map.of("id",resourceId),(rs,n)->rs.getObject("id",UUID.class));
            var updated=jdbc.query("UPDATE resource_reports SET status='dismissed',handled_by=:actor,handled_at=now(),resolution_note=:note WHERE id=:id AND resource_id=:resource AND status='open' RETURNING id",Map.of("id",id,"actor",actor.id(),"resource",resourceId,"note",note),(rs,n)->rs.getObject("id",UUID.class));
            if(updated.isEmpty())throw new ApiException(404,"report_unavailable");
            audit.append(actor.id(),"report.dismiss","report",id,Map.of("resourceId",resourceId.toString(),"note",note));return Map.of("status","dismissed");
        });
    }
    public Map<String,Object> suspend(UUID target,CurrentUser actor,HttpServletRequest request,String reason) {
        if(target.equals(actor.id()))throw new ApiException(409,"cannot_suspend_self");
        return transactions.execute(tx->{
            limits();
            // One ordered acquisition prevents two administrators suspending each other from deadlocking.
            var locked=jdbc.query("SELECT id FROM users WHERE id IN (:ids) ORDER BY id FOR UPDATE",Map.of("ids",List.of(actor.id(),target)),(rs,n)->rs.getObject("id",UUID.class));
            var revalidated=auth.lockCurrent(actor,request);if(!"admin".equals(revalidated.role()))throw new ApiException(403,"forbidden");
            if(!locked.contains(target))throw new ApiException(404,"user_unavailable");
            int count=jdbc.update("UPDATE users SET status='suspended',updated_at=now() WHERE id=:id AND status='active'",Map.of("id",target));
            if(count!=1)throw new ApiException(404,"user_unavailable");
            jdbc.update("UPDATE sessions SET revoked_at=now() WHERE user_id=:id AND revoked_at IS NULL",Map.of("id",target));
            audit.append(actor.id(),"user.suspend","user",target,Map.of("reason",reason));return Map.of("status","suspended");
        });
    }
    private void lockActor(CurrentUser actor,HttpServletRequest request){limits();var current=auth.lockCurrent(actor,request);if(!"admin".equals(current.role()))throw new ApiException(403,"forbidden");}
    private void limits(){jdbc.getJdbcTemplate().execute("SET LOCAL statement_timeout = '5s'");jdbc.getJdbcTemplate().execute("SET LOCAL lock_timeout = '2s'");}
}
