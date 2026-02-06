// Popup script for executing webhooks

let webhooks = [];

// Load webhooks on popup open
document.addEventListener('DOMContentLoaded', async () => {
  await loadWebhooks();
  renderWebhooks();
  setupEventListeners();
});

async function loadWebhooks() {
  const data = await chrome.storage.local.get('webhooks');
  webhooks = data.webhooks || [];
}

function setupEventListeners() {
  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('emptySettingsBtn').addEventListener('click', openSettings);
}

function openSettings() {
  chrome.runtime.openOptionsPage();
  window.close();
}

function renderWebhooks() {
  const container = document.getElementById('webhooksContainer');
  const emptyState = document.getElementById('emptyState');
  
  if (webhooks.length === 0) {
    container.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }
  
  container.style.display = 'block';
  emptyState.style.display = 'none';
  
  container.innerHTML = webhooks.map(webhook => `
    <div class="webhook-item" data-id="${webhook.id}">
      <div class="webhook-item-content">
        <div class="webhook-item-name">${escapeHtml(webhook.name)}</div>
        <div class="webhook-item-url">${escapeHtml(webhook.url)}</div>
        ${webhook.responseCheck && webhook.responseCheck.enabled ? 
          '<span class="webhook-badge">Response Check</span>' : ''}
      </div>
      <button class="execute-btn" data-id="${webhook.id}" title="Execute webhook">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </button>
    </div>
  `).join('');
  
  // Add event listeners for execute buttons
  container.querySelectorAll('.execute-btn').forEach(btn => {
    btn.addEventListener('click', () => executeWebhook(btn.dataset.id));
  });
}

async function executeWebhook(webhookId) {
  const webhook = webhooks.find(wh => wh.id === webhookId);
  if (!webhook) return;
  
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showNotification('Error: No active tab found', 'error');
      return;
    }
    
    // Send message to background script to execute webhook
    chrome.runtime.sendMessage({
      type: 'EXECUTE_WEBHOOK',
      webhookId: webhookId,
      tabId: tab.id
    });
    
    // Close popup immediately - notifications will appear on the page
    window.close();
    
  } catch (error) {
    console.error('Error executing webhook:', error);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
