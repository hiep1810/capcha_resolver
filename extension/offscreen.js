// offscreen.js

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'solve_image_offscreen') {
        solve(request.imageData, sendResponse);
        return true; // async
    }
});

async function solve(base64Image, sendResponse) {
    try {
        console.log("Offscreen: Starting Tesseract...");

        // Define paths explicitly using getURL to ensure they are correct absolute extension paths
        const workerPath = chrome.runtime.getURL("tesseract/worker.min.js");
        const corePath = chrome.runtime.getURL("tesseract/tesseract-core.wasm.js");
        const langPath = chrome.runtime.getURL("tesseract/");

        console.log(`Offscreen: Config - Worker: ${workerPath}, Core: ${corePath}`);

        const worker = await Tesseract.createWorker("eng", 1, {
            workerPath: workerPath,
            corePath: corePath,
            langPath: langPath,
            workerBlobURL: false,
            logger: m => console.log(m),
            gzip: true
        });

        // Optimize for captcha: Whitelist only alphanumeric
        await worker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        });

        const { data: { text } } = await worker.recognize(base64Image);
        console.log("Offscreen: Result:", text);

        await worker.terminate();

        const cleanText = text.trim().replace(/\s+/g, '');
        sendResponse({ success: true, text: cleanText });

    } catch (e) {
        console.error("Offscreen Error:", e);
        sendResponse({ success: false, error: e.toString() });
    }
}
