// background.js

// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "resolve-captcha",
        title: "Giải mã Captcha",
        contexts: ["all"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "resolve-captcha") {
        chrome.tabs.sendMessage(tab.id, { action: "capture_element" });
    }
});

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "solve_image") {
        solveCaptcha(request.imageData)
            .then(text => {
                sendResponse({ success: true, text: text });
            })
            .catch(err => {
                console.error("OCR Error:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true; // Keep channel open
    }
});

async function solveCaptcha(base64Image) {
    const apiKey = "helloworld"; // Free demo key
    const apiUrl = "https://api.ocr.space/parse/image";

    const formData = new FormData();
    formData.append("apikey", apiKey);
    formData.append("base64Image", base64Image);
    formData.append("language", "eng");
    formData.append("isOverlayRequired", "false");
    formData.append("OCREngine", "2"); // Best for captchas with complex backgrounds
    formData.append("scale", "true");

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            body: formData
        });
        const data = await response.json();

        if (data.IsErroredOnProcessing) {
            throw new Error(data.ErrorMessage || "OCR processing failed");
        }

        if (data.ParsedResults && data.ParsedResults.length > 0) {
            let text = data.ParsedResults[0].ParsedText || "";
            text = text.trim().replace(/\s+/g, '');
            return text;
        } else {
            throw new Error("No text found in image");
        }
    } catch (error) {
        console.error("API call failed:", error);
        throw error;
    }
}
