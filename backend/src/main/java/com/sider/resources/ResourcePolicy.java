package com.sider.resources;

import com.sider.auth.CurrentUser;
import com.sider.web.ApiException;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;

/** All resource writes, including upload intents, use the same metadata boundary. */
public final class ResourcePolicy {
    private ResourcePolicy() {}
    private static final Pattern EDGE_SPACE = Pattern.compile("^[\\x09-\\x0D\\x20\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+|[\\x09-\\x0D\\x20\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+$");
    private static final Pattern UUID_PATTERN = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    public static final Map<String,String> MIME_TYPES = Map.of(
        "pdf", "application/pdf", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "txt", "text/plain", "png", "image/png", "jpeg", "image/jpeg");
    public static final List<String> SUGGESTED_TAGS = List.of("Notes", "Revision", "Worksheets", "Guides", "PA");
    public record Metadata(String title, String description, List<String> tags) {}
    public static String trim(String value) { return value == null ? null : EDGE_SPACE.matcher(value).replaceAll(""); }
    public static String text(String value, int min, int max, String error) {
        String normalized = trim(value);
        if (normalized == null || normalized.length() < min || normalized.length() > max) throw new ApiException(400,error);
        return normalized;
    }
    public static boolean isPaTag(String value) {
        if (value == null) return false;
        String key = Normalizer.normalize(value,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]","");
        return Set.of("pa","peeradvisor","peeradvisors").contains(key);
    }
    public static String canonicalTag(String value) { return isPaTag(value) ? "PA" : trim(value); }
    public static Metadata validate(String title, String description, List<String> tags, CurrentUser user) {
        String normalizedTitle = text(title,1,120,"invalid_metadata");
        String normalizedDescription = text(description,0,2000,"invalid_metadata");
        if (tags == null || tags.size()>10) throw new ApiException(400,"invalid_metadata");
        LinkedHashMap<String,String> unique = new LinkedHashMap<>();
        for (String raw : tags) {
            String tag = text(raw,1,30,"invalid_metadata");
            if (!"admin".equals(user.role()) && isPaTag(tag)) throw new ApiException(403,"pa_tag_admin_only");
            tag=canonicalTag(tag);
            unique.putIfAbsent(tag.toLowerCase(Locale.ROOT),tag);
        }
        return new Metadata(normalizedTitle,normalizedDescription,List.copyOf(unique.values()));
    }
    public static UUID id(String value,String error) {
        if(value == null || !UUID_PATTERN.matcher(value).matches()) throw new ApiException(404,error);
        return UUID.fromString(value);
    }
    public static String botToken(String value) {
        if(value != null && value.length()>4096) throw new ApiException(400,"invalid_request");
        return value;
    }
    public static String escapeLike(String value) { return value.replace("\\","\\\\").replace("%","\\%").replace("_","\\_"); }
    public static String sanitizeAuditText(String value) {
        String result=value.replaceAll("(?i)https?://\\S+","[redacted-url]")
            .replaceAll("\\b(?:eyJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})\\b","[redacted-token]");
        return result.substring(0,Math.min(1000,result.length()));
    }
}
