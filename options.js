// Options page JavaScript

let webhooks = [];
let editingWebhookId = null;

// Load webhooks on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadWebhooks();
  renderWebhooksList();
  setupEventListeners();
});

async function loadWebhooks() {
  const data = await chrome.storage.local.get('webhooks');
  webhooks = data.webhooks || [];
}

async function saveWebhooks() {
  await chrome.storage.local.set({ webhooks: webhooks });
}

function setupEventListeners() {
  // Add webhook button
  document.getElementById('addWebhookBtn').addEventListener('click', () => {
    openModal();
  });

  // Close modal
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);

  // Click outside modal to close
  document.getElementById('webhookModal').addEventListener('click', (e) => {
    if (e.target.id === 'webhookModal') {
      closeModal();
    }
  });

  // Form submission
  document.getElementById('webhookForm').addEventListener('submit', handleFormSubmit);

  // Add header/param buttons
  document.getElementById('addHeaderBtn').addEventListener('click', () => addKeyValuePair('headersList'));
  document.getElementById('addParamBtn').addEventListener('click', () => {
    addKeyValuePair('paramsList');
    setTimeout(updateUrlPreview, 100);
  });
  
  // Response check toggle
  document.getElementById('enableResponseCheck').addEventListener('change', (e) => {
    document.getElementById('responseCheckOptions').style.display = e.target.checked ? 'block' : 'none';
  });
  
  // Response type change - update hint
  document.getElementById('responseType').addEventListener('change', updateResponseHint);
  
  // URL preview listeners
  document.getElementById('webhookUrl').addEventListener('input', updateUrlPreview);
  document.getElementById('webhookUrl').addEventListener('change', updateUrlPreview);
}

