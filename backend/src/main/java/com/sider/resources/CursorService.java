package com.sider.resources;

import com.sider.config.SiderConfig;
import com.sider.web.ApiException;
import tools.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

@Component
public final class CursorService {
    private final byte[] key;
    private final ObjectMapper json;
    private final Clock clock;
    public record Filter(String q,String type,String tag,String status) {}
    public record Position(UUID id,Instant time,BigDecimal score) {}
    @org.springframework.beans.factory.annotation.Autowired
    public CursorService(SiderConfig config,ObjectMapper json) {
        this(config.text("CURSOR_SIGNING_KEY").getBytes(StandardCharsets.UTF_8),json,Clock.systemUTC());
    }
    CursorService(byte[] key,ObjectMapper json,Clock clock) {
        if(key.length<32) throw new IllegalArgumentException("CURSOR_SIGNING_KEY must have at least 32 bytes");
        this.key=key.clone(); this.json=json; this.clock=clock;
    }
    public String encode(String scope,Filter filter,Position position) {
        long now=clock.instant().getEpochSecond();
        Map<String,Object> p=new LinkedHashMap<>();
        p.put("v",1);p.put("iat",now);p.put("exp",now+3600);p.put("scope",scope);p.put("fingerprint",fingerprint(scope,filter));
        Map<String,String> pos=new LinkedHashMap<>();pos.put("id",position.id().toString());pos.put("time",position.time().toString());
        if(position.score()!=null) pos.put("score",position.score().setScale(6).toPlainString());
        p.put("position",pos);
        byte[] payload=json.writeValueAsBytes(p);
        return b64(payload)+"."+b64(hmac(payload));
    }
    @SuppressWarnings("unchecked")
    public Position decode(String token,String scope,Filter filter,boolean ranked) {
        if(token==null) return null;
        try {
            if(token.isEmpty() || token.length()>2000 || !token.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) throw new IllegalArgumentException();
            String[] parts=token.split("\\.",-1);
            byte[] raw=Base64.getUrlDecoder().decode(parts[0]);byte[] signature=Base64.getUrlDecoder().decode(parts[1]);
            if(!b64(raw).equals(parts[0]) || !b64(signature).equals(parts[1]) || !MessageDigest.isEqual(signature,hmac(raw))) throw new IllegalArgumentException();
            Map<String,Object> p=json.readValue(raw,Map.class);
            if(!p.keySet().equals(Set.of("v","iat","exp","scope","fingerprint","position")) || !Integer.valueOf(1).equals(p.get("v"))) throw new IllegalArgumentException();
            long iat=integer(p.get("iat")), exp=integer(p.get("exp")),now=clock.instant().getEpochSecond();
            if(iat>now || exp<=iat || exp-iat>3600 || now>=exp || !scope.equals(p.get("scope")) || !fingerprint(scope,filter).equals(p.get("fingerprint"))) throw new IllegalArgumentException();
            Map<String,Object> pos=(Map<String,Object>)p.get("position");
            if(!pos.keySet().equals(ranked ? Set.of("id","time","score") : Set.of("id","time"))) throw new IllegalArgumentException();
            UUID id=UUID.fromString((String)pos.get("id"));if(!id.toString().equals(pos.get("id"))) throw new IllegalArgumentException();
            Instant time=Instant.parse((String)pos.get("time"));if(time.getNano()%1000!=0) throw new IllegalArgumentException();
            BigDecimal score=null;
            if(ranked) { String s=(String)pos.get("score");if(!s.matches("[0-9]{1,4}\\.[0-9]{6}"))throw new IllegalArgumentException();score=new BigDecimal(s); }
            return new Position(id,time,score);
        } catch(Exception error) { throw new ApiException(400,"invalid_cursor"); }
    }
    private long integer(Object value) {
        if(!(value instanceof Integer || value instanceof Long)) throw new IllegalArgumentException();
        return ((Number)value).longValue();
    }
    private String fingerprint(String scope,Filter f) {
        Map<String,Object> values=new LinkedHashMap<>();values.put("q",f.q());values.put("type",f.type());values.put("tag",f.tag());values.put("status",f.status());values.put("scope",scope);
        try { return b64(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(values))); }
        catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    private byte[] hmac(byte[] payload) {
        try { Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));return mac.doFinal(payload); }
        catch(GeneralSecurityException e){throw new IllegalStateException(e);}
    }
    private static String b64(byte[] bytes){return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);}
}
