package com.sider.uploads;

import com.sider.security.SecurityGate;
import com.sider.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/resources")
public class UploadController {
    public record Intent(String title,String description,List<String> tags,String originalFilename,Long sizeBytes,String mimeType,String botToken) {}
    public record Bot(String botToken) {}
    public record Statuses(List<UUID> ids) {}
    private final SecurityGate gate;
    private final UploadService uploads;
    public UploadController(SecurityGate gate,UploadService uploads){this.gate=gate;this.uploads=uploads;}
    @PostMapping(value="/upload-intents",consumes="application/json") public ResponseEntity<?> create(HttpServletRequest request,@RequestBody Intent body){
        var user=gate.authorize(request,"upload",body.botToken(),true);
        return ResponseEntity.status(201).body(uploads.create(user,request,body));
    }
    @PostMapping(value="/{id}/complete",consumes="application/json") public ResponseEntity<?> complete(HttpServletRequest request,@PathVariable String id,@RequestBody Bot body){
        var user=gate.authorize(request,"complete",body.botToken(),true);
        var state=uploads.complete(user,request,id(id));
        return ResponseEntity.status("scanning".equals(state.get("status"))?202:200).body(state);
    }
    @PostMapping(value="/upload-status",consumes="application/json") public Object status(HttpServletRequest request,@RequestBody Statuses body){return uploads.statuses(gate.authorize(request,"upload_status",null,false),body.ids());}
    @PostMapping(value="/{id}/download",consumes="application/json") public Object download(HttpServletRequest request,@PathVariable String id,@RequestBody Bot body){return uploads.download(gate.authorize(request,"download",body.botToken(),true),request,id(id));}
    @PutMapping("/{id}/upload") public ResponseEntity<?> legacy(HttpServletRequest request,@PathVariable String id)throws IOException {
        var user=gate.authorize(request,"upload_transfer",null,false);
        uploads.legacyUpload(user,request,id(id),request.getContentType(),request.getContentLengthLong(),request.getInputStream());
        return ResponseEntity.noContent().build();
    }
    private UUID id(String id){try{return UUID.fromString(id);}catch(Exception e){throw new ApiException(404,"resource_unavailable");}}
}
