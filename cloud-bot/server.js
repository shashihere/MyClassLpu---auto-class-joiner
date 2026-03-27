/**
 * AutoClassJoiner - Cloud Server
 * Express server + Cron scheduler for Render deployment.
 */

const express = require('express');
const cron = require('node-cron');
const path = require('path');
const AutoClassBot = require('./bot');

const app = express();
const bot = new AutoClassBot();
const PORT = process.env.PORT || 3000;

// Credentials from environment variables (or set via dashboard)
let credentials = {
  regNumber: process.env.REG_NUMBER || '',
  password: process.env.PASSWORD || ''
};

let cronJob = null;
let botEnabled = true;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== API Routes ==========

// Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get bot status
app.get('/api/status', (req, res) => {
  const status = bot.getStatus();
  res.json({
    ...status,
    botEnabled,
    hasCredentials: !!(credentials.regNumber && credentials.password),
    regNumber: credentials.regNumber ? credentials.regNumber.substring(0, 4) + '****' : '',
    cronRunning: cronJob !== null
  });
});

// Update credentials
app.post('/api/credentials', (req, res) => {
  const { regNumber, password } = req.body;

  if (!regNumber || !password) {
    return res.status(400).json({ error: 'Both registration number and password are required.' });
  }

  credentials.regNumber = regNumber;
  credentials.password = password;

  bot.log(`Credentials updated for ${regNumber.substring(0, 4)}****`);

  // Restart cron if enabled
  if (botEnabled) {
    startCronJob();
  }

  res.json({ success: true, message: 'Credentials saved.' });
});

// Toggle bot on/off
app.post('/api/toggle', (req, res) => {
  botEnabled = !botEnabled;

  if (botEnabled) {
    startCronJob();
    bot.log('Bot ENABLED.');
  } else {
    stopCronJob();
    bot.log('Bot DISABLED.');
  }

  res.json({ success: true, enabled: botEnabled });
});

// Manually trigger a check
app.post('/api/trigger', async (req, res) => {
  if (!credentials.regNumber || !credentials.password) {
    return res.status(400).json({ error: 'No credentials set.' });
  }

  bot.log('Manual check triggered from dashboard.');
  const result = await bot.checkAndJoin(credentials.regNumber, credentials.password);
  res.json(result);
});

// Get timetable
app.get('/api/schedule', (req, res) => {
  res.json({ timetable: bot.timetable });
});

// Health check for Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ========== Cron Scheduler ==========

function startCronJob() {
  stopCronJob();

  if (!credentials.regNumber || !credentials.password) {
    bot.log('Cannot start cron — no credentials set.', 'warn');
    return;
  }

  // Run every 2 minutes, Monday-Saturday, 8 AM to 9 PM IST
  cronJob = cron.schedule('*/2 8-21 * * 1-6', async () => {
    bot.log('⏰ Scheduled check triggered.');
    await bot.checkAndJoin(credentials.regNumber, credentials.password);
  }, {
    timezone: 'Asia/Kolkata'
  });

  bot.log('Cron job started — checking every 2 min (Mon-Sat, 8AM-9PM IST).');
}

function stopCronJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    bot.log('Cron job stopped.');
  }
}

// ========== Self-Ping (Keep Alive on Render Free Tier) ==========

function startSelfPing() {
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

  if (RENDER_URL) {
    setInterval(async () => {
      try {
        await fetch(`${RENDER_URL}/health`);
      } catch {}
    }, 14 * 60 * 1000); // Every 14 minutes

    bot.log('Self-ping enabled to prevent Render spin-down.');
  } else {
    bot.log('Running locally — self-ping not needed.', 'info');
  }
}

// ========== Start Server ==========

app.listen(PORT, () => {
  console.log(`\n🚀 AutoClassJoiner Cloud Bot running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}\n`);

  bot.log(`Server started on port ${PORT}`);

  // Start cron if credentials are available
  if (credentials.regNumber && credentials.password) {
    startCronJob();
  } else {
    bot.log('No credentials in env vars. Set them via the dashboard or env: REG_NUMBER, PASSWORD');
  }

  // Start self-ping for Render
  startSelfPing();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  bot.log('Shutting down...');
  stopCronJob();
  await bot.closeBrowser();
  process.exit(0);
});

process.on('SIGINT', async () => {
  bot.log('Shutting down (SIGINT)...');
  stopCronJob();
  await bot.closeBrowser();
  process.exit(0);
});
