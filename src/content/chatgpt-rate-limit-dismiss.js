(() => {
  "use strict";

  const LOG_PREFIX = "[casimir:chatgpt-rate-limit-dismiss]";
  const MODAL_SELECTOR =
    '[data-testid="modal-conversation-history-rate-limit"]';
  const handledModals = new WeakSet();

  function dismissConversationHistoryRateLimit() {
    for (const modal of document.querySelectorAll(MODAL_SELECTOR)) {
      if (handledModals.has(modal)) continue;

      const dialog = modal.querySelector('[role="dialog"]');
      if (!dialog || dialog.getAttribute("data-state") !== "open") continue;

      const buttons = [...dialog.querySelectorAll("button")];
      if (buttons.length !== 1 || buttons[0].disabled) continue;

      handledModals.add(modal);
      buttons[0].click();
      console.log(
        LOG_PREFIX,
        "Dismissed ChatGPT's conversation-history rate-limit notice.",
      );
    }
  }

  dismissConversationHistoryRateLimit();

  const observer = new MutationObserver(dismissConversationHistoryRateLimit);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
