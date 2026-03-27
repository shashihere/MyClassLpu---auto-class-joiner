/**
 * AutoClassJoiner - Background Service Worker
 * Manages alarms, schedules checks, opens/refreshes the dashboard tab,
 * and coordinates between popup and content scripts.
 */

const BASE_URL = 'https://lovelyprofessionaluniversity.codetantra.com';
const LOGIN_URL = 'https://myclass.lpu.in';
const TIMETABLE_URL = `${BASE_URL}/secure/tla/m.jsp`;
const ALARM_NAME = 'autoClassCheck';

// ========== Initialization ==========

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AutoClassJoiner] Extension installed/updated.');
  initializeAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[AutoClassJoiner] Browser started.');
  initializeAlarm();
});

// ========== Alarm Management ==========

async function initializeAlarm() {
  const data = await chrome.storage.local.get(['autoJoin', 'checkInterval', 'regNumber']);

  if (data.autoJoin && data.regNumber) {
    startAlarm(parseInt(data.checkInterval) || 2);
    console.log('[AutoClassJoiner] Alarm initialized. Checking every', data.checkInterval || 2, 'minutes.');
  } else {
    chrome.alarms.clear(ALARM_NAME);
    console.log('[AutoClassJoiner] Auto-join not enabled or no credentials. Alarm cleared.');
  }
}

function startAlarm(intervalMinutes) {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.1,  // Start checking almost immediately
    periodInMinutes: intervalMinutes
  });
}

// ========== Alarm Handler ==========

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  console.log('[AutoClassJoiner] Alarm fired. Checking for classes...');

  const data = await chrome.storage.local.get(['autoJoin', 'regNumber', 'password']);

  if (!data.autoJoin || !data.regNumber) {
    console.log('[AutoClassJoiner] Auto-join disabled or no credentials. Skipping.');
    return;
  }

  await checkAndJoinClass();
});

// ========== Core Logic ==========

async function checkAndJoinClass() {
  try {
    // Find or create a tab with the timetable
    let tab = await findDashboardTab();

    if (tab) {
      // Refresh the existing tab to get latest timetable
      console.log('[AutoClassJoiner] Refreshing existing dashboard tab...');
      await chrome.tabs.reload(tab.id);
    } else {
      // Check if we need to login first
      console.log('[AutoClassJoiner] No dashboard tab found. Opening login page...');
      tab = await chrome.tabs.create({
        url: LOGIN_URL,
        active: false  // Open in background
      });
    }

    // The content scripts will handle the rest:
    // - login.js fills credentials on myclass.lpu.in
    // - dashboard.js scrapes timetable and joins classes on the CodeTantra domain

  } catch (error) {
    console.error('[AutoClassJoiner] Error during check:', error);
  }
}

async function findDashboardTab() {
  const tabs = await chrome.tabs.query({
    url: [
      '*://lovelyprofessionaluniversity.codetantra.com/*',
      '*://myclass.lpu.in/*'
    ]
  });

  return tabs.length > 0 ? tabs[0] : null;
}

// ========== Message Handlers ==========

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'SETTINGS_UPDATED':
      handleSettingsUpdate(msg.data);
      break;

    case 'SETTINGS_CLEARED':
      chrome.alarms.clear(ALARM_NAME);
      chrome.storage.local.set({ status: 'inactive' });
      console.log('[AutoClassJoiner] Settings cleared. Alarm stopped.');
      break;

    case 'AUTO_JOIN_TOGGLED':
      if (msg.enabled) {
        chrome.storage.local.get(['checkInterval'], (data) => {
          startAlarm(parseInt(data.checkInterval) || 2);
        });
        console.log('[AutoClassJoiner] Auto-join enabled. Starting alarm.');
      } else {
        chrome.alarms.clear(ALARM_NAME);
        console.log('[AutoClassJoiner] Auto-join disabled. Alarm stopped.');
      }
      break;

    case 'INTERVAL_CHANGED':
      chrome.storage.local.get(['autoJoin'], (data) => {
        if (data.autoJoin) {
          chrome.alarms.clear(ALARM_NAME, () => {
            startAlarm(parseInt(msg.interval) || 2);
          });
          console.log('[AutoClassJoiner] Check interval changed to', msg.interval, 'minutes.');
        }
      });
      break;

    case 'LOGIN_ATTEMPTED':
      chrome.storage.local.set({ status: 'logging_in' });
      console.log('[AutoClassJoiner] Login attempt in progress...');
      break;

    case 'LOGIN_SUCCESS':
      chrome.storage.local.set({ status: 'logged_in' });
      console.log('[AutoClassJoiner] Login successful!');

      // After successful login, navigate to timetable
      if (sender.tab) {
        setTimeout(() => {
          chrome.tabs.update(sender.tab.id, { url: TIMETABLE_URL });
        }, 2000);
      }
      break;

    case 'LOGIN_FAILED':
      chrome.storage.local.set({
        status: 'error',
        lastError: msg.error
      });

      // Show notification
      showNotification('Login Failed', msg.error);
      console.error('[AutoClassJoiner] Login failed:', msg.error);
      break;

    case 'TIMETABLE_DATA':
      handleTimetableData(msg.classes);
      break;

    case 'NEXT_CLASS':
      chrome.storage.local.set({
        nextClass: {
          name: msg.name,
          time: msg.time,
          meetingId: msg.meetingId
        }
      });
      console.log('[AutoClassJoiner] Next class:', msg.name, 'at', msg.time);
      break;

    case 'JOINING_CLASS':
      chrome.storage.local.set({
        status: 'joining',
        lastJoined: msg.name,
        lastJoinedTime: new Date().toISOString()
      });

      showNotification('Joining Class!', `Auto-joining: ${msg.name}`);
      console.log('[AutoClassJoiner] Joining class:', msg.name);
      break;
  }

  sendResponse({ received: true });
  return true;
});

// ========== Helper Functions ==========

function handleSettingsUpdate(data) {
  if (data.autoJoin) {
    startAlarm(parseInt(data.interval) || 2);
    console.log('[AutoClassJoiner] Settings updated. Alarm started.');
  } else {
    chrome.alarms.clear(ALARM_NAME);
  }
}

function handleTimetableData(classes) {
  if (!classes || classes.length === 0) return;

  // Store timetable
  chrome.storage.local.set({ timetable: classes });

  // Find next upcoming or ongoing class
  const ongoing = classes.find(c => c.status === 'ongoing');
  const upcoming = classes.find(c => c.status === 'upcoming');

  if (ongoing) {
    chrome.storage.local.set({
      nextClass: { name: ongoing.name, time: ongoing.time },
      status: 'class_active'
    });
  } else if (upcoming) {
    chrome.storage.local.set({
      nextClass: { name: upcoming.name, time: upcoming.time },
      status: 'waiting'
    });
  }
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `AutoClassJoiner - ${title}`,
    message: message,
    priority: 2
  }).catch(() => {
    // Notifications permission might not be available
    console.log('[AutoClassJoiner] Notification:', title, '-', message);
  });
}
