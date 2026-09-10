(() => {
  "use strict";

  const LOG_PREFIX = "[casimir:chatgpt-attachment-upload]";
  const PORT_NAME = "casimir-attachment-upload";
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"]';
  const ATTACHMENT_CONFIRM_ATTEMPTS = 15;
  const ATTACHMENT_RETRY_ATTEMPTS = 50;
  const ATTACHMENT_POLL_MS = 100;
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

  function uploadInputIsReady(input) {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const plusButton = document.querySelector('[data-testid="composer-plus-btn"]');
    return (
      input instanceof HTMLInputElement &&
      input.type === "file" &&
      input.isConnected !== false &&
      composer?.contains(input) &&
      plusButton instanceof HTMLElement &&
      !plusButton.disabled
    );
  }

  function waitForUploadInput(attemptsRemaining = 200) {
    const input = document.getElementById("upload-files");
    if (uploadInputIsReady(input)) {
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

  function attachmentIsVisible(filename) {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (!composer) return false;

    return [...composer.querySelectorAll('[role="group"][aria-label]')].some(
      (element) => element.getAttribute("aria-label") === filename,
    );
  }

  async function waitForAttachment(filename, attemptsRemaining) {
    if (attachmentIsVisible(filename)) return true;
    if (attemptsRemaining <= 1) return false;

    await new Promise((resolve) => {
      window.setTimeout(resolve, ATTACHMENT_POLL_MS);
    });
    return waitForAttachment(filename, attemptsRemaining - 1);
  }

  function setInputFile(input, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const filesSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files",
    )?.set;

    if (filesSetter) {
      filesSetter.call(input, transfer.files);
    } else {
      input.files = transfer.files;
    }
  }

  function dispatchUploadEvents(input, includeInputEvent) {
    if (includeInputEvent) {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  async function attachFile() {
    const input = await waitForUploadInput();
    if (!input) throw new Error("ChatGPT file input #upload-files was not found");

    const file = new File(chunks, metadata.filename, {
      type: metadata.contentType,
      lastModified: Date.now(),
    });
    setInputFile(input, file);
    dispatchUploadEvents(input, true);

    let attached = await waitForAttachment(
      file.name,
      ATTACHMENT_CONFIRM_ATTEMPTS,
    );

    if (!attached) {
      const retryInput = await waitForUploadInput();
      if (!retryInput) {
        throw new Error("ChatGPT file input disappeared before upload retry");
      }

      if (retryInput.files?.[0] !== file) {
        setInputFile(retryInput, file);
        dispatchUploadEvents(retryInput, true);
      } else {
        dispatchUploadEvents(retryInput, false);
      }

      attached = await waitForAttachment(file.name, ATTACHMENT_RETRY_ATTEMPTS);
    }

    const attachmentKind = metadata.attachmentKind || "PDF";
    if (!attached) {
      throw new Error(`ChatGPT did not confirm the ${attachmentKind} attachment`);
    }

    console.log(LOG_PREFIX, "File attachment confirmed by ChatGPT.", {
      filename: file.name,
      size: file.size,
    });
    showStatus(`${attachmentKind} 已添加：${file.name}。请等待 ChatGPT 上传完成。`, "success", true);
  }

  const port = chrome.runtime.connect({ name: PORT_NAME });
  port.onMessage.addListener((message) => {
    if (message?.type === "none") {
      port.disconnect();
      return;
    }
    if (message?.type === "status" && message.status === "fetching") {
      showStatus(`Casimir 正在从 ${message.sourceKind} 获取 PDF…`);
      return;
    }
    if (message?.type === "status" && message.status === "capturing") {
      showStatus(
        message.direct
          ? `正在将 ${message.sourceKind} 保存为 MHTML…`
          : `原始 PDF 不可用，正在保存 ${message.sourceKind} 页面为 MHTML…`,
      );
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
      void attachFile()
        .catch((error) => {
          console.error(LOG_PREFIX, error);
          showStatus(
            `${metadata?.attachmentKind || "文件"} 添加失败：${error.message}`,
            "error",
            true,
          );
        })
        .finally(() => port.disconnect());
      return;
    }
    if (message?.type === "error") {
      console.error(LOG_PREFIX, message.message);
      showStatus(
        `${message.attachmentKind || "PDF"} 获取失败：${message.message}`,
        "error",
        true,
      );
    }
  });
  port.postMessage({ type: "claim" });
})();
