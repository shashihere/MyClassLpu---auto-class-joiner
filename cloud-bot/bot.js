/**
 * AutoClassJoiner - Cloud Bot (Puppeteer)
 * Headless browser automation for login, timetable scraping, and class joining.
 */

const puppeteer = require('puppeteer');

const LOGIN_URL = 'https://myclass.lpu.in';
const BASE_URL = 'https://lovelyprofessionaluniversity.codetantra.com';
const TIMETABLE_URL = `${BASE_URL}/secure/tla/m.jsp`;

class AutoClassBot {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.logs = [];
    this.lastCheck = null;
    this.lastJoined = null;
    this.timetable = [];
    this.status = 'idle';
  }

  log(message, level = 'info') {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const entry = { timestamp, level, message };
    this.logs.push(entry);
    // Keep only last 100 logs
    if (this.logs.length > 100) this.logs.shift();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }

  async launchBrowser() {
    if (this.browser) {
      try {
        // Check if browser is still connected
        await this.browser.version();
        return;
      } catch {
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
      }
    }

    this.log('Launching headless browser...');
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--single-process',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      defaultViewport: { width: 1280, height: 720 }
    });

    this.page = await this.browser.newPage();

    // Set a realistic user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    this.log('Browser launched successfully.');
  }

  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        this.log(`Error closing browser: ${e.message}`, 'warn');
      }
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
    }
  }

  /**
   * Login to myclass.lpu.in
   */
  async login(regNumber, password) {
    if (!regNumber || !password) {
      this.log('No credentials provided.', 'error');
      return false;
    }

    try {
      await this.launchBrowser();
      this.status = 'logging_in';
      this.log(`Logging in as ${regNumber}...`);

      await this.page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for the login form
      await this.page.waitForSelector('input[aria-label="user name"], input[placeholder="Username"]', { timeout: 10000 });

      // Fill username
      const usernameSelector = await this.page.$('input[aria-label="user name"]') ||
                                await this.page.$('input[placeholder="Username"]') ||
                                await this.page.$('input[name="i"]');

      // Fill password
      const passwordSelector = await this.page.$('#pwd-field') ||
                                await this.page.$('input[aria-label="password"]') ||
                                await this.page.$('input[placeholder="Password"]') ||
                                await this.page.$('input[name="p"]');

      if (!usernameSelector || !passwordSelector) {
        this.log('Could not find login form fields.', 'error');
        this.status = 'error';
        return false;
      }

      // Clear and type credentials
      await usernameSelector.click({ clickCount: 3 });
      await usernameSelector.type(regNumber, { delay: 50 });

      await passwordSelector.click({ clickCount: 3 });
      await passwordSelector.type(password, { delay: 50 });

      // Click login button
      const loginBtn = await this.page.$('button[name="ghost-round full-width"]') ||
                        await this.page.$('button.ghost-round');

      if (!loginBtn) {
        // Try finding by text content
        const buttons = await this.page.$$('button');
        for (const btn of buttons) {
          const text = await this.page.evaluate(el => el.textContent.trim().toLowerCase(), btn);
          if (text === 'login') {
            await btn.click();
            break;
          }
        }
      } else {
        await loginBtn.click();
      }

      this.log('Login form submitted. Waiting for redirect...');

      // Wait for navigation (login redirect)
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});

      // Check if login was successful
      const currentUrl = this.page.url();

      if (currentUrl.includes('error=invalid') || currentUrl.includes('error=')) {
        this.log('Login failed — invalid credentials.', 'error');
        this.status = 'login_failed';
        this.isLoggedIn = false;
        return false;
      }

      if (currentUrl.includes('codetantra.com') || currentUrl.includes('/secure/')) {
        this.log('Login successful!');
        this.status = 'logged_in';
        this.isLoggedIn = true;
        return true;
      }

      // Sometimes the page redirects through multiple pages
      await this.delay(3000);
      const finalUrl = this.page.url();

      if (finalUrl.includes('codetantra.com')) {
        this.log('Login successful (after redirect)!');
        this.status = 'logged_in';
        this.isLoggedIn = true;
        return true;
      }

      this.log(`Login status unclear. Current URL: ${finalUrl}`, 'warn');
      this.status = 'unknown';
      return false;

    } catch (error) {
      this.log(`Login error: ${error.message}`, 'error');
      this.status = 'error';
      return false;
    }
  }

  /**
   * Check the timetable and join any active class
   */
  async checkAndJoin(regNumber, password) {
    try {
      this.lastCheck = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      this.status = 'checking';

      // Ensure we're logged in
      if (!this.isLoggedIn) {
        const loggedIn = await this.login(regNumber, password);
        if (!loggedIn) {
          this.log('Cannot check classes — not logged in.', 'error');
          return { joined: false, error: 'Login failed' };
        }
      }

      this.log('Navigating to timetable...');
      await this.page.goto(TIMETABLE_URL, { waitUntil: 'networkidle2', timeout: 30000 });

      // Check if we got redirected to login (session expired)
      const currentUrl = this.page.url();
      if (currentUrl.includes('myclass.lpu.in') || currentUrl.includes('login')) {
        this.log('Session expired. Re-logging in...', 'warn');
        this.isLoggedIn = false;
        const loggedIn = await this.login(regNumber, password);
        if (!loggedIn) return { joined: false, error: 'Re-login failed' };
        await this.page.goto(TIMETABLE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      }

      // Wait for the calendar to render
      await this.delay(2000);

      // Try to switch to list view
      await this.switchToListView();
      await this.delay(1500);

      // Scrape classes
      const classes = await this.scrapeClasses();
      this.timetable = classes;

      if (classes.length === 0) {
        this.log('No classes found on the timetable.');
        this.status = 'no_classes';
        return { joined: false, classes: [] };
      }

      this.log(`Found ${classes.length} class(es).`);

      // Find ongoing class
      const ongoingClass = classes.find(c => c.status === 'ongoing');

      if (ongoingClass && ongoingClass.meetingId) {
        this.log(`🎓 Ongoing class found: "${ongoingClass.name}" — Joining...`);
        const joined = await this.joinClass(ongoingClass);
        if (joined) {
          this.lastJoined = {
            name: ongoingClass.name,
            time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          };
          this.status = 'joined';
          return { joined: true, className: ongoingClass.name };
        }
      } else {
        this.log('No ongoing class at the moment.');
        const upcoming = classes.find(c => c.status === 'upcoming');
        this.status = upcoming ? 'waiting' : 'no_active_class';
        return { joined: false, classes, nextClass: upcoming || null };
      }

      return { joined: false, classes };

    } catch (error) {
      this.log(`Check error: ${error.message}`, 'error');
      this.status = 'error';
      // If browser crashed, reset state
      if (error.message.includes('Target closed') || error.message.includes('Session closed')) {
        this.isLoggedIn = false;
        this.browser = null;
        this.page = null;
      }
      return { joined: false, error: error.message };
    }
  }

  /**
   * Switch the FullCalendar to list view
   */
  async switchToListView() {
    try {
      const switched = await this.page.evaluate(() => {
        const btn = document.querySelector('.fc-listView-button') ||
                    document.querySelector('.fc-listWeek-button') ||
                    document.querySelector('button[title="list view"]');
        if (btn && !btn.classList.contains('fc-state-active') && !btn.classList.contains('fc-button-active')) {
          btn.click();
          return true;
        }
        return false;
      });

      if (switched) {
        this.log('Switched to list view.');
        await this.delay(1000);
      }
    } catch (e) {
      this.log(`Could not switch to list view: ${e.message}`, 'warn');
    }
  }

  /**
   * Scrape class data from the timetable page
   */
  async scrapeClasses() {
    return await this.page.evaluate(() => {
      const classes = [];

      // Method 1: List view items
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

          let meetingId = '';
          if (link && link.href) {
            try {
              const url = new URL(link.href);
              meetingId = url.searchParams.get('m') || '';
            } catch {}
          }

          // Determine status by marker color
          let status = 'unknown';
          const marker = markerCell ? (markerCell.querySelector('.fc-event-dot, .fc-list-event-dot') || markerCell.querySelector('span')) : null;

          if (marker) {
            const style = getComputedStyle(marker);
            const bgColor = style.backgroundColor || marker.style.backgroundColor || '';
            const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

            if (match) {
              const [, r, g, b] = match.map(Number);
              if (g > 100 && g > r * 1.5 && g > b * 1.5) {
                status = 'ongoing';
              } else if (Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && r > 80 && r < 200) {
                status = 'ended';
              } else {
                status = 'upcoming';
              }
            }
          }

          classes.push({ name, time, meetingId, status });
        });
      }

      // Method 2: Any join links
      if (classes.length === 0) {
        const links = document.querySelectorAll('a[href*="mi.jsp"]');
        links.forEach(link => {
          try {
            const url = new URL(link.href);
            const meetingId = url.searchParams.get('m') || '';
            classes.push({
              name: link.textContent.trim(),
              time: '',
              meetingId,
              status: 'unknown'
            });
          } catch {}
        });
      }

      // Method 3: Direct join buttons
      document.querySelectorAll('a[href*="jnr.jsp"]').forEach(btn => {
        const match = btn.href.match(/m=([a-f0-9-]+)/i);
        if (match) {
          const meetingId = match[1];
          const existing = classes.find(c => c.meetingId === meetingId);
          if (!existing) {
            classes.push({
              name: btn.textContent.trim() || 'Live Class',
              time: '',
              meetingId,
              status: 'ongoing'
            });
          } else {
            existing.status = 'ongoing';
          }
        }
      });

      return classes;
    });
  }

  /**
   * Join a class by navigating to the join URL
   */
  async joinClass(classInfo) {
    try {
      const joinUrl = `${BASE_URL}/secure/tla/jnr.jsp?m=${classInfo.meetingId}`;
      this.log(`Navigating to join URL: ${joinUrl}`);

      await this.page.goto(joinUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      await this.delay(2000);

      // Check if join was successful
      const pageContent = await this.page.evaluate(() => document.body.innerText);

      if (pageContent.includes('Too late') || pageContent.includes('already ended')) {
        this.log('Class has already ended.', 'warn');
        return false;
      }

      this.log(`✅ Successfully joined class: "${classInfo.name}"`);
      return true;

    } catch (error) {
      this.log(`Error joining class: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Get current status for the dashboard
   */
  getStatus() {
    return {
      status: this.status,
      isLoggedIn: this.isLoggedIn,
      lastCheck: this.lastCheck,
      lastJoined: this.lastJoined,
      timetable: this.timetable,
      logs: this.logs.slice(-30),  // Last 30 logs
      uptime: process.uptime()
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AutoClassBot;
