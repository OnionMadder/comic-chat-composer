package com.onionmadder.mcomic96;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Keep the web layer out from under the system bars.
 *
 * targetSdk is 36, so Android enforces edge-to-edge and there is no opt-out
 * (`windowOptOutEdgeToEdgeEnforcement` was an API 35 stopgap and is gone in 36).
 * The window therefore extends behind the status bar and the navigation bar.
 *
 * The CSS already asks for `env(safe-area-inset-*)` with `viewport-fit=cover`,
 * and on iOS that would be the whole answer — but on Android those values report
 * the **display cutout**, not the status bar. On a phone whose camera cutout is
 * inside the status bar strip (i.e. most of them) they resolve to 0, so the app
 * bar got its 8px of padding and drew straight through the clock and the wifi
 * and battery icons. No amount of CSS can see the status bar from in there.
 *
 * So the insets are applied here, where they are actually known.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final View root = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());

            // Bottom is deliberately dropped while the keyboard is up. Capacitor
            // already resizes the web layer for the IME — the composer sits right
            // on top of the keyboard today — and the navigation bar inset is
            // still reported even though the keyboard is covering it. Adding it
            // here as well would push the input row up by a phantom nav bar.
            boolean keyboardUp = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            int bottom = keyboardUp ? 0 : bars.bottom;

            view.setPadding(bars.left, bars.top, bars.right, bottom);

            // Returned unconsumed on purpose: Capacitor's own keyboard handling
            // is downstream of this and still needs to see the IME inset.
            return windowInsets;
        });
    }
}
