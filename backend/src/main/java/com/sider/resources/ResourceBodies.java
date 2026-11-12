package com.sider.resources;

import com.sider.web.ApiException;
import java.util.*;

public final class ResourceBodies {
    private ResourceBodies() {}
    public static void only(Map<String,Object> body,String error,String... names){if(body==null||!Set.of(names).containsAll(body.keySet()))throw new ApiException(400,error);}
    public static String string(Map<String,Object> body,String key,boolean required,String error){Object value=body.get(key);if(value==null&&!body.containsKey(key)&&!required)return null;if(!(value instanceof String s))throw new ApiException(400,error);return s;}
    public static List<String> tags(Map<String,Object> body){Object value=body.get("tags");if(!(value instanceof List<?> list)||list.stream().anyMatch(x->!(x instanceof String)))throw new ApiException(400,"invalid_metadata");return list.stream().map(x->(String)x).toList();}
    public static String bot(Map<String,Object> body){return ResourcePolicy.botToken(string(body,"botToken",false,"invalid_request"));}
}
