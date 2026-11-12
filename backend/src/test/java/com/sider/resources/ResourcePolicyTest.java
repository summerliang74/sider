package com.sider.resources;

import com.sider.auth.CurrentUser;
import com.sider.web.ApiException;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ResourcePolicyTest {
    private final CurrentUser student=new CurrentUser(UUID.randomUUID(),"Student",null,null,"org","student");
    private final CurrentUser admin=new CurrentUser(UUID.randomUUID(),"Admin",null,null,"org","admin");
    @Test void everyReservedAliasIsBlockedBeforeNormalizationCanHideIt() {
        for(String alias:List.of("PA","p.a.","ＰＡ","peer-advisor","peer advisors"," Peer_Advisors ")) {
            var e=assertThrows(ApiException.class,()->ResourcePolicy.validate("A","",List.of("Notes",alias),student));
            assertEquals(403,e.status());assertEquals("pa_tag_admin_only",e.code());
            assertEquals(List.of("PA"),ResourcePolicy.validate("A","",List.of(alias),admin).tags());
        }
    }
    @Test void metadataUsesUtf16LimitsTrimsEcmaWhitespaceAndDeduplicatesWithoutTruncating() {
        var value=ResourcePolicy.validate("\uFEFF\u00a0 Title \u00a0"," \n description ",List.of(" Notes ","notes","REVISION"),student);
        assertEquals("Title",value.title());assertEquals("description",value.description());assertEquals(List.of("Notes","REVISION"),value.tags());
        assertEquals(120,ResourcePolicy.validate("😀".repeat(60),"",List.of(),student).title().length());
        assertThrows(ApiException.class,()->ResourcePolicy.validate("😀".repeat(61),"",List.of(),student));
        assertThrows(ApiException.class,()->ResourcePolicy.validate("a","",Collections.nCopies(11,"Notes"),student));
        assertThrows(ApiException.class,()->ResourcePolicy.validate("a",null,List.of(),student));
        assertThrows(ApiException.class,()->ResourcePolicy.validate("a","",Arrays.asList("a",null),student));
    }
    @Test void literalLikeInputIsEscapedAndAuditCannotLeakCredentials() {
        assertEquals("100\\%\\_\\\\",ResourcePolicy.escapeLike("100%_\\"));
        String original="reason https://storage.test/key?X-Amz-Signature=abc "+"A".repeat(43);
        String safe=ResourcePolicy.sanitizeAuditText(original);
        assertFalse(safe.contains("https://"));assertFalse(safe.contains("Signature"));assertFalse(safe.contains("A".repeat(43)));
        assertTrue(ResourcePolicy.sanitizeAuditText("http://a ".repeat(200)).length()<=1000);
    }
    @Test void shortUuidAndUnknownBodyFieldsAreRejected() {
        assertThrows(ApiException.class,()->ResourcePolicy.id("1-1-1-1-1","resource_unavailable"));
        assertThrows(ApiException.class,()->ResourceBodies.only(Map.of("role","admin"),"invalid_metadata","title","description","tags"));
        assertThrows(ApiException.class,()->ResourceBodies.tags(Map.of("tags",List.of(12))));
        assertThrows(ApiException.class,()->ResourceBodies.string(new HashMap<>(Collections.singletonMap("details",null)),"details",false,"invalid_report"));
    }
}
