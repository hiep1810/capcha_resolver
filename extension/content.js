// content.js
let lastRightClickedElement = null;

// Track right clicks to identify target
document.addEventListener("contextmenu", (event) => {
    lastRightClickedElement = event.target;
}, true);

// Listen for background commands
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "capture_element") {
        handleCapture();
    }
});

async function handleCapture() {
    showOverlay("Analyzing Captcha...");

    try {
        const element = findTargetElement(lastRightClickedElement);
        if (!element) {
            console.error("Vision Helper: No element found.");
            throw new Error("No SVG or Image found. Please right-click directly on the captcha.");
        }

        console.log("Vision Helper: Found element:", element.tagName);
        if (element.tagName === "IMG") {
            console.log("Vision Helper: Image Source:", element.src.substring(0, 100) + "...");
        }

        const base64Image = await processElement(element);

        // DEBUG: Auto-download the cleaned image
        // const debugLink = document.createElement('a');
        // debugLink.href = base64Image;
        // debugLink.download = `captcha_debug_${Date.now()}.png`;
        // document.body.appendChild(debugLink);
        // debugLink.click();
        // debugLink.remove();

        chrome.runtime.sendMessage({ action: "solve_image", imageData: base64Image }, response => {
            removeOverlay();

            if (chrome.runtime.lastError) {
                showMessage("Error: " + chrome.runtime.lastError.message, true);
                return;
            }

            if (response && response.success) {
                const text = response.text;
                navigator.clipboard.writeText(text).then(() => {
                    const pasted = pasteToActiveElement(text);
                    showMessage(pasted ? `SOLVED & PASTED: ${text}` : `SOLVED & COPIED: ${text}`, false);
                }).catch(err => {
                    // Fallback if clipboard fails (unlikely in active tab)
                    const pasted = pasteToActiveElement(text);
                    showMessage(pasted ? `SOLVED & PASTED: ${text}` : `SOLVED: ${text} (Copy Failed)`, false);
                });
            } else {
                showMessage("Failed: " + (response ? response.error : "Unknown error"), true);
            }
        });

    } catch (e) {
        removeOverlay();
        showMessage(e.message, true);
        console.error(e);
    }
}

function findTargetElement(startNode) {
    if (!startNode) return null;
    let current = startNode;
    // Walk up tree
    while (current && current !== document.body) {
        if (current.tagName.toLowerCase() === 'svg') return current;
        if (current.tagName.toLowerCase() === 'img') return current;
        current = current.parentElement;
    }
    // Search children if wrapper clicked
    if (startNode.querySelector) {
        const svg = startNode.querySelector('svg');
        if (svg) return svg;
        const img = startNode.querySelector('img');
        if (img) return img;
    }
    return null;
}

function processElement(element) {
    return new Promise(async (resolve, reject) => {
        if (element.tagName.toLowerCase() === 'svg') {
            resolve(processSVG(element));
        } else if (element.tagName.toLowerCase() === 'img') {
            resolve(processImage(element));
        } else {
            reject(new Error("Unsupported element type"));
        }
    });
}

function processImage(element) {
    return new Promise(async (resolve, reject) => {
        if (element.tagName === 'IMG') {
            const src = element.src;
            console.log("Vision Helper: Processing IMG src:", src.substring(0, 50));

            // Attempt to treat it as an SVG first (Fetch & Clean)
            try {
                const response = await fetch(src);
                const text = await response.text();

                if (text.trim().startsWith('<svg') || text.includes('xmlns="http://www.w3.org/2000/svg"')) {
                    console.log("Vision Helper: Detected SVG content in IMG tag. Converting to DOM for cleaning...");

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, "image/svg+xml");
                    const svgElement = doc.documentElement;

                    if (svgElement && svgElement.tagName === "svg") {
                        // Pass to our existing cleaning logic
                        const cleanedBase64 = await processSVG(svgElement);
                        resolve(cleanedBase64);
                        return;
                    }
                }
            } catch (err) {
                console.warn("Vision Helper: Failed to fetch/parse IMG source as SVG, falling back to raster:", err);
            }

            // Fallback: Standard Raster Processing (No cleaning possible)
            console.log("Vision Helper: Treating as Raster Image");
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                const canvas = document.createElement('canvas');
                // Tesseract needs high res
                const scale = 4;
                canvas.width = (img.naturalWidth || element.width || 200) * scale;
                canvas.height = (img.naturalHeight || element.height || 50) * scale;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = "white"; // white bg
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error("Could not load image data"));
            img.src = src;
        } else {
            reject(new Error("Unsupported element type"));
        }
    });
}

