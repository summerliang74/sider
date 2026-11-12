FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml ./
RUN mvn -B -ntp dependency:go-offline
COPY src ./src
RUN mvn -B -ntp -DskipTests package

FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app
RUN groupadd --gid 10001 sider && useradd --uid 10001 --gid 10001 --no-create-home sider \
    && mkdir -p /app/tmp && chown -R 10001:10001 /app
COPY --from=build --chown=10001:10001 /build/target/sider-1.0.0.jar /app/sider.jar
ENV SPRING_PROFILES_ACTIVE=production SERVER_ADDRESS=0.0.0.0 SERVER_PORT=8080 \
    JAVA_TOOL_OPTIONS="-XX:InitialRAMPercentage=10 -XX:MaxRAMPercentage=60 -Djava.io.tmpdir=/app/tmp"
USER 10001:10001
EXPOSE 8080
CMD ["java", "-jar", "/app/sider.jar"]
