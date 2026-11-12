package com.sider;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SiderApplication {
    public static void main(String[] args) { SpringApplication.run(SiderApplication.class, args); }
}
