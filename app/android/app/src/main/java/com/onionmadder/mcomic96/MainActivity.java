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
 * Capacitor 8 does nothing with insets either, so this is the only place left.
 *
 * **Applied three ways on purpose.** A previous version of this set only the
 * listener and did not work on device: window insets are dispatched once, early,
 * and if that pass happens before `onCreate` attaches a listener then nothing
 * ever re-dispatches them and the callback simply never runs. So the listener
 * handles later changes (keyboard, rotation, gesture-bar mode), the explicit
 * `requestApplyInsets` forces the pass that may already have been missed, and
 * `onResume` reads the insets straight off the view as a backstop for the case
 * where even that is too early. `applyInsets` is idempotent — it only ever calls
 * `setPadding` — so all three arriving costs nothing.
 */
public class MainActivity extends BridgeActivity {

    private View root;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = findViewById(android.R.id.content);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            applyInsets(windowInsets);
            // Returned unconsumed on purpose: Capacitor's own keyboard handling
            // is downstream of this and still needs to see the IME inset.
            return windowInsets;
        });

        // Force a dispatch, in case the only one already happened above.
        ViewCompat.requestApplyInsets(root);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Backstop: read whatever the view currently has, rather than waiting to
        // be told. Null before the view is attached to a window, which is why
        // this is here and not in onCreate.
        if (root != null) {
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
            if (insets != null) applyInsets(insets);
        }
    }

    private void applyInsets(WindowInsetsCompat windowInsets) {
        if (root == null) return;
        Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());

        // Bottom is deliberately dropped while the keyboard is up. Capacitor
        // already resizes the web layer for the IME — the composer sits right on
        // top of the keyboard on device — but the navigation bar inset is still
        // reported while the keyboard covers it, and adding it here as well would
        // push the input row up by a phantom nav bar.
        boolean keyboardUp = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
        int bottom = keyboardUp ? 0 : bars.bottom;

        root.setPadding(bars.left, bars.top, bars.right, bottom);
    }
}
