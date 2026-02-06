// Background script for handling context menus and webhook execution

let webhooks = [];
let pageContext = {};

// Initialize extension - this runs every time the service worker starts
initialize();

// Load webhooks from storage on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension startup');
  initialize();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  initialize();
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.webhooks) {
    loadWebhooksAndUpdateMenu();
  }
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PAGE_CONTEXT') {
    pageContext[sender.tab.id] = request.context;
  } else if (request.type === 'EXECUTE_WEBHOOK') {
    // Handle webhook execution from popup
    handlePopupWebhookExecution(request.webhookId, request.tabId);
    sendResponse({ success: true });
  }
  return true; // Keep message channel open for async response
});

// Initialize the extension
async function initialize() {
  console.log('Initializing extension...');
  await loadWebhooksAndUpdateMenu();
}

async function loadWebhooksAndUpdateMenu() {
  try {
    const data = await chrome.storage.local.get('webhooks');
    webhooks = data.webhooks || [];
    console.log('Loaded webhooks:', webhooks.length);
    await updateContextMenu();
  } catch (error) {
    console.error('Error loading webhooks:', error);
  }
}

async function updateContextMenu() {
  try {
    // Remove all existing context menu items
    await chrome.contextMenus.removeAll();
    
    const contextMenuWebhooks = webhooks.filter(wh => wh.showInContextMenu);
    
    if (contextMenuWebhooks.length === 0) {
      console.log('No webhooks to show in context menu');
      return;
    }
    
    if (contextMenuWebhooks.length === 1) {
      // Show single webhook directly
      const webhook = contextMenuWebhooks[0];
      chrome.contextMenus.create({
        id: `webhook_${webhook.id}`,
        title: webhook.name || 'Execute Webhook',
        contexts: ['all']
      });
      console.log('Created single context menu item');
    } else {
      // Create parent menu
      chrome.contextMenus.create({
        id: 'webhook_parent',
        title: 'Webhooks',
        contexts: ['all']
      });
      
      // Add each webhook as submenu
      contextMenuWebhooks.forEach(webhook => {
        chrome.contextMenus.create({
          id: `webhook_${webhook.id}`,
          parentId: 'webhook_parent',
          title: webhook.name || 'Unnamed Webhook',
          contexts: ['all']
        });
      });
      console.log(`Created context menu with ${contextMenuWebhooks.length} webhooks`);
    }
  } catch (error) {
    console.error('Error updating context menu:', error);
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);
  
  // Reload webhooks if empty (service worker may have restarted)
  if (webhooks.length === 0) {
    console.log('Reloading webhooks...');
    await loadWebhooksAndUpdateMenu();
  }
  
  const webhookId = info.menuItemId.toString().replace('webhook_', '');
  const webhook = webhooks.find(wh => wh.id === webhookId);
  
  if (webhook) {
    // Pass link URL if available (when right-clicking on a link)
    await executeWebhook(webhook, tab, info.linkUrl);
  } else {
    console.error('Webhook not found:', webhookId);
  }
});

async function executeWebhook(webhook, tab, linkUrl = null) {
  console.log('Executing webhook:', webhook.name, 'on tab:', tab?.id);
  
  if (!tab || !tab.id) {
    console.error('Invalid tab for webhook execution');
    return;
  }
  
  try {
    // Show loading popup
    await showPopup(tab.id, webhook.loadingText || 'Executing webhook...', 'loading');
    
    // Get page context for variable substitution (with link URL if provided)
    const context = await getPageContext(tab, linkUrl);
    
    // Prepare URL with substituted variables
    let url = substituteVariables(webhook.url, context);
    
    // Prepare headers
    const headers = {};
    if (webhook.headers && Array.isArray(webhook.headers)) {
      webhook.headers.forEach(header => {
        if (header.key && header.value) {
          headers[header.key] = substituteVariables(header.value, context);
        }
      });
    }
    
    // Prepare params (add to URL)
    if (webhook.params && Array.isArray(webhook.params)) {
      const urlObj = new URL(url);
      webhook.params.forEach(param => {
        if (param.key && param.value) {
          urlObj.searchParams.append(
            param.key,
            substituteVariables(param.value, context)
          );
        }
      });
      url = urlObj.toString();
    }
    
    // Prepare payload
    let body = null;
    if (webhook.payload) {
      body = substituteVariables(webhook.payload, context);
    }
    
    // Execute the webhook
    const options = {
      method: webhook.method || 'POST',
      headers: headers
    };
    
    if (body && (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH')) {
      options.body = body;
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
    
    const response = await fetch(url, options);
    
    // Check response if enabled
    let isSuccess = response.ok;
    let message = `${webhook.name}: ${response.status} ${response.statusText}`;
    
    if (webhook.responseCheck && webhook.responseCheck.enabled) {
      isSuccess = await checkResponse(response, webhook.responseCheck);
      message = isSuccess ? 
        `${webhook.name}: Success ✓` : 
        `${webhook.name}: Response check failed`;
    }
    
    // Show success or failure popup
    await showPopup(tab.id, message, isSuccess ? 'success' : 'error');
    
    console.log('Webhook executed:', {
      webhook: webhook.name,
      status: response.status,
      url: url,
      success: isSuccess
    });
    
  } catch (error) {
    console.error('Error executing webhook:', error);
    await showPopup(tab.id, `Error: ${error.message}`, 'error');
  }
}

async function checkResponse(response, responseCheck) {
  try {
    const { type, value } = responseCheck;
    
    if (!value) return true; // If no value specified, consider it successful
    
    switch (type) {
      case 'status_code':
        return response.status.toString() === value.toString();
        
      case 'text_contains':
        const text = await response.clone().text();
        return text.includes(value);
        
      case 'json_path':
        const json = await response.clone().json();
        const pathValue = getJsonPathValue(json, value);
        return pathValue !== undefined && pathValue !== null;
        
      default:
        return response.ok;
    }
  } catch (error) {
    console.error('Error checking response:', error);
    return false;
  }
}

function getJsonPathValue(obj, path) {
  const keys = path.split('.');
  let value = obj;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return undefined;
    }
  }
  
  return value;
}

