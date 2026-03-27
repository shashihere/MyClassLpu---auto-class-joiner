# AutoClassJoiner — LPU MyClass Auto Attendance

Automatically login and join classes on **myclass.lpu.in** (CodeTantra). Two solutions included:

## 🧩 Chrome Extension
Runs in your browser — enter credentials, toggle auto-join, and it handles the rest.

### Install
1. Go to `chrome://extensions` → enable **Developer Mode**
2. Click **Load unpacked** → select the root `AutoClassJoiner/` folder
3. Click the extension icon → enter your Registration Number & Password → Save

## ☁️ Cloud Bot (Render)
Runs 24/7 in the cloud — works even when your laptop is off.

### Deploy to Render
1. Fork/clone this repo
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your repo, set root directory to `cloud-bot/`
4. Set runtime to **Docker**
5. Add environment variables:
   - `REG_NUMBER` = your registration number
   - `PASSWORD` = your UMS password
6. Deploy 🚀

### Local Testing
```bash
cd cloud-bot
npm install
REG_NUMBER=12345678 PASSWORD=yourpass node server.js
# Dashboard → http://localhost:3000
```

## Features
- 🔐 Auto-login to myclass.lpu.in
- 📅 Timetable scraping from CodeTantra dashboard
- ✅ Auto-join when a class starts (green status detected)
- ⏰ Cron scheduler (every 2 min, Mon–Sat, 8AM–9PM IST)
- 📊 Web dashboard with real-time status & logs
- 🔔 Chrome notifications when a class is joined

## Tech Stack
- **Chrome Extension**: Manifest V3, Content Scripts, Service Worker
- **Cloud Bot**: Node.js, Puppeteer, Express, node-cron, Docker

---

> ⚠️ Credentials are stored locally (Chrome extension) or as environment variables (Render). They never leave your device/server.
