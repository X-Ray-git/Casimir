(() => {
  "use strict";

  const LOG_PREFIX = "[casimir:chatgpt-pdf-upload]";
  const PORT_NAME = "casimir-pdf-upload";
  const chunks = [];
  let metadata = null;
  let statusHost = null;

  function showStatus(message, kind = "progress", autoHide = false) {
    if (!statusHost) {
      statusHost = document.createElement("div");
      statusHost.id = "casimir-pdf-upload-status";
      statusHost.style.cssText = [
        "position:fixed",
        "right:20px",
        "bottom:20px",
        "z-index:2147483647",
        "max-width:340px",
        "padding:12px 16px",
        "border-radius:12px",
        "box-shadow:0 8px 30px rgba(0,0,0,.28)",
        "font:13px/1.45 system-ui,sans-serif",
        "color:white",
      ].join(";");
      document.documentElement.appendChild(statusHost);
    }

    statusHost.textContent = message;
    statusHost.style.background = kind === "error" ? "#b91c1c" : "#1f2937";
    if (autoHide) window.setTimeout(() => statusHost?.remove(), 5000);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function waitForUploadInput(attemptsRemaining = 200) {
    const input = document.getElementById("upload-files");
    if (input instanceof HTMLInputElement && input.type === "file") {
      return Promise.resolve(input);
    }
    if (attemptsRemaining <= 1) return Promise.resolve(null);
    return new Promise((resolve) => {
      window.setTimeout(
        () => resolve(waitForUploadInput(attemptsRemaining - 1)),
        100,
      );
    });
  }

  async function attachPdf() {
    const input = await waitForUploadInput();
    if (!input) throw new Error("ChatGPT file input #upload-files was not found");

    const file = new File(chunks, metadata.filename, {
      type: metadata.contentType,
      lastModified: Date.now(),
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    console.log(LOG_PREFIX, "PDF attached to ChatGPT's file input.", {
      filename: file.name,
      size: file.size,
    });
    showStatus(`PDF 已添加：${file.name}。请等待 ChatGPT 上传完成。`, "success", true);
  }

  const port = chrome.runtime.connect({ name: PORT_NAME });
  port.onMessage.addListener((message) => {
    if (message?.type === "none") {
      port.disconnect();
      return;
    }
    if (message?.type === "status" && message.status === "fetching") {
      showStatus("Casimir 正在从 arXiv 获取 PDF…");
      return;
    }
    if (message?.type === "start") {
      metadata = message;
      chunks.length = 0;
      showStatus(`正在准备 ${message.filename}…`);
      return;
    }
    if (message?.type === "chunk") {
      chunks.push(base64ToBytes(message.data));
      return;
    }
    if (message?.type === "done") {
      void attachPdf()
        .catch((error) => {
          console.error(LOG_PREFIX, error);
          showStatus(`PDF 添加失败：${error.message}`, "error");
        })
        .finally(() => port.disconnect());
      return;
    }
    if (message?.type === "error") {
      console.error(LOG_PREFIX, message.message);
      showStatus(`PDF 获取失败：${message.message}`, "error");
    }
  });
  port.postMessage({ type: "claim" });
})();