async function showPopup(tabId, message, type) {
  if (!tabId) {
    console.error('Invalid tabId for showPopup');
    return;
  }
  
  try {
    // Check if tab still exists
    await chrome.tabs.get(tabId);
    
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (msg, popupType) => {
        // Remove any existing popup
        const existingPopup = document.getElementById('macrodroid-webhook-popup');
        if (existingPopup) {
          existingPopup.remove();
        }
        
        // Create popup
        const popup = document.createElement('div');
        popup.id = 'macrodroid-webhook-popup';
        popup.style.cssText = `
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: ${popupType === 'success' ? '#4CAF50' : popupType === 'error' ? '#f44336' : '#2196F3'};
          color: white;
          padding: 16px 24px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          font-weight: 500;
          max-width: 400px;
          animation: slideInDown 0.3s ease;
          display: flex;
          align-items: center;
          gap: 12px;
        `;
        
        // Add icon
        const icon = document.createElement('span');
        icon.style.cssText = 'font-size: 20px;';
        if (popupType === 'loading') {
          icon.textContent = '⏳';
        } else if (popupType === 'success') {
          icon.textContent = '✓';
        } else {
          icon.textContent = '✗';
        }
        
        const textSpan = document.createElement('span');
        textSpan.textContent = msg;
        
        popup.appendChild(icon);
        popup.appendChild(textSpan);
        
        // Add animation keyframes
        if (!document.getElementById('macrodroid-popup-styles')) {
          const style = document.createElement('style');
          style.id = 'macrodroid-popup-styles';
          style.textContent = `
            @keyframes slideInDown {
              from {
                transform: translate(-50%, -100px);
                opacity: 0;
              }
              to {
                transform: translateX(-50%);
                opacity: 1;
              }
            }
            @keyframes slideOutUp {
              from {
                transform: translateX(-50%);
                opacity: 1;
              }
              to {
                transform: translate(-50%, -100px);
                opacity: 0;
              }
            }
          `;
          document.head.appendChild(style);
        }
        
        document.body.appendChild(popup);
        
        // Auto-remove after delay (only for non-loading popups)
        if (popupType !== 'loading') {
          setTimeout(() => {
            popup.style.animation = 'slideOutUp 0.3s ease';
            setTimeout(() => popup.remove(), 300);
          }, 3000);
        }
      },
      args: [message, type]
    });
  } catch (error) {
    console.error('Error showing popup:', error);
  }
}

async function getPageContext(tab, linkUrl = null) {
  const context = {
    page_url: '',
    page_title: '',
    page_domain: '',
    page_protocol: '',
    selected_text: ''
  };
  
  if (!tab) {
    console.warn('No tab provided to getPageContext');
    return context;
  }
  
  try {
    // Use link URL if provided (from context menu), otherwise use tab URL
    const urlToUse = linkUrl || tab.url || '';
    context.page_url = urlToUse;
    context.page_title = tab.title || '';
    
    if (urlToUse) {
      try {
        const url = new URL(urlToUse);
        context.page_domain = url.hostname;
        context.page_protocol = url.protocol.replace(':', '');
      } catch (e) {
        console.warn('Invalid URL:', urlToUse);
      }
    }
    
    // Try to get selected text from content script
    // This may fail on restricted pages (chrome://, etc.)
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString()
      });
      
      if (results && results[0]) {
        context.selected_text = results[0].result || '';
      }
    } catch (error) {
      console.log('Could not get selected text (may be restricted page):', error.message);
    }
    
  } catch (error) {
    console.error('Error getting page context:', error);
  }
  
  return context;
}

function substituteVariables(text, context) {
  if (!text) return text;
  
  let result = text;
  
  // Replace all {variable} patterns
  Object.keys(context).forEach(key => {
    const pattern = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(pattern, context[key] || '');
  });
  
  // Add timestamp variables
  const now = new Date();
  result = result.replace(/\{timestamp\}/g, now.getTime().toString());
  result = result.replace(/\{date\}/g, now.toISOString().split('T')[0]);
  result = result.replace(/\{time\}/g, now.toTimeString().split(' ')[0]);
  result = result.replace(/\{datetime\}/g, now.toISOString());
  
  return result;
}

async function handlePopupWebhookExecution(webhookId, tabId) {
  console.log('Executing webhook from popup:', webhookId);
  const webhook = webhooks.find(wh => wh.id === webhookId);
  if (!webhook) {
    console.error('Webhook not found:', webhookId);
    return;
  }
  
  try {
    const tab = await chrome.tabs.get(tabId);
    await executeWebhook(webhook, tab);
  } catch (error) {
    console.error('Error executing webhook from popup:', error);
    // Try to show error notification
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (msg) => {
          const popup = document.createElement('div');
          popup.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 999999;
            font-family: sans-serif;
          `;
          popup.textContent = msg;
          document.body.appendChild(popup);
          setTimeout(() => popup.remove(), 3000);
        },
        args: [`Error: ${error.message}`]
      });
    } catch (e) {
      console.error('Could not show error notification:', e);
    }
  }
}
