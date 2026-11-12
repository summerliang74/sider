package com.sider.resources;

import tools.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class AuditWriter {
    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper json;
    private static final Set<String> FIELDS=Set.of("reason","note","reportId","resourceId","actorRole","changedFields");
    public AuditWriter(NamedParameterJdbcTemplate jdbc,ObjectMapper json){this.jdbc=jdbc;this.json=json;}
    public void append(UUID actor,String action,String targetType,UUID targetId,Map<String,?> metadata) {
        Map<String,Object> values=new LinkedHashMap<>();
        metadata.forEach((k,v)->{if(FIELDS.contains(k)&&(v==null||v instanceof String||v instanceof Number||v instanceof Boolean)) values.put(k,v instanceof String s?ResourcePolicy.sanitizeAuditText(s):v);});
        Map<String,Object> params=new HashMap<>();params.put("actor",actor);params.put("action",action);params.put("type",targetType);params.put("target",targetId);params.put("metadata",json.writeValueAsString(values));
        jdbc.update("INSERT INTO audit_logs(actor_id,action,target_type,target_id,metadata) VALUES (:actor,:action,:type,:target,CAST(:metadata AS jsonb))",params);
    }
    @SuppressWarnings("unchecked")
    public Map<String,Object> safeMetadata(String raw) {
        Map<String,Object> result=new LinkedHashMap<>();
        try {
            Map<String,Object> input=json.readValue(raw,Map.class);
            input.forEach((k,v)->{if(FIELDS.contains(k)&&(v==null||v instanceof String||v instanceof Number||v instanceof Boolean))result.put(k,v instanceof String s?ResourcePolicy.sanitizeAuditText(s):v);});
        } catch(Exception ignored) { /* Historical invalid/unrecognized data is not exposed. */ }
        return result;
    }
}
