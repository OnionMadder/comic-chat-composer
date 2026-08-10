package com.onionmadder.mcomic96;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * Save a PNG into the device's photo library via MediaStore, so exported
 * comics actually appear in Gallery / Google Photos.
 *
 * The web layer used to hand the file off through `navigator.share({files})`
 * or an `<a download>` anchor. Share is a picker (the file often never lands
 * anywhere the user can find), and the anchor drops into the app-private
 * downloads dir on modern Android with no visibility in Gallery. This plugin
 * writes the bytes through the ContentResolver with a proper MediaStore
 * insert, which is the only path that both stores the file and registers it
 * with the media indexer in one step on scoped-storage Android.
 *
 * API 29+ only (Android 10+). Below that the same call would require the
 * legacy WRITE_EXTERNAL_STORAGE permission, which the app deliberately does
 * not request — the TypeScript side detects a rejection and falls back to
 * the existing Web Share / anchor flow.
 */
@CapacitorPlugin(name = "SavePhoto")
public class SavePhotoPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String base64 = call.getString("base64");
        String filename = call.getString("filename", "mcomic.png");
        String album = call.getString("album", "mComic96");

        if (base64 == null || base64.isEmpty()) {
            call.reject("Missing base64 payload");
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Pre-Android-10 would need WRITE_EXTERNAL_STORAGE. The TS caller
            // handles this reject by falling back to Web Share.
            call.reject("Gallery save needs Android 10 or newer");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);

            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(
                MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/" + album
            );
            // Mark pending so the indexer doesn't advertise a half-written file
            // to Gallery apps mid-copy. Cleared after the write completes.
            values.put(MediaStore.Images.Media.IS_PENDING, 1);

            ContentResolver resolver = getContext().getContentResolver();
            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("MediaStore refused the insert");
                return;
            }

            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) {
                    resolver.delete(uri, null, null);
                    call.reject("Could not open the MediaStore output stream");
                    return;
                }
                out.write(bytes);
                out.flush();
            }

            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, values, null, null);

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage(), e);
        }
    }
}
