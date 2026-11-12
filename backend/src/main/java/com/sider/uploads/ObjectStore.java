package com.sider.uploads;

import java.io.InputStream;
import java.util.*;

public interface ObjectStore {
    record Head(long length, String mimeType, String resourceId, String etag) {
        public boolean matches(UUID id, long size, String mime) { return length == size && Objects.equals(mimeType, mime) && Objects.equals(resourceId, id.toString()) && etag != null && !etag.isBlank(); }
    }
    Head head(String key);
    void copy(String source, String target, String etag);
    void delete(String key);
    Map<String,Object> uploadUrl(String key, UUID id, String mime, long size);
    Map<String,Object> downloadUrl(String key, String filename);
    void upload(String key, UUID id, String mime, long size, InputStream body);
    record Key(String key,java.time.Instant modified) {}
    record Page(List<Key> items,String next) {}
    Page list(String prefix,String continuation);
    void check();
}
