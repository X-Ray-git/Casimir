(() => {
  "use strict";

  const LOG_PREFIX = "[casimir:chatgpt-shortcuts]";
  const STORAGE_KEY = "casimirCustomShortcuts";
  const PENDING_PROMPT_KEY = "casimirPendingPrompt";
  const PENDING_PROMPT_MAX_AGE_MS = 15000;
  let customShortcuts = [];
  let settingsOpen = false;

  void chrome.storage.local.get([STORAGE_KEY, PENDING_PROMPT_KEY]).then((stored) => {
    customShortcuts = Array.isArray(stored[STORAGE_KEY])
      ? stored[STORAGE_KEY]
      : [];

    const pending = stored[PENDING_PROMPT_KEY];
    if (
      pending &&
      typeof pending.prompt === "string" &&
      Date.now() - pending.createdAt <= PENDING_PROMPT_MAX_AGE_MS
    ) {
      void chrome.storage.local.remove(PENDING_PROMPT_KEY);
      insertPromptWhenReady(pending.prompt);
    } else if (pending) {
      void chrome.storage.local.remove(PENDING_PROMPT_KEY);
    }
  });

  function isVisible(element) {
    return Boolean(
      element &&
        !element.closest("[inert]") &&
        element.getClientRects().length > 0,
    );
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (isVisible(element)) return element;
      }
    }
    return null;
  }

  function getPromptInput() {
    return document.getElementById("prompt-textarea");
  }

  function focusPrompt() {
    const input = getPromptInput();
    if (!input) {
      console.warn(LOG_PREFIX, "Prompt input not found.");
      return false;
    }

    input.focus();
    return true;
  }

  function isNewChatPage() {
    return window.location.pathname === "/" && window.location.search === "";
  }

  function findNewChatButton() {
    return firstVisible([
      '[data-testid="create-new-chat-button"][href="/"]',
    ]);
  }

  function startNewChat() {
    if (isNewChatPage()) {
      focusPrompt();
      return "current";
    }

    const button = findNewChatButton();
    if (button) {
      console.log(
        LOG_PREFIX,
        "Starting a new chat through ChatGPT's native entry.",
      );
      button.click();
      return "native";
    }

    const targetUrl = `${window.location.origin}/`;
    console.warn(
      LOG_PREFIX,
      "Native new chat entry not found; navigating directly.",
      {
        from: window.location.href,
        to: targetUrl,
      },
    );
    window.location.assign(targetUrl);
    return "navigation";
  }

  function findSidebarToggle() {
    return firstVisible([
      '[data-testid="close-sidebar-button"]',
      '[data-testid="open-sidebar-button"]',
      '[aria-label="Close sidebar"]',
      '[aria-label="Open sidebar"]',
      '[aria-label="关闭侧边栏"]',
      '[aria-label="打开侧边栏"]',
      '[aria-label="关闭边栏"]',
      '[aria-label="打开边栏"]',
    ]);
  }

  function toggleSidebar() {
    const button = findSidebarToggle();
    if (!button) {
      console.warn(LOG_PREFIX, "Sidebar toggle not found.");
      return false;
    }

    button.click();
    return true;
  }

  function findTemporaryChatButton() {
    return firstVisible([
      '[data-testid="temporary-chat-button"]',
      '[aria-label="Temporary chat"]',
      '[aria-label="Turn on temporary chat"]',
      '[aria-label="Turn off temporary chat"]',
      '[aria-label="开启临时聊天"]',
      '[aria-label="关闭临时聊天"]',
      '[aria-label="开启临时对话"]',
      '[aria-label="关闭临时对话"]',
    ]);
  }

  function toggleTemporaryChat() {
    const button = findTemporaryChatButton();
    if (button) {
      button.click();
      window.setTimeout(focusPrompt, 300);
      return true;
    }

    console.warn(LOG_PREFIX, "Temporary chat button not found.");
    return false;
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function insertPrompt(text) {
    const input = getPromptInput();
    if (!input) return false;

    input.focus();

    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);
    const pasteEvent = new ClipboardEvent("paste", {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(pasteEvent);
    if (pasteEvent.defaultPrevented) return true;

    const success = document.execCommand("insertText", false, text);
    if (!success || input.textContent.trim() === "") {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      input.replaceChildren(paragraph);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    return true;
  }

  function insertPromptWhenReady(text, attemptsRemaining = 20) {
    if (insertPrompt(text) || attemptsRemaining <= 1) return;
    window.setTimeout(
      () => insertPromptWhenReady(text, attemptsRemaining - 1),
      100,
    );
  }

  function consumePendingPromptAfterNewChat(text, attemptsRemaining = 150) {
    window.setTimeout(() => {
      if (isNewChatPage() && insertPrompt(text)) {
        void chrome.storage.local.remove(PENDING_PROMPT_KEY);
        return;
      }

      if (attemptsRemaining > 1) {
        consumePendingPromptAfterNewChat(text, attemptsRemaining - 1);
      }
    }, 100);
  }

  function shortcutLabel(shortcut) {
    const parts = [];
    if (shortcut.ctrlKey) parts.push("Ctrl");
    if (shortcut.metaKey) parts.push("Cmd");
    if (shortcut.altKey) parts.push("Alt");
    if (shortcut.shiftKey) parts.push("Shift");
    if (shortcut.key) parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
    return parts.join(" + ");
  }

  function shortcutFromEvent(event) {
    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return null;
    return {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      code: event.code,
      key: event.key,
    };
  }

  function matchesShortcut(event, shortcut) {
    return (
      Boolean(shortcut.ctrlKey) === event.ctrlKey &&
      Boolean(shortcut.metaKey) === event.metaKey &&
      Boolean(shortcut.altKey) === event.altKey &&
      Boolean(shortcut.shiftKey) === event.shiftKey &&
      (shortcut.code
        ? shortcut.code === event.code
        : shortcut.key?.toLowerCase() === event.key.toLowerCase())
    );
  }

  async function runCustomShortcut(shortcut) {
    let prompt = shortcut.prompt;
    if (prompt.includes("{{clipboard}}")) {
      try {
        const clipboard = await navigator.clipboard.readText();
        prompt = prompt.replaceAll("{{clipboard}}", clipboard);
      } catch (error) {
        console.error(LOG_PREFIX, "Failed to read clipboard.", error);
      }
    }

    if (shortcut.newChat) {
      if (isNewChatPage()) {
        insertPromptWhenReady(prompt);
        return;
      }

      await chrome.storage.local.set({
        [PENDING_PROMPT_KEY]: { prompt, createdAt: Date.now() },
      });
      const result = startNewChat();
      if (result === "native") {
        consumePendingPromptAfterNewChat(prompt);
      }
      return;
    }

    insertPrompt(prompt);
  }

  function createSettingsPanel() {
    let host = document.getElementById("casimir-settings-host");
    if (host) return host;

    host = document.createElement("div");
    host.id = "casimir-settings-host";
    host.style.position = "fixed";
    host.style.zIndex = "2147483647";
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light dark; }
      .overlay { position: fixed; inset: 0; background: rgb(0 0 0 / .55); display: grid; place-items: center; font-family: system-ui, sans-serif; }
      .dialog { width: min(820px, 92vw); max-height: 86vh; display: flex; flex-direction: column; background: Canvas; color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 18px; box-shadow: 0 20px 60px rgb(0 0 0 / .35); }
      header, footer { display: flex; align-items: center; gap: 12px; padding: 18px 22px; }
      header { border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, transparent); }
      header h2 { margin: 0; font-size: 20px; flex: 1; }
      .content { padding: 18px 22px; overflow: auto; }
      .hint { margin: 0 0 14px; opacity: .72; font-size: 13px; }
      .list { display: grid; gap: 12px; }
      .row { display: grid; grid-template-columns: 180px 1fr auto; gap: 12px; align-items: start; padding: 14px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; }
      .field { display: grid; gap: 6px; }
      label { font-size: 12px; opacity: .72; }
      input[type="text"], textarea { box-sizing: border-box; width: 100%; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius: 8px; padding: 9px 10px; background: Field; color: FieldText; font: inherit; }
      textarea { min-height: 82px; resize: vertical; }
      .new-chat { display: flex; gap: 8px; align-items: center; margin-top: 10px; font-size: 13px; }
      button { border: 0; border-radius: 999px; padding: 9px 16px; font: inherit; cursor: pointer; }
      .primary { background: #2563eb; color: white; }
      .secondary { background: color-mix(in srgb, CanvasText 10%, Canvas); color: CanvasText; }
      .delete { padding: 7px 11px; color: #dc2626; background: transparent; }
      footer { justify-content: space-between; border-top: 1px solid color-mix(in srgb, CanvasText 15%, transparent); }
      .footer-actions { display: flex; gap: 10px; }
      @media (max-width: 650px) { .row { grid-template-columns: 1fr; } }
    `;
    shadow.appendChild(style);
    return host;
  }

  function addSettingsRow(list, initial = {}) {
    const row = document.createElement("div");
    row.className = "row";

    const shortcutField = document.createElement("div");
    shortcutField.className = "field";
    const shortcutCaption = document.createElement("label");
    shortcutCaption.textContent = "快捷键";
    const shortcutInput = document.createElement("input");
    shortcutInput.type = "text";
    shortcutInput.placeholder = "点击后按下快捷键";
    shortcutInput.readOnly = true;
    shortcutInput.value = shortcutLabel(initial);
    shortcutInput._shortcut = initial.code || initial.key ? { ...initial } : null;
    shortcutInput.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shortcut = shortcutFromEvent(event);
      if (!shortcut) return;
      shortcutInput._shortcut = shortcut;
      shortcutInput.value = shortcutLabel(shortcut);
    });
    shortcutField.append(shortcutCaption, shortcutInput);

    const promptField = document.createElement("div");
    promptField.className = "field";
    const promptCaption = document.createElement("label");
    promptCaption.textContent = "Prompt（支持 {{clipboard}}）";
    const promptInput = document.createElement("textarea");
    promptInput.value = initial.prompt || "";
    const newChatLabel = document.createElement("label");
    newChatLabel.className = "new-chat";
    const newChatInput = document.createElement("input");
    newChatInput.type = "checkbox";
    newChatInput.checked = Boolean(initial.newChat);
    newChatLabel.append(newChatInput, document.createTextNode("先开始新对话"));
    promptField.append(promptCaption, promptInput, newChatLabel);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => row.remove());

    row._values = () => {
      const shortcut = shortcutInput._shortcut;
      const prompt = promptInput.value.trim();
      return shortcut && prompt
        ? { ...shortcut, prompt, newChat: newChatInput.checked }
        : null;
    };
    row.append(shortcutField, promptField, deleteButton);
    list.appendChild(row);
  }

  function closeSettings() {
    document.getElementById("casimir-settings-host")?.remove();
    settingsOpen = false;
  }

  function openSettings() {
    if (settingsOpen) return;
    settingsOpen = true;

    const host = createSettingsPanel();
    const shadow = host.shadowRoot;
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const dialog = document.createElement("section");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = "Casimir 自定义快捷键";
    const closeButton = document.createElement("button");
    closeButton.className = "secondary";
    closeButton.textContent = "关闭";
    closeButton.addEventListener("click", closeSettings);
    header.append(title, closeButton);

    const content = document.createElement("div");
    content.className = "content";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "在快捷键输入框中直接按下组合键。空白或不完整的项目不会保存。";
    const list = document.createElement("div");
    list.className = "list";
    customShortcuts.forEach((shortcut) => addSettingsRow(list, shortcut));
    content.append(hint, list);

    const footer = document.createElement("footer");
    const addButton = document.createElement("button");
    addButton.className = "secondary";
    addButton.textContent = "添加快捷键";
    addButton.addEventListener("click", () => addSettingsRow(list));
    const actions = document.createElement("div");
    actions.className = "footer-actions";
    const cancelButton = document.createElement("button");
    cancelButton.className = "secondary";
    cancelButton.textContent = "取消";
    cancelButton.addEventListener("click", closeSettings);
    const saveButton = document.createElement("button");
    saveButton.className = "primary";
    saveButton.textContent = "保存";
    saveButton.addEventListener("click", async () => {
      customShortcuts = [...list.children]
        .map((row) => row._values())
        .filter(Boolean);
      await chrome.storage.local.set({ [STORAGE_KEY]: customShortcuts });
      closeSettings();
    });
    actions.append(cancelButton, saveButton);
    footer.append(addButton, actions);

    dialog.append(header, content, footer);
    overlay.appendChild(dialog);
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) closeSettings();
    });
    shadow.appendChild(overlay);
    closeButton.focus();
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented || event.isComposing) return;

      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey) return;

      if (event.shiftKey && event.key === ",") {
        consume(event);
        if (settingsOpen) closeSettings();
        else openSettings();
        return;
      }

      if (settingsOpen) return;

      const customShortcut = customShortcuts.find((shortcut) =>
        matchesShortcut(event, shortcut),
      );
      if (customShortcut) {
        consume(event);
        void runCustomShortcut(customShortcut);
        return;
      }

      if (!event.shiftKey && event.code === "KeyO") {
        consume(event);
        startNewChat();
        return;
      }

      if (!event.shiftKey && event.code === "KeyI") {
        consume(event);
        focusPrompt();
        return;
      }

      if (!event.shiftKey && event.code === "KeyL") {
        consume(event);
        toggleSidebar();
        return;
      }

      if (event.shiftKey && event.code === "KeyN") {
        consume(event);
        toggleTemporaryChat();
      }
    },
    true,
  );

  console.log(LOG_PREFIX, "Loaded.", {
    shortcuts: {
      newChat: "Cmd/Ctrl+O",
      focusPrompt: "Cmd/Ctrl+I",
      toggleSidebar: "Cmd/Ctrl+L",
      temporaryChat: "Cmd/Ctrl+Shift+N",
    },
  });
})();
