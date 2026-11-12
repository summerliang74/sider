package com.sider.resources;

import com.sider.auth.*;
import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.namedparam.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
import java.math.BigDecimal;
import java.sql.*;
import java.time.*;
import java.util.*;

@Repository
public class ResourceRepository {
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final CursorService cursors;
    private final AuthService auth;
    private final AuditWriter audit;
    public ResourceRepository(NamedParameterJdbcTemplate jdbc,TransactionTemplate transactions,CursorService cursors,AuthService auth,AuditWriter audit) {
        this.jdbc=jdbc;this.transactions=transactions;this.cursors=cursors;this.auth=auth;this.audit=audit;
    }
    public Map<String,Object> search(ResourceQueries.Search input) {
        var filter=input.filter();var cursor=cursors.decode(input.cursor(),"resources",filter,true);
        MapSqlParameterSource p=new MapSqlParameterSource().addValue("q",input.q()).addValue("pattern","%"+ResourcePolicy.escapeLike(input.q())+"%")
            .addValue("limit",21);
        String conditions="r.status='active'";
        if(input.type()!=null) {conditions+=" AND r.mime_type=:mime";p.addValue("mime",ResourcePolicy.MIME_TYPES.get(input.type()));}
        if(input.tag()!=null) {
            if(ResourcePolicy.isPaTag(input.tag())) conditions+=" AND EXISTS(SELECT 1 FROM unnest(r.tags) t(value) WHERE regexp_replace(lower(trim(normalize(t.value,NFKC))),'[^a-z0-9]+','','g') IN ('pa','peeradvisor','peeradvisors'))";
            else {conditions+=" AND EXISTS(SELECT 1 FROM unnest(r.tags) t(value) WHERE lower(trim(t.value))=lower(:tag))";p.addValue("tag",input.tag());}
        }
        boolean hasQuery=!input.q().isEmpty();
        String rank="0::numeric";
        String title="r.title",description="coalesce(nullif(r.description,''),r.original_filename)";
        if(hasQuery) {
            conditions+=" AND (r.search_vector @@ i.tsq OR r.search_text %> :q OR r.search_text ILIKE :pattern ESCAPE E'\\\\')";
            rank="""
                round((ts_rank_cd(r.search_vector,i.tsq,32)::numeric*100
                +word_similarity(:q,r.search_text)::numeric*10
                +CASE WHEN r.title ILIKE :pattern ESCAPE E'\\\\' THEN 8 ELSE 0 END
                +CASE WHEN r.original_filename ILIKE :pattern ESCAPE E'\\\\' THEN 4 ELSE 0 END
                +CASE WHEN r.description ILIKE :pattern ESCAPE E'\\\\' THEN 2 ELSE 0 END
                +CASE WHEN array_to_string(r.tags,' ') ILIKE :pattern ESCAPE E'\\\\' THEN 1 ELSE 0 END)::numeric,6)
                """;
            // Remove marker characters from headline input, never interpret resource content as HTML.
            title="ts_headline('simple',replace(replace(r.title,chr(57344),''),chr(57345),''),i.tsq,'StartSel="+START+", StopSel="+END+", HighlightAll=true, ShortWord=1')";
            description="ts_headline('simple',replace(replace(coalesce(nullif(r.description,''),r.original_filename),chr(57344),''),chr(57345),''),i.tsq,'StartSel="+START+", StopSel="+END+", MaxWords=24, MinWords=8, ShortWord=2, MaxFragments=2, FragmentDelimiter= … ')";
        }
        String paging="";
        if(cursor!=null) {paging=" WHERE (score,page_time,id)<(:score,:time,:id)";p.addValue("score",cursor.score()).addValue("time",OffsetDateTime.ofInstant(cursor.time(),ZoneOffset.UTC)).addValue("id",cursor.id());}
        String sql="WITH input AS (SELECT websearch_to_tsquery('simple',:q) AS tsq), ranked AS (SELECT r.id,r.title,r.description,r.tags,r.original_filename,r.mime_type,r.size_bytes,u.display_name AS author_name,coalesce(r.published_at,r.created_at) AS page_time,"+rank+" AS score,"+title+" AS title_headline,"+description+" AS description_headline FROM resources r JOIN users u ON u.id=r.author_id CROSS JOIN input i WHERE "+conditions+") SELECT * FROM ranked"+paging+" ORDER BY score DESC,page_time DESC,id DESC LIMIT :limit";
        return transactions.execute(status->{
            limits();
            if(hasQuery)jdbc.getJdbcTemplate().execute("SET LOCAL pg_trgm.word_similarity_threshold = 0.3");
            List<SearchRow> rows=jdbc.query(sql,p,(rs,n)->new SearchRow(listItem(rs,hasQuery),new CursorService.Position(rs.getObject("id",UUID.class),instant(rs,"page_time"),rs.getBigDecimal("score"))));
            List<Map<String,Object>> items=rows.stream().limit(20).map(SearchRow::item).toList();
            String next=rows.size()>20?cursors.encode("resources",filter,rows.get(19).position()):null;
            return page("items",items,next);
        });
    }
    private record SearchRow(Map<String,Object> item,CursorService.Position position) {}
    private Map<String,Object> listItem(ResultSet rs,boolean hasQuery)throws SQLException {
        var m=base(rs);m.put("publishedAt",instant(rs,"page_time"));m.put("authorName",rs.getString("author_name"));
        if(hasQuery)m.put("highlights",Map.of("title",segments(rs.getString("title_headline")),"description",segments(rs.getString("description_headline"))));
        return m;
    }
    public Map<String,Object> detail(UUID id,CurrentUser viewer) {
        List<Map<String,Object>> rows=jdbc.query("""
            SELECT r.id,r.title,r.description,r.tags,r.original_filename,r.mime_type,r.size_bytes,
                   r.status,r.published_at,r.author_id,u.display_name AS author_name
            FROM resources r JOIN users u ON u.id=r.author_id
            WHERE r.id=:id AND (r.status='active' OR (r.status<>'deleted' AND (r.author_id=:viewer OR :admin)))
            """,Map.of("id",id,"viewer",viewer.id(),"admin","admin".equals(viewer.role())),(rs,n)->{
                var item=base(rs);item.put("status",rs.getString("status"));item.put("publishedAt",instant(rs,"published_at"));item.put("authorId",rs.getObject("author_id",UUID.class));item.put("authorName",rs.getString("author_name"));return item;
            });
        if(rows.isEmpty())throw new ApiException(404,"resource_unavailable");return Map.of("resource",rows.getFirst());
    }
    public Map<String,Object> mine(CurrentUser user,String status,String rawCursor) {
        return mine(user,status,rawCursor,false);
    }
    public Map<String,Object> mine(CurrentUser user,String status,String rawCursor,boolean workspace) {
        if(workspace&&(rawCursor!=null||!"all".equals(status)))throw new ApiException(400,"invalid_query");
        String scope="mine:"+user.id();var filter=new CursorService.Filter(null,null,null,status);var pos=workspace?null:cursors.decode(rawCursor,scope,filter,false);
        int size=workspace?100:20;
        var p=new MapSqlParameterSource("viewer",user.id()).addValue("limit",workspace?size:size+1);
        String predicate=switch(status){case "active"->" AND status='active'";case "scanning"->" AND status IN ('pending','scanning')";case "unavailable"->" AND status IN ('hidden','quarantined','deleted','failed')";default->"";};
        if(pos!=null){predicate+=" AND (created_at,id)<(:time,:id)";p.addValue("time",OffsetDateTime.ofInstant(pos.time(),ZoneOffset.UTC)).addValue("id",pos.id());}
        List<MineRow> rows=jdbc.query("SELECT id,title,original_filename,status,created_at FROM resources WHERE author_id=:viewer"+predicate+" ORDER BY created_at DESC,id DESC LIMIT :limit",p,(rs,n)->{
            var time=instant(rs,"created_at");var id=rs.getObject("id",UUID.class);return new MineRow(Map.of("id",id,"title",rs.getString("title"),"originalFilename",rs.getString("original_filename"),"status",rs.getString("status"),"createdAt",time),new CursorService.Position(id,time,null));
        });
        return page("items",rows.stream().limit(size).map(MineRow::item).toList(),!workspace&&rows.size()>size?cursors.encode(scope,filter,rows.get(size-1).position()):null);
    }
    private record MineRow(Map<String,Object> item,CursorService.Position position) {}
    public Map<String,Object> tags() {
        List<String> active=jdbc.query("SELECT DISTINCT lower(trim(t.value)) AS tag FROM resources r CROSS JOIN LATERAL unnest(r.tags) t(value) WHERE r.status='active' AND trim(t.value)<>'' ORDER BY tag LIMIT 500",Map.of(),(rs,n)->rs.getString("tag"));
        LinkedHashMap<String,String> tags=new LinkedHashMap<>();ResourcePolicy.SUGGESTED_TAGS.forEach(t->tags.put(t.toLowerCase(Locale.ROOT),t));
        active.stream().map(ResourcePolicy::canonicalTag).sorted(String.CASE_INSENSITIVE_ORDER).forEach(t->tags.putIfAbsent(t.toLowerCase(Locale.ROOT),t));
        return Map.of("tags",List.copyOf(tags.values()));
    }
    public Map<String,Object> update(UUID id,CurrentUser user,HttpServletRequest request,ResourcePolicy.Metadata metadata) {
        return transactions.execute(tx->{
            limits();auth.lockCurrent(user,request);
            // Pg text[] binding is scoped to this transaction's actual connection.
            return jdbc.getJdbcTemplate().execute((org.springframework.jdbc.core.ConnectionCallback<Map<String,Object>>) connection->{
                try(var tags= new SqlArrayResource(connection.createArrayOf("text",metadata.tags().toArray(String[]::new)))) {
                    var p=new MapSqlParameterSource("id",id).addValue("actor",user.id()).addValue("admin","admin".equals(user.role())).addValue("title",metadata.title()).addValue("description",metadata.description()).addValue("tags",tags.array(),Types.ARRAY);
                    var updated=jdbc.query("UPDATE resources SET title=:title,description=:description,tags=:tags,updated_at=now() WHERE id=:id AND status<>'deleted' AND (author_id=:actor OR :admin) RETURNING id,status",p,(rs,n)->Map.<String,Object>of("id",rs.getObject("id",UUID.class),"status",rs.getString("status")));
                    if(updated.isEmpty())throw new ApiException(404,"resource_unavailable");
                    audit.append(user.id(),"resource.metadata_update","resource",id,Map.of("actorRole",user.role(),"changedFields","title,description,tags"));
                    return Map.of("resource",updated.getFirst());
                }
            });
        });
    }
    private record SqlArrayResource(java.sql.Array array) implements AutoCloseable {public void close()throws SQLException{array.free();}}
    public Map<String,Object> delete(UUID id,CurrentUser user,HttpServletRequest request) {
        return transactions.execute(tx->{
            limits();auth.lockCurrent(user,request);
            int count=jdbc.update("UPDATE resources SET status='deleted',deleted_at=now(),updated_at=now() WHERE id=:id AND author_id=:actor AND status<>'deleted' AND deleted_at IS NULL",Map.of("id",id,"actor",user.id()));
            if(count!=1)throw new ApiException(404,"resource_unavailable");
            audit.append(user.id(),"resource.delete","resource",id,Map.of());return Map.of("status","deleted");
        });
    }
    public Map<String,Object> report(UUID id,CurrentUser user,HttpServletRequest request,String reason,String details) {
        return transactions.execute(tx->{
            limits();auth.lockCurrent(user,request);
            var resource=jdbc.query("SELECT author_id FROM resources WHERE id=:id AND status='active' FOR SHARE",Map.of("id",id),(rs,n)->rs.getObject("author_id",UUID.class));
            if(resource.isEmpty()||resource.getFirst().equals(user.id()))throw new ApiException(404,"resource_unavailable");
            var reports=jdbc.query("INSERT INTO resource_reports(resource_id,reporter_id,reason,details) VALUES (:resource,:reporter,CAST(:reason AS report_reason),:details) ON CONFLICT(resource_id,reporter_id) WHERE status='open' DO NOTHING RETURNING id",Map.of("resource",id,"reporter",user.id(),"reason",reason,"details",details),(rs,n)->rs.getObject("id",UUID.class));
            if(reports.isEmpty())throw new ApiException(409,"report_already_open");return Map.of("report",Map.of("id",reports.getFirst()));
        });
    }
    public static Instant instant(ResultSet rs,String name)throws SQLException{OffsetDateTime time=rs.getObject(name,OffsetDateTime.class);return time==null?null:time.toInstant();}
    private static Map<String,Object> base(ResultSet rs)throws SQLException {
        Map<String,Object> m=new LinkedHashMap<>();m.put("id",rs.getObject("id",UUID.class));m.put("title",rs.getString("title"));m.put("description",rs.getString("description"));
        java.sql.Array tags=rs.getArray("tags");try{m.put("tags",List.of((String[])tags.getArray()));}finally{tags.free();}
        m.put("originalFilename",rs.getString("original_filename"));m.put("mimeType",rs.getString("mime_type"));m.put("sizeBytes",rs.getLong("size_bytes"));return m;
    }
    public static Map<String,Object> page(String key,Object items,String cursor){Map<String,Object> result=new LinkedHashMap<>();result.put(key,items);result.put("nextCursor",cursor);return result;}
    public void limits(){jdbc.getJdbcTemplate().execute("SET LOCAL statement_timeout = '5s'");jdbc.getJdbcTemplate().execute("SET LOCAL lock_timeout = '2s'");}
    private static final String START="\uE000",END="\uE001";
    public static List<Map<String,Object>> segments(String headline) {
        if(headline==null||headline.isEmpty())return List.of();
        List<Map<String,Object>> result=new ArrayList<>();int at=0;
        while(at<headline.length()) {
            int start=headline.indexOf(START,at);
            if(start<0){result.add(Map.of("text",headline.substring(at),"highlighted",false));break;}
            if(start>at)result.add(Map.of("text",headline.substring(at,start),"highlighted",false));
            int end=headline.indexOf(END,start+1);
            if(end<0){if(start+1<headline.length())result.add(Map.of("text",headline.substring(start+1),"highlighted",false));break;}
            if(end>start+1)result.add(Map.of("text",headline.substring(start+1,end),"highlighted",true));at=end+1;
        }
        return List.copyOf(result);
    }
}
