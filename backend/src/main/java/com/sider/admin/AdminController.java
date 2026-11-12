package com.sider.admin;

import com.sider.resources.*;
import com.sider.security.SecurityGate;
import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
public class AdminController {
    private final AdminRepository admin;
    private final SecurityGate gate;
    public AdminController(AdminRepository admin,SecurityGate gate){this.admin=admin;this.gate=gate;}
    @GetMapping("/api/admin/dashboard") public Map<String,Object> dashboard(HttpServletRequest request){
        gate.authorize(request,"admin",request.getHeader("x-bot-token"),true);
        ResourceQueries.only(request,"range");
        String range=request.getParameter("range");if(range==null)range="7d";
        if(!Set.of("24h","7d","30d").contains(range))throw new ApiException(400,"invalid_query");
        return admin.dashboard(range);
    }
    @GetMapping("/api/admin/reports") public Map<String,Object> reports(HttpServletRequest request){
        var user=gate.authorize(request,"admin",request.getHeader("x-bot-token"),true);ResourceQueries.only(request,"status","cursor","view");return admin.reports(user,ResourceQueries.status(request,"open",Set.of("open","resolved","dismissed")),request.getParameter("cursor"),workspace(request,"open"));
    }
    @GetMapping("/api/admin/audit") public Map<String,Object> audit(HttpServletRequest request){
        var user=gate.authorize(request,"admin",request.getHeader("x-bot-token"),true);ResourceQueries.only(request,"cursor","view");return admin.audit(user,request.getParameter("cursor"),workspace(request,null));
    }
    private static boolean workspace(HttpServletRequest request,String defaultStatus){
        String view=request.getParameter("view");if(view==null)return false;
        if(!"workspace".equals(view)||request.getParameterMap().containsKey("cursor")||(request.getParameter("status")!=null&&!request.getParameter("status").equals(defaultStatus)))throw new ApiException(400,"invalid_query");
        return true;
    }
    @PostMapping(value="/api/admin/resources/{id}/moderate",consumes=MediaType.APPLICATION_JSON_VALUE)
    public Map<String,Object> moderate(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request){
        ResourceBodies.only(body,"invalid_action","action","reason","reportId","botToken");var actor=gate.authorize(request,"admin",ResourceBodies.bot(body),true);ResourceQueries.only(request);
        String action=ResourceBodies.string(body,"action",true,"invalid_action");if(!Set.of("hide","restore","remove").contains(action))throw new ApiException(400,"invalid_action");
        String reason=ResourcePolicy.sanitizeAuditText(ResourcePolicy.text(ResourceBodies.string(body,"reason",true,"invalid_action"),1,1000,"invalid_action"));
        String rawReport=ResourceBodies.string(body,"reportId",false,"invalid_action");UUID report=null;
        if(rawReport!=null)try{report=ResourcePolicy.id(rawReport,"invalid_action");}catch(ApiException e){throw new ApiException(400,"invalid_action");}
        return admin.moderate(ResourcePolicy.id(id,"resource_unavailable"),actor,request,action,reason,report);
    }
    @PostMapping(value="/api/admin/reports/{id}",consumes=MediaType.APPLICATION_JSON_VALUE)
    public Map<String,Object> dismiss(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request){
        ResourceBodies.only(body,"invalid_action","note","botToken");var actor=gate.authorize(request,"admin",ResourceBodies.bot(body),true);ResourceQueries.only(request);
        String note=ResourcePolicy.sanitizeAuditText(ResourcePolicy.text(ResourceBodies.string(body,"note",true,"invalid_action"),1,1000,"invalid_action"));
        return admin.dismiss(ResourcePolicy.id(id,"report_unavailable"),actor,request,note);
    }
    @PostMapping(value="/api/admin/users/{id}/suspend",consumes=MediaType.APPLICATION_JSON_VALUE)
    public Map<String,Object> suspend(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request){
        ResourceBodies.only(body,"invalid_action","reason","botToken");var actor=gate.authorize(request,"admin",ResourceBodies.bot(body),true);ResourceQueries.only(request);
        String reason=ResourcePolicy.sanitizeAuditText(ResourcePolicy.text(ResourceBodies.string(body,"reason",true,"invalid_action"),1,1000,"invalid_action"));
        return admin.suspend(ResourcePolicy.id(id,"user_unavailable"),actor,request,reason);
    }
}
