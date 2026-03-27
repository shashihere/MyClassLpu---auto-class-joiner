/**
 * AutoClassJoiner - Dashboard Content Script
 * Runs on lovelyprofessionaluniversity.codetantra.com
 * Scrapes the timetable, identifies active classes, and auto-joins.
 */

(async function dashboardMonitor() {
  'use strict';

  const BASE_URL = 'https://lovelyprofessionaluniversity.codetantra.com';
  const TIMETABLE_PATH = '/secure/tla/m.jsp';
  const JOIN_PATH = '/secure/tla/jnr.jsp';
  const MEETING_INFO_PATH = '/secure/tla/mi.jsp';

  console.log('[AutoClassJoiner] Dashboard content script loaded.');

  // Check if auto-join is enabled
  const settings = await chrome.storage.local.get(['autoJoin', 'regNumber']);

  if (!settings.regNumber) {
    console.log('[AutoClassJoiner] No credentials saved. Skipping dashboard monitor.');
    return;
  }

  // Notify background that we're on the dashboard (login succeeded)
  chrome.runtime.sendMessage({ type: 'LOGIN_SUCCESS' });

  // Determine what page we're on
  const currentPath = window.location.pathname;

  if (currentPath.includes('/secure/tla/m.jsp') || currentPath.includes('/secure/tla/')) {
    console.log('[AutoClassJoiner] On timetable/dashboard page.');
    await handleTimetablePage();
  }

  /**
   * Main handler for the timetable page
   * Scans for classes and auto-joins if one is active
   */
  async function handleTimetablePage() {
    // Wait for the page to fully render (FullCalendar is JS-rendered)
    await waitForElement('.fc-view-container, .fc-view-harness, .fc-list-table, table', 10000);

    // Try to switch to List View for easier parsing
    await switchToListView();

    // Wait a bit for the view to render
    await delay(1500);

    // Scan for classes
    const classes = scrapeClasses();

    if (classes.length > 0) {
      console.log(`[AutoClassJoiner] Found ${classes.length} class(es):`, classes);

      // Send timetable to background
      chrome.runtime.sendMessage({
        type: 'TIMETABLE_DATA',
        classes: classes
      });

      // Find active/ongoing class
      const activeClass = classes.find(c => c.status === 'ongoing');

      if (activeClass && settings.autoJoin) {
        console.log('[AutoClassJoiner] Active class found! Joining:', activeClass.name);
        joinClass(activeClass);
      } else if (activeClass) {
        console.log('[AutoClassJoiner] Active class found but auto-join is disabled.');
      } else {
        console.log('[AutoClassJoiner] No active class at the moment.');

        // Find next upcoming class
        const nextClass = classes.find(c => c.status === 'upcoming');
        if (nextClass) {
          chrome.runtime.sendMessage({
            type: 'NEXT_CLASS',
            name: nextClass.name,
            time: nextClass.time,
            meetingId: nextClass.meetingId
          });
        }
      }
    } else {
      console.log('[AutoClassJoiner] No classes found on the timetable.');
    }

    // Set up a MutationObserver to watch for dynamic changes
    setupObserver();
  }

  /**
   * Switch to list view for easier DOM parsing
   */
  async function switchToListView() {
    const listViewBtn = document.querySelector('.fc-listView-button') ||
                        document.querySelector('.fc-listWeek-button') ||
                        document.querySelector('button[title="list view"]');

    if (listViewBtn && !listViewBtn.classList.contains('fc-state-active') &&
        !listViewBtn.classList.contains('fc-button-active')) {
      listViewBtn.click();
      console.log('[AutoClassJoiner] Switched to list view.');
      await delay(1000);
    }
  }

  /**
   * Scrape classes from the timetable DOM
   * Works with both list view and calendar view
   */
  function scrapeClasses() {
    const classes = [];

    // Try List View first (fc-list-item rows)
    const listItems = document.querySelectorAll('tr.fc-list-item');

    if (listItems.length > 0) {
      listItems.forEach(row => {
        const timeCell = row.querySelector('td.fc-list-item-time');
        const titleCell = row.querySelector('td.fc-list-item-title');
        const markerCell = row.querySelector('td.fc-list-item-marker');

        if (!titleCell) return;

        const link = titleCell.querySelector('a');
        const time = timeCell ? timeCell.textContent.trim() : '';
        const name = link ? link.textContent.trim() : titleCell.textContent.trim();

        // Extract meeting ID from href
        let meetingId = '';
        if (link && link.href) {
          const urlParams = new URL(link.href).searchParams;
          meetingId = urlParams.get('m') || '';
        }

        // Determine status by marker color
        let status = 'unknown';
        const marker = markerCell ? markerCell.querySelector('span') : null;
        if (marker) {
          const bgColor = getComputedStyle(marker).backgroundColor ||
                          marker.style.backgroundColor;
          if (isGreenColor(bgColor)) {
            status = 'ongoing';
          } else if (isGrayColor(bgColor)) {
            status = 'ended';
          } else {
            status = 'upcoming';
          }
        }

        // Also check the dot/circle element that might contain the status
        const dotEl = markerCell ? markerCell.querySelector('.fc-event-dot, .fc-list-event-dot') : null;
        if (dotEl) {
          const dotBg = getComputedStyle(dotEl).backgroundColor || dotEl.style.backgroundColor;
          if (isGreenColor(dotBg)) {
            status = 'ongoing';
          } else if (isGrayColor(dotBg)) {
            status = 'ended';
          }
        }

        classes.push({ name, time, meetingId, status });
      });
    }

    // Fallback: try parsing any table with class data
    if (classes.length === 0) {
      const allLinks = document.querySelectorAll('a[href*="mi.jsp"]');
      allLinks.forEach(link => {
        const urlParams = new URL(link.href).searchParams;
        const meetingId = urlParams.get('m') || '';
        const name = link.textContent.trim();

        classes.push({ name, time: '', meetingId, status: 'unknown' });
      });
    }

    // Also try to find "Join" buttons directly
    const joinButtons = document.querySelectorAll('a[href*="jnr.jsp"], button[onclick*="jnr.jsp"]');
    joinButtons.forEach(btn => {
      const href = btn.href || btn.getAttribute('onclick') || '';
      const match = href.match(/m=([a-f0-9-]+)/i);
      if (match) {
        const meetingId = match[1];
        // Check if we already have this meeting
        const exists = classes.find(c => c.meetingId === meetingId);
        if (!exists) {
          classes.push({
            name: btn.textContent.trim() || 'Live Class',
            time: '',
            meetingId,
            status: 'ongoing'
          });
        } else {
          // Mark it as ongoing since it has a join button
          exists.status = 'ongoing';
        }
      }
    });

    return classes;
  }

  /**
   * Join a class by navigating to the join URL
   */
  function joinClass(classInfo) {
    if (!classInfo.meetingId) {
      console.error('[AutoClassJoiner] No meeting ID found for class:', classInfo.name);
      return;
    }

    const joinUrl = `${BASE_URL}${JOIN_PATH}?m=${classInfo.meetingId}`;

    console.log(`[AutoClassJoiner] Joining class: ${classInfo.name} at ${joinUrl}`);

    // Notify background
    chrome.runtime.sendMessage({
      type: 'JOINING_CLASS',
      name: classInfo.name,
      meetingId: classInfo.meetingId
    });

    // Navigate to the join URL
    window.location.href = joinUrl;
  }

  /**
   * Set up MutationObserver to detect dynamic DOM changes
   * (e.g., when a class starts and the timetable updates)
   */
  function setupObserver() {
    const target = document.querySelector('.fc-view-container, .fc-view-harness, #calendar, main, body');
    if (!target) return;

    let debounceTimer;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (!settings.autoJoin) return;

        console.log('[AutoClassJoiner] DOM changed, re-scanning classes...');
        const classes = scrapeClasses();
        const activeClass = classes.find(c => c.status === 'ongoing');

        if (activeClass) {
          console.log('[AutoClassJoiner] New active class detected:', activeClass.name);
          joinClass(activeClass);
        }
      }, 3000);
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    console.log('[AutoClassJoiner] MutationObserver set up for live updates.');
  }

  // ========== Utility Functions ==========

  function isGreenColor(rgb) {
    if (!rgb) return false;
    const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    const [, r, g, b] = match.map(Number);
    return g > 100 && g > r * 1.5 && g > b * 1.5;
  }

  function isGrayColor(rgb) {
    if (!rgb) return false;
    const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    const [, r, g, b] = match.map(Number);
    return Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && r > 80 && r < 200;
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CHECK_CLASSES') {
      const classes = scrapeClasses();
      sendResponse({ classes });
    }
    if (msg.type === 'FORCE_JOIN') {
      const classes = scrapeClasses();
      const activeClass = classes.find(c => c.status === 'ongoing');
      if (activeClass) {
        joinClass(activeClass);
        sendResponse({ joined: true, className: activeClass.name });
      } else {
        sendResponse({ joined: false });
      }
    }
    return true; // Keep message channel open for async response
  });
})();
