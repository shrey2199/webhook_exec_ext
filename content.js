// Content script for capturing page-specific data

// Send page context to background script
function sendPageContext() {
  const context = {
    url: window.location.href,
    title: document.title,
    domain: window.location.hostname
  };
  
  chrome.runtime.sendMessage({
    type: 'PAGE_CONTEXT',
    context: context
  });
}

// Send context when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', sendPageContext);
} else {
  sendPageContext();
}

// Update context on navigation
let lastUrl = window.location.href;
new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    sendPageContext();
  }
}).observe(document, { subtree: true, childList: true });
