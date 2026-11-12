package com.sider.config;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class DatabaseUrlTest {
    @Test void credentialsAreDecodedOnceAndNeverEmbeddedInJdbcUrl(){
        var u=DatabaseUrl.parse("postgresql://u:p%40ss%3Aword+plus%2520@localhost:5432/sider?sslmode=disable",false);
        assertEquals("p@ss:word+plus%20",u.password());assertEquals("jdbc:postgresql://localhost:5432/sider",u.jdbcUrl());
        assertFalse(u.toString().contains("p@ss"));
    }
    @Test void rejectsUnverifiedTlsAndDriverInjection(){
        for(String suffix:new String[]{"sslmode=require","sslmode=verify-ca","sslmode=verify-full&user=other","sslmode=verify-full&sslmode=disable","sslmode=verify-full&sslfactory=evil"}){
            var e=assertThrows(IllegalStateException.class,()->DatabaseUrl.parse("postgresql://u:SECRET@db.test/app?"+suffix,true));
            assertFalse(e.getMessage().contains("SECRET"));
        }
    }
    @Test void ipv6AndTlsPropertiesWork(){
        var u=DatabaseUrl.parse("postgresql://u:p@[::1]:5543/app?sslmode=disable",false);
        assertEquals("jdbc:postgresql://[::1]:5543/app",u.jdbcUrl());
        var production=DatabaseUrl.parse("postgresql://u:p@db.test/app?channel_binding=require",true).properties();
        assertEquals("verify-full",production.get("sslmode"));
        assertEquals("require",production.get("channelBinding"));
        assertEquals("org.postgresql.ssl.DefaultJavaSSLFactory",production.get("sslfactory"));
        assertFalse(DatabaseUrl.parse("postgresql://u:p@db.test/app?sslmode=verify-full&sslrootcert=%2Fca.pem",true)
                .properties().containsKey("sslfactory"));
        assertThrows(IllegalStateException.class,()->DatabaseUrl.parse(
                "postgresql://u:p@db.test/app?channel_binding=require&channelBinding=prefer",true));
    }
}
