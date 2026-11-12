package com.sider.resources;

import com.sider.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ResourceQueriesTest {
    @Test void explicitTagOverridesLegacyCollectionAndAliasesHaveSameFingerprint() {
        var request=new MockHttpServletRequest();request.addParameter("collection","peer-advisors");
        var legacy=ResourceQueries.search(request);assertEquals("PA",legacy.tag());
        request.addParameter("tag"," Notes ");assertEquals("Notes",ResourceQueries.search(request).tag());
        var aliases=new MockHttpServletRequest();aliases.addParameter("tag","ＰＡ");assertEquals(legacy.filter(),ResourceQueries.search(aliases).filter());
    }
    @Test void unknownRepeatedAndEmptyInputsDoNotSilentlyChangeQuery() {
        for(Map<String,String[]> parameters:List.of(Map.of("sort",new String[]{"newest"}),Map.of("q",new String[]{"a","b"}),Map.of("tag",new String[]{" "}),Map.of("type",new String[]{"PDF"}),Map.of("fileType",new String[]{"pdf"}))) {
            var request=new MockHttpServletRequest();parameters.forEach(request::addParameter);
            assertThrows(ApiException.class,()->ResourceQueries.search(request));
        }
    }
    @Test void highlightsRemainDataIncludingMaliciousHtml() {
        var segments=ResourceRepository.segments("<img src=x onerror=alert(1)> \uE000physics\uE001 & notes");
        assertEquals("<img src=x onerror=alert(1)> ",segments.getFirst().get("text"));
        assertEquals(false,segments.getFirst().get("highlighted"));assertEquals(Map.of("text","physics","highlighted",true),segments.get(1));
    }
}
