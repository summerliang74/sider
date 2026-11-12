package com.sider.uploads;

import com.sider.web.ApiException;
import java.text.Normalizer;
import java.util.*;

public final class FilePolicy {
    private FilePolicy() {}
    public static final Map<String,String> MIME = Map.of(
        "pdf", "application/pdf", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "txt", "text/plain",
        "png", "image/png", "jpg", "image/jpeg", "jpeg", "image/jpeg");
    public static String filename(String input) {
        if (input == null || input.isBlank() || input.length() > 255) throw new ApiException(400, "invalid_upload");
        String n = Normalizer.normalize(input, Normalizer.Form.NFKC).replaceAll("^.*[\\\\/]", "")
            .replaceAll("[\\p{Cntrl}]", "").replaceAll("[^\\p{L}\\p{N}._()\\- ]", "_").replaceAll("\\s+", " ").trim();
        if (n.isEmpty()) n = "file";
        return n.substring(0, Math.min(255, n.length()));
    }
    public static boolean allowed(String filename, String mime) {
        int dot = filename.lastIndexOf('.');
        return dot >= 0 && Objects.equals(MIME.get(filename.substring(dot+1).toLowerCase(Locale.ROOT)), mime);
    }
    public static String outputKey(UUID id, String snapshot) { return "active/" + id + "/" + snapshot.substring(snapshot.lastIndexOf('/')+1); }
}
