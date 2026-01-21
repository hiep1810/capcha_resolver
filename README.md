# Captcha Resolver for Chrome

This Chrome extension helps users with poor eyesight resolve simple SVG captchas by right-clicking them.

## Setup Instructions

1.  Open Chrome and navigate to `chrome://extensions/`.
2.  Enable **Developer mode** (toggle in the top right).
3.  Click **Load unpacked**.
4.  Select the `extension` folder inside this directory.
5.  **Important**: If you want to test this on local SVG files, find the "Vision Helper" extension in the list, click **Details**, and enable **Allow access to file URLs**.

## How to Use

1.  Right-click on a Captcha image (SVG or Standard Image).
2.  Select **Resolve Captcha** from the context menu.
3.  Wait a moment for the notification "SOLVED: ...".
4.  The text is automatically copied to your clipboard and pasted into the active text box (if one is selected).

---

## Captcha Deobfuscation Logic

The captcha SVGs contain **noise lines** to confuse OCR engines. This extension removes them before sending the image for text recognition.

### How the SVG is Structured

```xml
<!-- NOISE LINE (to be removed) -->
<path d="M18 32 C118 35,117 28,190 12" stroke="#222" fill="none"/>

<!-- TEXT CHARACTER (to be kept) -->
<path fill="#222" d="M22.57 14.31L22.64..."/>
```

### Identification Rules

| Element Type | `stroke` Attribute | `fill` Attribute | Action |
|---|---|---|---|
| **Noise Line** | `stroke="#xxx"` (has value) | `fill="none"` | **REMOVE** |
| **Text Char** | (none) | `fill="#xxx"` (has value) | **KEEP** |

### Cleaning Rules in Code (`content.js`)

1.  **RULE 1**: If a `<path>` has a `stroke` attribute, it is a noise line. Remove it.
2.  **RULE 2**: If a `<path>` has no `fill` or `fill="none"`, it is invisible/noise. Remove it.

After cleaning, only the solid, filled text paths remain, making OCR highly accurate.

---

## Notes

-   This extension uses the free OCR.space API (Engine 3). For heavy usage, get your own API Key from [https://ocr.space/ocrapi](https://ocr.space/ocrapi).
-   The cleaning logic is specific to the SVG pattern described above.
