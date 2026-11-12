package com.sider.uploads;

import com.sider.config.SiderConfig;
import com.sider.web.ApiException;
import jakarta.annotation.PreDestroy;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.*;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.*;

@Component
public class S3ObjectStore implements ObjectStore {
    private final S3Client client;
    private final S3Presigner signer;
    private final String bucket;
    public S3ObjectStore(SiderConfig env) {
        bucket = env.text("S3_BUCKET");
        var credentials = StaticCredentialsProvider.create(AwsBasicCredentials.create(env.text("S3_ACCESS_KEY_ID"), env.text("S3_SECRET_ACCESS_KEY")));
        var config = S3Configuration.builder().pathStyleAccessEnabled(env.flag("S3_FORCE_PATH_STYLE", false)).build();
        URI endpoint = URI.create(env.text("S3_ENDPOINT"));
        client = S3Client.builder().region(Region.of(env.text("S3_REGION"))).endpointOverride(endpoint).credentialsProvider(credentials).serviceConfiguration(config)
            .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
            .httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(5)).socketTimeout(Duration.ofSeconds(120)))
            .overrideConfiguration(ClientOverrideConfiguration.builder().apiCallTimeout(Duration.ofSeconds(15)).build()).build();
        signer = S3Presigner.builder().region(Region.of(env.text("S3_REGION"))).endpointOverride(endpoint).credentialsProvider(credentials).serviceConfiguration(config).build();
    }
    @Override public Head head(String key) {
        try { var h = client.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build()); return new Head(h.contentLength(), h.contentType(), h.metadata().get("resource"), h.eTag()); }
        catch (S3Exception e) { if (e.statusCode()==404) throw new ApiException(409,"object_missing"); throw new ApiException(503,"upload_unavailable"); }
    }
    @Override public void copy(String source, String target, String etag) {
        client.copyObject(CopyObjectRequest.builder().bucket(bucket).key(target).sourceBucket(bucket).sourceKey(source).copySourceIfMatch(etag).metadataDirective(MetadataDirective.COPY).build());
    }
    @Override public void delete(String key) { client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build()); }
    @Override public Map<String,Object> uploadUrl(String key, UUID id, String mime, long size) {
        var put = PutObjectRequest.builder().bucket(bucket).key(key).contentType(mime).contentLength(size).metadata(Map.of("resource",id.toString())).build();
        var signed = signer.presignPutObject(PutObjectPresignRequest.builder().signatureDuration(Duration.ofSeconds(300)).putObjectRequest(put).build());
        // Fail closed if SDK changes stop binding these fields into the signature.
        String signedHeaders = signed.httpRequest().rawQueryParameters().getOrDefault("X-Amz-SignedHeaders",List.of("")).getFirst();
        if (!signedHeaders.contains("content-length") || !signedHeaders.contains("content-type") || !signedHeaders.contains("x-amz-meta-resource")) throw new ApiException(503,"upload_unavailable");
        return Map.of("resourceId",id,"uploadUrl",signed.url().toString(),"expiresIn",300,"headers",Map.of("content-type",mime,"x-amz-meta-resource",id.toString()));
    }
    @Override public Map<String,Object> downloadUrl(String key, String filename) {
        String ascii = filename.replaceAll("[^\\x20-\\x7e]", "_").replace('"','_').replace('\\','_');
        var get = GetObjectRequest.builder().bucket(bucket).key(key).responseContentDisposition("attachment; filename=\""+ascii+"\"; filename*=UTF-8''"+encode(filename)).build();
        var signed = signer.presignGetObject(GetObjectPresignRequest.builder().signatureDuration(Duration.ofSeconds(120)).getObjectRequest(get).build());
        return Map.of("url",signed.url().toString(),"expiresIn",120);
    }
    @Override public void upload(String key, UUID id, String mime, long size, InputStream body) {
        client.putObject(PutObjectRequest.builder().bucket(bucket).key(key).contentType(mime).contentLength(size).metadata(Map.of("resource",id.toString()))
            .overrideConfiguration(c->c.apiCallTimeout(Duration.ofSeconds(120))).build(),RequestBody.fromInputStream(body,size));
    }
    @Override public void check() { client.listObjectsV2(ListObjectsV2Request.builder().bucket(bucket).prefix("pending/").maxKeys(1).build()); }
    @Override public Page list(String prefix,String continuation) {
        var response=client.listObjectsV2(ListObjectsV2Request.builder().bucket(bucket).prefix(prefix).continuationToken(continuation).maxKeys(200).build());
        return new Page(response.contents().stream().map(o->new Key(o.key(),o.lastModified())).toList(),response.nextContinuationToken());
    }
    private static String encode(String s) { return URLEncoder.encode(s,StandardCharsets.UTF_8).replace("+","%20"); }
    @PreDestroy public void close() { signer.close(); client.close(); }
}
