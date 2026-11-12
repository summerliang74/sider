package com.sider.resources;

import tools.jackson.databind.json.JsonMapper;
import com.sider.web.ApiException;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class CursorServiceTest {
    private final byte[] key="independent-cursor-signing-key-32-bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    private final Instant now=Instant.parse("2026-11-11T02:00:00Z");
    private CursorService service(Instant at){return new CursorService(key,JsonMapper.builder().build(),Clock.fixed(at,ZoneOffset.UTC));}
    private final CursorService.Filter filter=new CursorService.Filter("notes","pdf","PA",null);
    @Test void preciseMicrosecondAndDecimalSortKeysSurviveRoundTrip() {
        var pos=new CursorService.Position(UUID.randomUUID(),Instant.parse("2026-11-10T02:00:00.123456Z"),new BigDecimal("118.123456"));
        String cursor=service(now).encode("resources",filter,pos);assertTrue(cursor.length()<2000);
        assertEquals(pos,service(now).decode(cursor,"resources",filter,true));
    }
    @Test void scopeFiltersSignatureAndExpiryCannotBeReused() {
        var pos=new CursorService.Position(UUID.randomUUID(),now,new BigDecimal("0.000000"));
        var svc=service(now);String cursor=svc.encode("resources",filter,pos);
        for(Runnable decode:List.<Runnable>of(
            ()->svc.decode(cursor,"mine:other",filter,true),
            ()->svc.decode(cursor,"resources",new CursorService.Filter("other","pdf","PA",null),true),
            ()->svc.decode("X"+cursor.substring(1),"resources",filter,true),
            ()->service(now.plusSeconds(3600)).decode(cursor,"resources",filter,true),
            ()->service(now.minusSeconds(1)).decode(cursor,"resources",filter,true),
            ()->svc.decode(cursor,"resources",filter,false),
            ()->svc.decode("e30","resources",filter,true),
            ()->svc.decode(" "+cursor,"resources",filter,true),
            ()->svc.decode("a".repeat(2001),"resources",filter,true)
        ))assertEquals("invalid_cursor",assertThrows(ApiException.class,decode::run).code());
    }
    @Test void ownerAndStatusAreBoundForNonRankedLists() {
        var pos=new CursorService.Position(UUID.randomUUID(),now,null);
        var f=new CursorService.Filter(null,null,null,"all");var svc=service(now);String token=svc.encode("mine:user1",f,pos);
        assertEquals(pos,svc.decode(token,"mine:user1",f,false));
        assertThrows(ApiException.class,()->svc.decode(token,"mine:user2",f,false));
        assertThrows(ApiException.class,()->svc.decode(token,"mine:user1",new CursorService.Filter(null,null,null,"active"),false));
    }
}
