package com.sider.resources;

import com.sider.auth.CurrentUser;
import com.sider.security.SecurityGate;
import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
public class ResourceController {
    private final ResourceRepository resources;
    private final SecurityGate gate;
    public ResourceController(ResourceRepository resources,SecurityGate gate){this.resources=resources;this.gate=gate;}
    private CurrentUser read(HttpServletRequest request){return gate.authorize(request,"search",request.getHeader("x-bot-token"),true);}
    @GetMapping("/api/resources") public Map<String,Object> search(HttpServletRequest request){read(request);return resources.search(ResourceQueries.search(request));}
    @GetMapping("/api/resources/tags") public Map<String,Object> tags(HttpServletRequest request){read(request);ResourceQueries.only(request);return resources.tags();}
    @GetMapping("/api/resources/{id}") public Map<String,Object> detail(@PathVariable String id,HttpServletRequest request){var user=read(request);ResourceQueries.only(request);return resources.detail(ResourcePolicy.id(id,"resource_unavailable"),user);}
    @GetMapping("/api/me/resources") public Map<String,Object> mine(HttpServletRequest request){
        var user=read(request);ResourceQueries.only(request,"status","cursor","view");
        String status=ResourceQueries.status(request,"all",Set.of("all","active","scanning","unavailable"));
        String view=request.getParameter("view");boolean workspace=view!=null;
        if(workspace&&(!"workspace".equals(view)||request.getParameterMap().containsKey("cursor")||!"all".equals(status)))throw new ApiException(400,"invalid_query");
        return resources.mine(user,status,request.getParameter("cursor"),workspace);
    }
    @PatchMapping(value="/api/resources/{id}",consumes=MediaType.APPLICATION_JSON_VALUE)
    public Map<String,Object> update(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request){
        ResourceBodies.only(body,"invalid_metadata","title","description","tags","botToken");
        var user=gate.authorize(request,"resource_write",ResourceBodies.bot(body),true);ResourceQueries.only(request);
        var metadata=ResourcePolicy.validate(ResourceBodies.string(body,"title",true,"invalid_metadata"),ResourceBodies.string(body,"description",true,"invalid_metadata"),ResourceBodies.tags(body),user);
        return resources.update(ResourcePolicy.id(id,"resource_unavailable"),user,request,metadata);
    }
    @DeleteMapping("/api/resources/{id}") public Map<String,Object> delete(@PathVariable String id,HttpServletRequest request){
        var user=gate.authorize(request,"resource_write",request.getHeader("x-bot-token"),true);ResourceQueries.only(request);return resources.delete(ResourcePolicy.id(id,"resource_unavailable"),user,request);
    }
    @PostMapping(value="/api/resources/{id}/reports",consumes=MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String,Object>> report(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request){
        ResourceBodies.only(body,"invalid_report","reason","details","botToken");var user=gate.authorize(request,"report",ResourceBodies.bot(body),true);ResourceQueries.only(request);
        String reason=ResourceBodies.string(body,"reason",true,"invalid_report");if(!Set.of("copyright_privacy","malware","inappropriate","spam","other").contains(reason))throw new ApiException(400,"invalid_report");
        String details=Optional.ofNullable(ResourceBodies.string(body,"details",false,"invalid_report")).orElse("");details=ResourcePolicy.text(details,0,1000,"invalid_report");
        return ResponseEntity.status(201).body(resources.report(ResourcePolicy.id(id,"resource_unavailable"),user,request,reason,details));
    }
}
