/**
 * AutoClassJoiner - Login Content Script
 * Runs on myclass.lpu.in to auto-fill credentials and submit the login form.
 */

(async function autoLogin() {
  'use strict';

  // Only run on the login page (not error or redirect pages with a session)
  const isLoginPage = document.querySelector('input[aria-label="user name"]') ||
                      document.querySelector('input[placeholder="Username"]');

  if (!isLoginPage) {
    console.log('[AutoClassJoiner] Not a login page, skipping.');
    return;
  }

  console.log('[AutoClassJoiner] Login page detected. Checking for saved credentials...');

  // Get saved credentials
  const data = await chrome.storage.local.get(['regNumber', 'password', 'autoJoin']);

  if (!data.regNumber || !data.password) {
    console.log('[AutoClassJoiner] No saved credentials found.');
    return;
  }

  console.log('[AutoClassJoiner] Credentials found. Auto-filling...');

  // Small delay to ensure page is fully interactive
  await delay(800);

  // Fill username
  const usernameField = document.querySelector('input[aria-label="user name"]') ||
                        document.querySelector('input[placeholder="Username"]') ||
                        document.querySelector('input[name="i"]');

  // Fill password
  const passwordField = document.querySelector('#pwd-field') ||
                        document.querySelector('input[aria-label="password"]') ||
                        document.querySelector('input[placeholder="Password"]') ||
                        document.querySelector('input[name="p"]');

  if (!usernameField || !passwordField) {
    console.error('[AutoClassJoiner] Could not find login form fields.');
    return;
  }

  // Simulate natural typing by setting value and dispatching input events
  setNativeValue(usernameField, data.regNumber);
  setNativeValue(passwordField, data.password);

  console.log('[AutoClassJoiner] Credentials filled. Submitting form...');

  // Small delay before clicking login
  await delay(500);

  // Find and click the login button
  const loginButton = document.querySelector('button[name="ghost-round full-width"]') ||
                      document.querySelector('button.ghost-round') ||
                      Array.from(document.querySelectorAll('button')).find(
                        btn => btn.textContent.trim().toLowerCase() === 'login'
                      );

  if (loginButton) {
    loginButton.click();
    console.log('[AutoClassJoiner] Login button clicked!');

    // Notify background about login attempt
    chrome.runtime.sendMessage({ type: 'LOGIN_ATTEMPTED' });
  } else {
    console.error('[AutoClassJoiner] Could not find login button.');
  }

  // Check for login errors after a delay
  setTimeout(() => {
    const url = window.location.href;
    if (url.includes('error=invalid') || url.includes('error=')) {
      console.error('[AutoClassJoiner] Login failed - invalid credentials.');
      chrome.runtime.sendMessage({
        type: 'LOGIN_FAILED',
        error: 'Invalid credentials. Please check your registration number and password.'
      });
    }
  }, 3000);

  /**
   * Set value on an input field and trigger proper events
   * so frameworks/vanilla JS detect the change.
   */
  function setNativeValue(element, value) {
    // Focus the element
    element.focus();
    element.dispatchEvent(new Event('focus', { bubbles: true }));

    // Use native setter to bypass React/Vue value management
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(element, value);

    // Dispatch all relevant events
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
