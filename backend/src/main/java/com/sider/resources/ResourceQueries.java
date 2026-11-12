package com.sider.resources;

import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;

public final class ResourceQueries {
    private ResourceQueries() {}
    public record Search(String q,String type,String tag,String cursor) {
        public CursorService.Filter filter(){return new CursorService.Filter(q,type,tag==null?null:ResourcePolicy.isPaTag(tag)?"PA":ResourcePolicy.trim(tag).toLowerCase(Locale.ROOT),null);}
    }
    public static void only(HttpServletRequest request,String... names) {
        Set<String> allowed=Set.of(names);
        request.getParameterMap().forEach((key,values)->{if(!allowed.contains(key)||values.length!=1)throw new ApiException(400,"invalid_query");});
    }
    public static Search search(HttpServletRequest request) {
        only(request,"q","type","tag","collection","cursor");
        String q=ResourcePolicy.text(Optional.ofNullable(request.getParameter("q")).orElse(""),0,120,"invalid_query");
        String type=request.getParameter("type");if(type!=null&&!ResourcePolicy.MIME_TYPES.containsKey(type))throw new ApiException(400,"invalid_query");
        String collection=request.getParameter("collection");if(collection!=null&&!collection.equals("peer-advisors"))throw new ApiException(400,"invalid_query");
        String tag=request.getParameter("tag");if(tag!=null)tag=ResourcePolicy.canonicalTag(ResourcePolicy.text(tag,1,30,"invalid_query"));else if(collection!=null)tag="PA";
        return new Search(q,type,tag,request.getParameter("cursor"));
    }
    public static String status(HttpServletRequest request,String fallback,Set<String> allowed) {
        String status=Optional.ofNullable(request.getParameter("status")).orElse(fallback);
        if(!allowed.contains(status))throw new ApiException(400,"invalid_query");return status;
    }
}
