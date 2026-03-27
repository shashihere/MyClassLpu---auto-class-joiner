/**
 * AutoClassJoiner - Popup Script
 * Handles credential storage, auto-join toggle, and status display.
 */

document.addEventListener('DOMContentLoaded', () => {
  const regNumberInput = document.getElementById('regNumber');
  const passwordInput = document.getElementById('password');
  const autoJoinToggle = document.getElementById('autoJoinToggle');
  const checkInterval = document.getElementById('checkInterval');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const togglePasswordBtn = document.getElementById('togglePassword');
  const statusDot = document.getElementById('statusDot');
  const statusLabel = document.getElementById('statusLabel');
  const statusDetail = document.getElementById('statusDetail');
  const nextClassCard = document.getElementById('nextClassCard');
  const nextClassName = document.getElementById('nextClassName');
  const nextClassTime = document.getElementById('nextClassTime');

  // Load saved data
  loadSettings();

  // Event Listeners
  saveBtn.addEventListener('click', saveSettings);
  clearBtn.addEventListener('click', clearSettings);
  togglePasswordBtn.addEventListener('click', togglePasswordVisibility);
  autoJoinToggle.addEventListener('change', onToggleChange);
  checkInterval.addEventListener('change', onIntervalChange);

  function togglePasswordVisibility() {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get([
      'regNumber', 'password', 'autoJoin', 'checkInterval',
      'status', 'nextClass', 'lastJoined'
    ]);

    if (data.regNumber) regNumberInput.value = data.regNumber;
    if (data.password) passwordInput.value = data.password;
    if (data.checkInterval) checkInterval.value = data.checkInterval;
    autoJoinToggle.checked = data.autoJoin || false;

    updateStatus(data);
  }

  async function saveSettings() {
    const regNumber = regNumberInput.value.trim();
    const password = passwordInput.value.trim();

    if (!regNumber || !password) {
      showToast('Please enter both fields', 'error');
      return;
    }

    await chrome.storage.local.set({
      regNumber,
      password,
      autoJoin: autoJoinToggle.checked,
      checkInterval: checkInterval.value
    });

    // Notify background worker
    chrome.runtime.sendMessage({
      type: 'SETTINGS_UPDATED',
      data: { regNumber, autoJoin: autoJoinToggle.checked, interval: checkInterval.value }
    });

    showToast('Credentials saved successfully!', 'success');
    updateStatusUI('saved');
  }

  async function clearSettings() {
    await chrome.storage.local.clear();
    regNumberInput.value = '';
    passwordInput.value = '';
    autoJoinToggle.checked = false;
    checkInterval.value = '2';

    chrome.runtime.sendMessage({ type: 'SETTINGS_CLEARED' });

    showToast('All data cleared', 'success');
    updateStatusUI('cleared');
  }

  function onToggleChange() {
    chrome.storage.local.set({ autoJoin: autoJoinToggle.checked });
    chrome.runtime.sendMessage({
      type: 'AUTO_JOIN_TOGGLED',
      enabled: autoJoinToggle.checked
    });
    updateStatusUI(autoJoinToggle.checked ? 'active' : 'paused');
  }

  function onIntervalChange() {
    chrome.storage.local.set({ checkInterval: checkInterval.value });
    chrome.runtime.sendMessage({
      type: 'INTERVAL_CHANGED',
      interval: checkInterval.value
    });
  }

  function updateStatus(data) {
    if (!data.regNumber) {
      updateStatusUI('empty');
    } else if (data.autoJoin) {
      updateStatusUI('active', data);
    } else {
      updateStatusUI('saved', data);
    }

    // Show next class info if available
    if (data.nextClass) {
      nextClassCard.style.display = 'flex';
      nextClassName.textContent = data.nextClass.name || 'Unknown Class';
      nextClassTime.textContent = data.nextClass.time || '—';
    }
  }

  function updateStatusUI(state, data) {
    statusDot.className = 'status-dot';

    switch (state) {
      case 'empty':
        statusLabel.textContent = 'Inactive';
        statusDetail.textContent = 'Enter credentials to begin';
        break;
      case 'saved':
        statusDot.classList.add('checking');
        statusLabel.textContent = 'Ready';
        statusDetail.textContent = 'Credentials saved · Auto-join disabled';
        break;
      case 'active':
        statusDot.classList.add('active');
        statusLabel.textContent = 'Active';
        statusDetail.textContent = 'Monitoring for classes...';
        break;
      case 'paused':
        statusLabel.textContent = 'Paused';
        statusDetail.textContent = 'Auto-join disabled';
        break;
      case 'cleared':
        statusLabel.textContent = 'Inactive';
        statusDetail.textContent = 'All data cleared';
        nextClassCard.style.display = 'none';
        break;
      case 'joined':
        statusDot.classList.add('active');
        statusLabel.textContent = 'Joined!';
        statusDetail.textContent = data?.lastJoined || 'Class joined successfully';
        break;
    }
  }

  function showToast(message, type = 'success') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // Listen for status updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATUS_UPDATE') {
      updateStatusUI(msg.status, msg.data);
    }
    if (msg.type === 'NEXT_CLASS_UPDATE') {
      nextClassCard.style.display = 'flex';
      nextClassName.textContent = msg.name || 'Unknown Class';
      nextClassTime.textContent = msg.time || '—';
    }
  });
});
