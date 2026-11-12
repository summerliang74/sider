package com.sider.resources;

import com.sider.admin.AdminController;
import com.sider.admin.AdminRepository;
import com.sider.auth.CurrentUser;
import com.sider.security.SecurityGate;
import com.sider.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class WorkspaceViewTest {
    private final CurrentUser user=new CurrentUser(UUID.randomUUID(),"Synthetic",null,null,"test","admin");
    private final SecurityGate gate=mock(SecurityGate.class);
    private final ResourceRepository resources=mock(ResourceRepository.class);
    private final AdminRepository admin=mock(AdminRepository.class);
    private final ResourceController resourceController=new ResourceController(resources,gate);
    private final AdminController adminController=new AdminController(admin,gate);

    WorkspaceViewTest(){when(gate.authorize(any(),anyString(),nullable(String.class),eq(true))).thenReturn(user);}
    private static MockHttpServletRequest query(String...pairs){
        var request=new MockHttpServletRequest();
        for(int i=0;i<pairs.length;i+=2)request.addParameter(pairs[i],pairs[i+1]);
        return request;
    }
    @Test void workspaceIsExplicitAndPreservesDefaultPagedCalls(){
        resourceController.mine(query());adminController.reports(query());adminController.audit(query());
        verify(resources).mine(user,"all",null,false);verify(admin).reports(user,"open",null,false);verify(admin).audit(user,null,false);
        resourceController.mine(query("view","workspace","status","all"));
        adminController.reports(query("view","workspace","status","open"));adminController.audit(query("view","workspace"));
        verify(resources).mine(user,"all",null,true);verify(admin).reports(user,"open",null,true);verify(admin).audit(user,null,true);
    }
    @Test void dashboardAuthorizesBeforeLoadingAndValidatesRange(){
        adminController.dashboard(query());verify(admin).dashboard("7d");
        for(String range:List.of("24h","30d")){adminController.dashboard(query("range",range));verify(admin).dashboard(range);}
        for(var request:List.of(query("range","1d"),query("range",""),query("range","7d","cursor","x"),query("range","7d","range","30d"))){
            assertEquals("invalid_query",assertThrows(ApiException.class,()->adminController.dashboard(request)).code());
        }
        clearInvocations(admin);
        doThrow(new ApiException(403,"forbidden")).when(gate).authorize(any(),eq("admin"),nullable(String.class),eq(true));
        assertThrows(ApiException.class,()->adminController.dashboard(query()));verifyNoInteractions(admin);
    }
    @Test void workspaceRejectsCursorsFilteredStatusesAndAnyOtherView(){
        for(var request:List.of(query("view","Workspace"),query("view",""),query("view","workspace","cursor",""),query("view","workspace","status","scanning"),query("view","workspace","view","workspace"))){
            var error=assertThrows(ApiException.class,()->resourceController.mine(request));assertEquals("invalid_query",error.code());
        }
        for(var request:List.of(query("view","other"),query("view","workspace","cursor","opaque"),query("view","workspace","status","resolved"))){
            var error=assertThrows(ApiException.class,()->adminController.reports(request));assertEquals("invalid_query",error.code());
        }
        for(var request:List.of(query("view","other"),query("view","workspace","cursor",""),query("view","workspace","status","open"))){
            var error=assertThrows(ApiException.class,()->adminController.audit(request));assertEquals("invalid_query",error.code());
        }
        verifyNoInteractions(resources,admin);
    }
}
