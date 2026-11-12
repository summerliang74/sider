package com.sider.uploads;

import com.sider.config.SiderConfig;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;

class S3SignatureTest {
    private SiderConfig env(){return new SiderConfig(new MockEnvironment().withProperty("S3_BUCKET","test-bucket").withProperty("S3_REGION","us-east-1")
        .withProperty("S3_ACCESS_KEY_ID","synthetic-access").withProperty("S3_SECRET_ACCESS_KEY","synthetic-secret-not-production").withProperty("S3_ENDPOINT","https://storage.test").withProperty("S3_FORCE_PATH_STYLE","true"));}
    @Test void putBindsSizeMimeAndIdentityWithoutStorageNetwork(){
        var store=new S3ObjectStore(env());try{
            UUID id=UUID.randomUUID();var signed=store.uploadUrl("pending/"+id+"/fixture",id,"application/pdf",123);
            String query=URLDecoder.decode(URI.create((String)signed.get("uploadUrl")).getRawQuery(),StandardCharsets.UTF_8);
            assertTrue(query.contains("X-Amz-Expires=300"));assertTrue(query.contains("content-length"));assertTrue(query.contains("content-type"));assertTrue(query.contains("x-amz-meta-resource"));
            assertFalse(query.contains("synthetic-secret-not-production"));assertEquals(300,signed.get("expiresIn"));
        }finally{store.close();}
    }
    @Test void downloadExpiresAndEscapesUnicodeFilename(){
        var store=new S3ObjectStore(env());try{
            var signed=store.downloadUrl("active/fixture","资料\".pdf");
            String query=URLDecoder.decode(URI.create((String)signed.get("url")).getRawQuery(),StandardCharsets.UTF_8);
            assertTrue(query.contains("X-Amz-Expires=120"));assertTrue(query.contains("attachment;"));assertTrue(query.contains("filename*=UTF-8''"));
        }finally{store.close();}
    }
}