function renderWebhooksList() {
  const container = document.getElementById('webhooksList');
  
  if (webhooks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No webhooks configured yet</p>
        <p>Click "Add Webhook" to create your first webhook</p>
      </div>
    `;
    return;
  }

  container.innerHTML = webhooks.map(webhook => `
    <div class="webhook-card" data-id="${webhook.id}">
      <div class="webhook-header">
        <div class="webhook-info">
          <h3>${escapeHtml(webhook.name)}</h3>
          <span class="webhook-url">${escapeHtml(webhook.url)}</span>
        </div>
        <div class="webhook-badges">
          ${webhook.showInContextMenu ? '<span class="badge">Context Menu</span>' : ''}
          ${webhook.responseCheck && webhook.responseCheck.enabled ? '<span class="badge badge-check">Response Check</span>' : ''}
          <span class="badge method-badge">${webhook.method || 'POST'}</span>
        </div>
      </div>
      <div class="webhook-details">
        ${webhook.loadingText ? 
          `<div class="detail-item"><strong>Loading:</strong> "${escapeHtml(webhook.loadingText)}"</div>` : ''}
        ${webhook.headers && webhook.headers.length > 0 ? 
          `<div class="detail-item"><strong>Headers:</strong> ${webhook.headers.length}</div>` : ''}
        ${webhook.params && webhook.params.length > 0 ? 
          `<div class="detail-item"><strong>Params:</strong> ${webhook.params.length}</div>` : ''}
        ${webhook.payload ? 
          `<div class="detail-item"><strong>Payload:</strong> Yes</div>` : ''}
      </div>
      <div class="webhook-actions">
        <button class="btn btn-small btn-secondary edit-webhook-btn" data-id="${webhook.id}">Edit</button>
        <button class="btn btn-small btn-danger delete-webhook-btn" data-id="${webhook.id}">Delete</button>
        <button class="btn btn-small btn-primary test-webhook-btn" data-id="${webhook.id}">Test</button>
      </div>
    </div>
  `).join('');
  
  // Add event listeners using event delegation
  container.querySelectorAll('.edit-webhook-btn').forEach(btn => {
    btn.addEventListener('click', () => editWebhook(btn.dataset.id));
  });
  
  container.querySelectorAll('.delete-webhook-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteWebhook(btn.dataset.id));
  });
  
  container.querySelectorAll('.test-webhook-btn').forEach(btn => {
    btn.addEventListener('click', () => testWebhook(btn.dataset.id));
  });
}

function openModal(webhook = null) {
  const modal = document.getElementById('webhookModal');
  const form = document.getElementById('webhookForm');
  const modalTitle = document.getElementById('modalTitle');
  
  if (webhook) {
    // Edit mode
    modalTitle.textContent = 'Edit Webhook';
    editingWebhookId = webhook.id;
    
    document.getElementById('webhookId').value = webhook.id;
    document.getElementById('webhookName').value = webhook.name;
    document.getElementById('webhookUrl').value = webhook.url;
    document.getElementById('webhookMethod').value = webhook.method || 'POST';
    document.getElementById('webhookPayload').value = webhook.payload || '';
    document.getElementById('loadingText').value = webhook.loadingText || 'Executing webhook...';
    document.getElementById('showInContextMenu').checked = webhook.showInContextMenu || false;
    
    // Response check
    const enableResponseCheck = webhook.responseCheck && webhook.responseCheck.enabled;
    document.getElementById('enableResponseCheck').checked = enableResponseCheck;
    document.getElementById('responseCheckOptions').style.display = enableResponseCheck ? 'block' : 'none';
    
    if (webhook.responseCheck) {
      document.getElementById('responseType').value = webhook.responseCheck.type || 'status_code';
      document.getElementById('responseValue').value = webhook.responseCheck.value || '';
    }
    
    // Populate headers
    const headersList = document.getElementById('headersList');
    headersList.innerHTML = '';
    if (webhook.headers && webhook.headers.length > 0) {
      webhook.headers.forEach(header => {
        addKeyValuePair('headersList', header.key, header.value);
      });
    }
    
    // Populate params
    const paramsList = document.getElementById('paramsList');
    paramsList.innerHTML = '';
    if (webhook.params && webhook.params.length > 0) {
      webhook.params.forEach(param => {
        addKeyValuePair('paramsList', param.key, param.value);
      });
    }
  } else {
    // Add mode
    modalTitle.textContent = 'Add Webhook';
    editingWebhookId = null;
    form.reset();
    document.getElementById('loadingText').value = 'Executing webhook...';
    document.getElementById('headersList').innerHTML = '';
    document.getElementById('paramsList').innerHTML = '';
    document.getElementById('responseCheckOptions').style.display = 'none';
  }
  
  updateResponseHint();
  updateUrlPreview();
  modal.style.display = 'block';
}

function closeModal() {
  document.getElementById('webhookModal').style.display = 'none';
  document.getElementById('webhookForm').reset();
  editingWebhookId = null;
}

function addKeyValuePair(listId, key = '', value = '') {
  const container = document.getElementById(listId);
  const pairDiv = document.createElement('div');
  pairDiv.className = 'key-value-pair';
  
  pairDiv.innerHTML = `
    <input type="text" class="key-input" placeholder="Key" value="${escapeHtml(key)}">
    <input type="text" class="value-input" placeholder="Value" value="${escapeHtml(value)}">
    <button type="button" class="btn btn-small btn-danger remove-btn">Remove</button>
  `;
  
  pairDiv.querySelector('.remove-btn').addEventListener('click', () => {
    pairDiv.remove();
    updateUrlPreview();
  });
  
  // Add input listeners for URL preview
  pairDiv.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', updateUrlPreview);
  });
  
  container.appendChild(pairDiv);
}

function getKeyValuePairs(listId) {
  const container = document.getElementById(listId);
  const pairs = [];
  
  container.querySelectorAll('.key-value-pair').forEach(pair => {
    const key = pair.querySelector('.key-input').value.trim();
    const value = pair.querySelector('.value-input').value.trim();
    
    if (key || value) {
      pairs.push({ key, value });
    }
  });
  
  return pairs;
}

async function handleFormSubmit(e) {
  e.preventDefault();
  
  const webhook = {
    id: editingWebhookId || generateId(),
    name: document.getElementById('webhookName').value.trim(),
    url: document.getElementById('webhookUrl').value.trim(),
    method: document.getElementById('webhookMethod').value,
    headers: getKeyValuePairs('headersList'),
    params: getKeyValuePairs('paramsList'),
    payload: document.getElementById('webhookPayload').value.trim(),
    loadingText: document.getElementById('loadingText').value.trim() || 'Executing webhook...',
    showInContextMenu: document.getElementById('showInContextMenu').checked,
    responseCheck: {
      enabled: document.getElementById('enableResponseCheck').checked,
      type: document.getElementById('responseType').value,
      value: document.getElementById('responseValue').value.trim()
    }
  };
  
  if (editingWebhookId) {
    // Update existing webhook
    const index = webhooks.findIndex(wh => wh.id === editingWebhookId);
    if (index !== -1) {
      webhooks[index] = webhook;
    }
  } else {
    // Add new webhook
    webhooks.push(webhook);
  }
  
  await saveWebhooks();
  renderWebhooksList();
  closeModal();
  
  showNotification('Webhook saved successfully!');
}

function editWebhook(id) {
  const webhook = webhooks.find(wh => wh.id === id);
  if (webhook) {
    openModal(webhook);
  }
}

async function deleteWebhook(id) {
  if (confirm('Are you sure you want to delete this webhook?')) {
    webhooks = webhooks.filter(wh => wh.id !== id);
    await saveWebhooks();
    renderWebhooksList();
    showNotification('Webhook deleted');
  }
};

async function testWebhook(id) {
  const webhook = webhooks.find(wh => wh.id === id);
  if (!webhook) return;
  
  try {
    // Get current tab info for testing
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Create test context
    const context = {
      page_url: 'https://example.com/test',
      page_title: 'Test Page',
      page_domain: 'example.com',
      page_protocol: 'https',
      selected_text: 'Test selection'
    };
    
    // Show what will be sent
    let testUrl = substituteVariables(webhook.url, context);
    
    const testInfo = {
      url: testUrl,
      method: webhook.method || 'POST',
      headers: webhook.headers || [],
      params: webhook.params || [],
      payload: webhook.payload || '',
      loadingText: webhook.loadingText || 'Executing webhook...'
    };
    
    // Add params to URL
    if (testInfo.params.length > 0) {
      const urlObj = new URL(testUrl);
      testInfo.params.forEach(param => {
        if (param.key && param.value) {
          urlObj.searchParams.append(
            param.key,
            substituteVariables(param.value, context)
          );
        }
      });
      testInfo.url = urlObj.toString();
    }
    
    let responseCheckMsg = '';
    if (webhook.responseCheck && webhook.responseCheck.enabled) {
      responseCheckMsg = `\n\nResponse Check:\n- Type: ${webhook.responseCheck.type}\n- Expected: ${webhook.responseCheck.value}`;
    }
    
    let paramsMsg = '';
    if (testInfo.params.length > 0) {
      paramsMsg = '\n\nParams: ' + testInfo.params.map(p => `${p.key}=${p.value}`).join(', ');
    }
    
    const message = `Test Webhook: ${webhook.name}\n\nURL: ${testInfo.url}\nMethod: ${testInfo.method}${paramsMsg}\nLoading Text: "${testInfo.loadingText}"${responseCheckMsg}\n\nNote: This is a preview with example values. The actual webhook will use real page data when executed.\n\nClick OK to see the loading popup (test execution).`;
    
    if (confirm(message)) {
      showNotification(`Test: ${testInfo.loadingText}`);
      setTimeout(() => {
        showNotification(`Test: ${webhook.name} - Success ✓`);
      }, 1500);
      
      console.log('Test Webhook:', testInfo);
    }
  } catch (error) {
    console.error('Test error:', error);
    showNotification('Test failed: ' + error.message);
  }
};

function substituteVariables(text, context) {
  if (!text) return text;
  
  let result = text;
  
  Object.keys(context).forEach(key => {
    const pattern = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(pattern, context[key] || '');
  });
  
  const now = new Date();
  result = result.replace(/\{timestamp\}/g, now.getTime().toString());
  result = result.replace(/\{date\}/g, now.toISOString().split('T')[0]);
  result = result.replace(/\{time\}/g, now.toTimeString().split(' ')[0]);
  result = result.replace(/\{datetime\}/g, now.toISOString());
  
  return result;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateUrlPreview() {
  const previewEl = document.getElementById('urlPreview');
  const url = document.getElementById('webhookUrl').value.trim();
  
  if (!url) {
    previewEl.innerHTML = '<code>Configure URL and params to see preview</code>';
    return;
  }
  
  try {
    const context = {
      page_url: 'https://example.com/page',
      page_title: 'Example Page',
      page_domain: 'example.com'
    };
    
    let previewUrl = substituteVariables(url, context);
    const params = getKeyValuePairs('paramsList');
    
    if (params.length > 0) {
      const urlObj = new URL(previewUrl);
      params.forEach(param => {
        if (param.key) {
          const value = substituteVariables(param.value, context);
          urlObj.searchParams.append(param.key, value);
        }
      });
      previewUrl = urlObj.toString();
    }
    
    previewEl.innerHTML = `<code>${escapeHtml(previewUrl)}</code>`;
  } catch (e) {
    previewEl.innerHTML = '<code style="color: #ea4335;">Invalid URL format</code>';
  }
}

function updateResponseHint() {
  const type = document.getElementById('responseType').value;
  const hint = document.getElementById('responseValueHint');
  
  const hints = {
    status_code: 'e.g., 200 for success, 201 for created',
    text_contains: 'e.g., "success" or "OK" - checks if response body contains this text',
    json_path: 'e.g., "status" to check response.status, or "data.success" for nested values'
  };
  
  hint.textContent = hints[type] || '';
}

function showNotification(message) {
  // Remove any existing notification
  const existing = document.querySelector('.webhook-notification');
  if (existing) {
    existing.remove();
  }
  
  const notification = document.createElement('div');
  notification.className = 'webhook-notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #4CAF50;
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    animation: slideInDown 0.3s ease;
  `;
  
  // Add animation keyframes if not already present
  if (!document.getElementById('webhook-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'webhook-notification-styles';
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
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOutUp 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}
