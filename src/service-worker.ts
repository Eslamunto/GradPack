chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (
      message !== "GRADPACK_ENSURE_RUNNER" ||
      sender.id !== chrome.runtime.id
    ) {
      return;
    }
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        if (tab?.id === undefined || !tab.url)
          throw new Error("No active Canvas tab");
        const url = new URL(tab.url);
        if (url.origin !== "https://frankfurtschool.instructure.com") {
          throw new Error("The active tab is not Frankfurt School Canvas");
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["runner.js"],
          world: "MAIN",
        });
        sendResponse({ tabId: tab.id });
      })
      .catch(() => {
        sendResponse({
          error: "Open a signed-in Frankfurt School Canvas tab.",
        });
      });
    return true;
  },
);
