package com.sider.uploads;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class FilePolicyTest {
    @Test void acceptsOnlyMatchingExtensionAndMime(){
        assertTrue(FilePolicy.allowed("notes.PDF","application/pdf"));
        assertFalse(FilePolicy.allowed("notes.docm","application/vnd.ms-word.document.macroEnabled.12"));
        assertFalse(FilePolicy.allowed("notes.pdf.exe","application/pdf"));
        assertFalse(FilePolicy.allowed("notes.pdf","text/plain"));
    }
    @Test void stripsTraversalAndControls(){assertEquals("notes.pdf",FilePolicy.filename("../../notes\u0000.pdf"));assertEquals("全角.pdf",FilePolicy.filename("全角．pdf"));}
    @Test void headRequiresSizeTypeIdentityAndEtag(){
        UUID id=UUID.randomUUID();
        assertTrue(new ObjectStore.Head(10,"text/plain",id.toString(),"etag").matches(id,10,"text/plain"));
        assertFalse(new ObjectStore.Head(10,"text/plain",id.toString(),null).matches(id,10,"text/plain"));
        assertFalse(new ObjectStore.Head(11,"text/plain",id.toString(),"etag").matches(id,10,"text/plain"));
        assertFalse(new ObjectStore.Head(10,"text/plain",UUID.randomUUID().toString(),"etag").matches(id,10,"text/plain"));
    }
}
