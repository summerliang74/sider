package com.sider.security;

import com.sider.web.ApiException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.List;
import java.nio.ByteBuffer;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** Bounded deadlines, no redirects or raw upstream error/token logging. */
@Component
public class RemoteJson {
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final ObjectMapper mapper;

    public RemoteJson(ObjectMapper mapper) { this.mapper = mapper; }

    public record Result(int status, Map<String, Object> body) {}

    @SuppressWarnings("unchecked")
    public Result call(HttpRequest request, int timeoutSeconds, String failureCode) {
        try {
            HttpResponse<byte[]> response = client.sendAsync(request, ignored -> new LimitedSubscriber())
                    .orTimeout(timeoutSeconds, TimeUnit.SECONDS).join();
            if (response.body().length > 262144) throw new ApiException(503, failureCode);
            if (response.statusCode() < 200 || response.statusCode() >= 300) return new Result(response.statusCode(), Map.of());
            Map<String, Object> body = mapper.readValue(response.body(), Map.class);
            if (body == null) throw new ApiException(503, failureCode);
            return new Result(response.statusCode(), body);
        } catch (ApiException error) { throw error; }
        catch (RuntimeException error) { throw new ApiException(503, failureCode); }
    }

    private static final class LimitedSubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
        private Flow.Subscription subscription;
        private int count;
        private boolean failed;
        @Override public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
        @Override public void onSubscribe(Flow.Subscription value) { subscription = value; delegate.onSubscribe(value); }
        @Override public void onNext(List<ByteBuffer> buffers) {
            if (failed) return;
            for (ByteBuffer buffer : buffers) {
                if (buffer.remaining() > 262144 - count) {
                    failed = true; subscription.cancel(); delegate.onError(new java.io.IOException("upstream_response_too_large")); return;
                }
                count += buffer.remaining();
            }
            delegate.onNext(buffers);
        }
        @Override public void onError(Throwable error) { if (!failed) { failed = true; delegate.onError(error); } }
        @Override public void onComplete() { if (!failed) delegate.onComplete(); }
    }
}