function processSVG(svgElement) {
    return new Promise((resolve, reject) => {
        // Clone to manipulate
        const clone = svgElement.cloneNode(true);

        // DEBUG: Log the SVG code to help us find the noise lines
        console.log("--- CAPTCHA SVG SOURCE ---");
        console.log(clone.outerHTML);
        console.log("--------------------------");

        /**
         * ==========================================
         * CAPTCHA DEOBFUSCATION LOGIC EXPLANATION
         * ==========================================
         * 
         * The captcha SVG contains two types of <path> elements:
         * 
         * 1. NOISE LINES (to be removed):
         *    - These are diagonal lines drawn across the image to confuse OCR.
         *    - They are rendered using the "stroke" attribute (like drawing with a pen).
         *    - Example: <path d="M18 32 C118 35,117 28,190 12" stroke="#222" fill="none"/>
         *    - Key identifiers:
         *      - Has a `stroke` attribute (e.g., stroke="#222", stroke="#666")
         *      - Has `fill="none"` (no solid fill, just an outline)
         * 
         * 2. TEXT CHARACTERS (to be kept):
         *    - These are the actual captcha characters we need to read.
         *    - They are rendered using the "fill" attribute (like a solid shape).
         *    - Example: <path fill="#222" d="M22.57 14.31L22.64..."/>
         *    - Key identifiers:
         *      - Has a `fill` attribute with a color value (e.g., fill="#222", fill="#111")
         *      - Does NOT have a `stroke` attribute
         * 
         * CLEANING RULES:
         * - RULE 1: Remove any path with a `stroke` attribute (noise lines).
         * - RULE 2: Remove any path with no `fill` or `fill="none"` (invisible/noise).
         * 
         * After cleaning, only the filled text paths remain, making OCR accurate.
         * ==========================================
         */

        const paths = clone.querySelectorAll('path');
        paths.forEach(p => {
            const fill = p.getAttribute('fill');
            const stroke = p.getAttribute('stroke');

            // RULE 1: If it has a stroke, it's a noise line (Text is usually just Filled)
            if (stroke && stroke !== 'none') {
                // console.log("Cleaning: Removing Stroke Line", p);
                p.remove();
                return;
            }

            // RULE 2: If it has NO fill, or fill is 'none', it's invisible/noise
            if (!fill || fill === 'none') {
                // console.log("Cleaning: Removing No-Fill Path", p);
                p.remove();
                return;
            }
        });

        // Ensure visibility and clean styles
        clone.style.background = "white"; // Force white bg

        // Serialize
        const serializer = new XMLSerializer();
        let svgString = serializer.serializeToString(clone);

        // Encode
        const svgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

        // Create image to verify rendering on canvas (standardizes format to PNG for OCR)
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Use viewBox for logical size, or client rect
            const viewBox = svgElement.viewBox.baseVal;
            const originalWidth = (viewBox && viewBox.width) ? viewBox.width : svgElement.getBoundingClientRect().width;
            const originalHeight = (viewBox && viewBox.height) ? viewBox.height : svgElement.getBoundingClientRect().height;

            // SCALE FACTOR for OCR optimization
            // Tesseract JS (Offline) fails on small images. It NEEDS 4x scaling or higher.
            const scale = 4;

            canvas.width = (originalWidth || 200) * scale;
            canvas.height = (originalHeight || 50) * scale;

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Draw scaled
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (e) => reject(e);
        img.src = svgBase64;
    });
}

function pasteToActiveElement(text) {
    let active = document.activeElement;

    // Smart Paste: If active element is not an input, try to find one near the captcha
    if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
        const neighborInput = findNearbyInput(lastRightClickedElement);
        if (neighborInput) {
            neighborInput.focus();
            active = neighborInput;
        }
    }

    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        // Try to insert
        const start = active.selectionStart;
        const end = active.selectionEnd;
        const value = active.value;
        active.value = value.substring(0, start) + text + value.substring(end);
        // Dispatch input event so validation triggers
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }
    return false;
}

function findNearbyInput(referenceNode) {
    if (!referenceNode) return null;

    // 1. Look for sibling
    let sibling = referenceNode.nextElementSibling;
    while (sibling) {
        if (sibling.tagName === 'INPUT' && sibling.type !== 'hidden' && sibling.type !== 'submit') return sibling;
        // Check if sibling contains input
        const inner = sibling.querySelector('input:not([type="hidden"]):not([type="submit"])');
        if (inner) return inner;
        sibling = sibling.nextElementSibling;
    }

    // 2. Look in parent
    const parent = referenceNode.parentElement;
    if (parent) {
        const inputs = parent.querySelectorAll('input:not([type="hidden"]):not([type="submit"])');
        // Return the first one that appears *after* the reference node in DOM order if possible, or just the first empty one
        for (let input of inputs) {
            if (input !== referenceNode) return input;
        }
    }
    return null;
}

// UI HELPERS
function showOverlay(text) {
    if (document.getElementById('crs-overlay')) return;
    const div = document.createElement('div');
    div.id = 'crs-overlay';
    div.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 999999;
        display: flex; align-items: center; justify-content: center;
        color: white; font-family: sans-serif; font-size: 24px; font-weight: bold;
        pointer-events: none;
    `;
    div.innerText = text;
    document.body.appendChild(div);
}

function removeOverlay() {
    const el = document.getElementById('crs-overlay');
    if (el) el.remove();
}

function showMessage(text, isError) {
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed; top: 20px; right: 20px; 
        padding: 15px 25px; border-radius: 8px;
        background: ${isError ? '#ff4444' : '#44cc44'}; 
        color: white; font-family: sans-serif; font-size: 18px; 
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 999999;
        transition: opacity 0.5s; pointer-events: none;
    `;
    div.innerText = text;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 500);
    }, 4000);
}
