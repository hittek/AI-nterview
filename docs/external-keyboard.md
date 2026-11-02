# External 2-key pad (hands-free shortcuts)

> Experimental. See the disclaimer in the [README](../README.md).

A cheap 2-key USB pad can trigger the app's global shortcuts so you never touch the main window.

| Pad input | Sends | App action |
|---|---|---|
| Key 1 (`page_up` on our pad) | Cmd+Shift+7 | Start audio capture |
| Key 2 (`page_down` on our pad) | Cmd+Shift+8 | Stop audio capture |
| Both within 150 ms | Cmd+Shift+9 | Screenshot |

The app itself only knows the global shortcuts (`F7/F8/F9` and `Cmd/Ctrl+Shift+7/8/9`). The pad is remapped to them outside the app.

## macOS (Karabiner-Elements)

1. `brew install --cask karabiner-elements`; approve the driver extension and Input Monitoring in System Settings.
2. Find your pad's key codes and IDs: open **Karabiner-EventViewer**, press each key, note the `key_code`. Our pad reports `page_up` / `page_down`; macOS lists it as "USB Keyboard" (vendor `20812`, product `34897`). The same USB ids are visible with `ioreg -p IOUSB -l -w0 | grep -A25 'USB Keyboard'`.
3. Copy [`karabiner/ainterview-pad.json`](karabiner/ainterview-pad.json) to `~/.config/karabiner/assets/complex_modifications/`, editing `key_code`, `vendor_id` and `product_id` to match your pad.
4. Karabiner-Elements → **Complex Modifications** → Add predefined rule → enable "AInterview 2-key pad".
5. Karabiner-Elements → **Devices** → make sure **Modify events** is on for the pad.

Notes:
- The `device_if` condition restricts the rule to the pad, so Page Up/Down on your normal keyboard is untouched.
- A single press waits up to `basic.simultaneous_threshold_milliseconds` (150 ms) to see if the other key follows. Lower it if single presses feel laggy; raise it if the chord is hard to hit.
- The pad is a composite device (it also reports mouse button events). If the rule does not match, add `"is_keyboard": true` to the `device_if` identifier.
- Symptom "keys just scroll": Karabiner is not modifying that device (step 5) or the vendor/product ids do not match.

## Windows

No Karabiner. Options: program the pad's firmware (many pads use VIA/QMK or a vendor tool) to send Ctrl+Shift+7 / 8 / 9 directly, or use [AutoHotkey](https://www.autohotkey.com/) (v2):

```ahk
PgUp::Send "^+7"
PgDn::Send "^+8"
PgUp & PgDn::Send "^+9"
```

AutoHotkey remaps all keyboards, not only the pad. The Windows build is untested, so verify the shortcuts register.
