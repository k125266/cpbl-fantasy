# 多階段建置：前端 → 後端 jar
FROM node:24 AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN mkdir -p /src/server/src/main/resources && npm run build

FROM maven:3.9-eclipse-temurin-21 AS server
WORKDIR /src/server
COPY server/pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY server/src ./src
COPY --from=web /src/server/src/main/resources/static ./src/main/resources/static
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=server /src/server/target/cpbl-fantasy-server-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
