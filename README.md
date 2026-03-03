# Kingdomland Video Checker

A tool that automatically checks every video on the Kingdomland website and tells you which ones are working and which ones are broken — so you don't have to click through 125+ videos yourself.

It also compares the website videos with your Google Spreadsheet to make sure the statuses match.

---

## Table of Contents

1. [What You'll Need](#1-what-youll-need)
2. [Setting Up (First Time Only)](#2-setting-up-first-time-only)
3. [Starting the Tool](#3-starting-the-tool)
4. [Checking Videos](#4-checking-videos)
5. [Cross-checking with Spreadsheet](#5-cross-checking-with-spreadsheet)
6. [Enabling "Apply Changes" to Spreadsheet (Optional)](#6-enabling-apply-changes-to-spreadsheet-optional)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. What You'll Need

Before starting, make sure you have:

- **A computer** (Windows or Mac)
- **The Kingdomland login credentials** (email and password for go.kingdomlandkids.com)
- **Your Google Spreadsheet** with the video list

That's it! The steps below will walk you through installing everything else.

---

## 2. Setting Up (First Time Only)

You only need to do these steps once. After that, you just start the tool and use it.

### Step 1: Install Node.js

Node.js is what runs the tool. Think of it like an engine.

1. Go to **https://nodejs.org**
2. Click the big green **LTS** button to download
3. Run the installer — just click Next/Continue through everything

**To check it worked:**
- **Windows:** Press `Win + R`, type `cmd`, press Enter
- **Mac:** Press `Cmd + Space`, type `Terminal`, press Enter

Type this and press Enter:
```
node --version
```
If you see a number like `v20.11.0`, you're good!

### Step 2: Open the Project Folder in Terminal

- **Windows:** Open the project folder in File Explorer, click the address bar at the top, type `cmd`, press Enter
- **Mac:** Open Terminal, type `cd `, then drag the project folder into the Terminal window, press Enter

### Step 3: Install the Tool

Copy and paste these commands **one at a time** and press Enter after each:

```
npm install
```
Wait for it to finish, then:
```
npx playwright install chromium
```
This downloads a browser for the tool to use (takes 1-2 minutes).

### Step 4: Set Up Your Login and Spreadsheet

Open the file called `.env` in the project folder with any text editor (Notepad, VS Code, etc.).

It should look like this:
```
KL_USERNAME=your-email@example.com
KL_PASSWORD=your-password
GSHEET_SPREADSHEET_ID=your-spreadsheet-id
```

Replace the values with:
- **KL_USERNAME** — Your Kingdomland login email
- **KL_PASSWORD** — Your Kingdomland password
- **GSHEET_SPREADSHEET_ID** — The ID from your Google Spreadsheet URL

> **How to find the Spreadsheet ID:**
> Open your spreadsheet in Google Sheets. Look at the URL in your browser:
> ```
> https://docs.google.com/spreadsheets/d/1WnDBx_THIS_PART_IS_THE_ID_abcdef/edit
> ```
> The long string between `/d/` and `/edit` is your ID. Copy and paste it.

Save the file. You're done with setup!

---

## 3. Starting the Tool

Every time you want to use the tool:

1. Open Terminal/Command Prompt in the project folder (same as Step 2 above)
2. Type:
   ```
   npm start
   ```
3. You'll see:
   ```
   Kingdomland Video Checker Dashboard
   Running at: http://localhost:3000
   ```
4. Open your browser and go to **http://localhost:3000**

You'll see the Dashboard. This is your home page for everything.

> **To stop the tool later:** Go back to the terminal and press `Ctrl + C`

---

## 4. Checking Videos

This scans the Kingdomland website and tests every single video.

### How to do it:

1. On the Dashboard (**http://localhost:3000**), choose what to check:
   - **All** — Check both Story and Music pages (recommended)
   - **Story** — Only check Story page videos
   - **Music** — Only check Music page videos

2. Click **Run Check**

3. Watch the progress — you'll see each video being tested in real-time:
   - **PASS** (green) — Video loads correctly
   - **FAIL** (red) — Video didn't load
   - **TIMEOUT** (yellow) — Video took too long to load

4. When it's done, you'll see a summary at the top showing how many passed and failed

### What you can do with the results:

- **Filter** — Click PASS, FAIL, or TIMEOUT to see only those videos
- **Recheck failed ones** — Click "Recheck Failed" to test only the ones that failed
- **Download reports** — Click the export buttons to get:
  - **CSV** — Open in Excel or Google Sheets to share with the team
  - **JSON** — Detailed data file
  - **TXT** — Simple list of failed videos

---

## 5. Cross-checking with Spreadsheet

This compares the videos on the website with your Google Spreadsheet to find any mismatches.

### Before you start:

You need to run a video check first (Step 4 above). The cross-check uses those results.

### How to do it:

1. After running a video check, click **Spreadsheet Cross-check** in the top menu (or go to **http://localhost:3000/crosscheck**)

2. You'll see Step 1 showing your website check results. If it says "No results yet", go back to the Dashboard and run a video check first.

3. Click the **Run Cross-check** button

4. The tool fetches your Google Spreadsheet and compares every video title. Results appear in 4 tabs:

| Tab | What it shows |
|-----|---------------|
| **Changes Needed** | Videos where the spreadsheet status is wrong and needs updating |
| **Matched** | Videos found on both the website and spreadsheet (everything is in sync) |
| **Only on Website** | Videos on the website but missing from the spreadsheet |
| **Only in Spreadsheet** | Spreadsheet entries that aren't on the website |

### What do the "Changes Needed" mean?

| Situation | What happens |
|-----------|-------------|
| Spreadsheet says "In PRODUCTION" but video is **not on the website** | Status should be changed to "Ready to Live" |
| Video is **on the website** but spreadsheet says "Ready to Live" | Status should be changed to "In PRODUCTION" |

### Important note about "Apply Changes":

The **"Apply Changes to Spreadsheet"** button **only updates the Status column in your Google Spreadsheet**. It does **not** add, remove, or change any videos on the live Kingdomland website. It just keeps your spreadsheet tracking accurate.

> To use the "Apply Changes" button, you need to do the one-time setup in Step 6 below.

---

## 6. Enabling "Apply Changes" to Spreadsheet (Optional)

This is an optional one-time setup. It lets the tool automatically update the Status column in your spreadsheet when you click "Apply Changes" on the cross-check page.

**If you skip this step**, you can still see all the cross-check results — you'll just need to update the spreadsheet manually.

### Step 1: Open the Spreadsheet

Go to your Google Spreadsheet in the browser.

### Step 2: Open the Script Editor

In the spreadsheet's menu bar at the top, click **Extensions** → **Apps Script**.

This opens a new tab with a code editor.

### Step 3: Paste the Code

1. In the code editor, **select all the existing code** and **delete it**
2. Open the file `google-apps-script.js` from the project folder on your computer
3. **Copy everything** in that file
4. **Paste** it into the code editor in your browser
5. Click the **Save** button (floppy disk icon) or press `Ctrl + S`

### Step 4: Deploy

1. Click the blue **Deploy** button (top-right corner) → **New deployment**
2. Next to "Select type", click the **gear icon** → choose **Web app**
3. Fill in:
   - **"Execute as"** → select **Me**
   - **"Who has access"** → select **Anyone**
4. Click **Deploy**
5. If Google asks you to authorize:
   - Click **Review permissions**
   - Choose your Google account
   - Click **Advanced** → **Go to (project name)**
   - Click **Allow**

### Step 5: Copy the URL

After deploying, you'll see a URL that looks like:
```
https://script.google.com/macros/s/AKfycbx.../exec
```
Click the **copy icon** next to it.

### Step 6: Add the URL to Your Settings

Open the `.env` file in the project folder and add this new line at the bottom:
```
GSHEET_WEBAPP_URL=https://script.google.com/macros/s/AKfycbx.../exec
```
Replace the URL with the one you just copied. Save the file.

### Step 7: Restart

Go to the terminal where the tool is running, press `Ctrl + C` to stop it, then start it again:
```
npm start
```

Done! The "Apply Changes" button on the cross-check page will now work.

---

## 7. Troubleshooting

### "No results yet" on the Cross-check page
**Solution:** You need to run a video check from the Dashboard first, then go to the cross-check page.

### Login fails when running a video check
**Solution:** Make sure your email and password in the `.env` file are correct. Try running with debug mode to see what's happening:
```
node check-videos.js --debug
```

### Videos show as TIMEOUT but work when you check manually
**Solution:** The video might just be slow to load. You can increase the wait time — open `check-videos.js`, find `videoLoadTimeout: 20000` and change it to `30000` (30 seconds instead of 20).

### Cross-check shows a video as "unmatched" but it exists
**Solution:** The title in the spreadsheet might be slightly different from the website. Check for extra spaces, typos, or different formatting.

### The tool crashes or freezes
**Solution:** Press `Ctrl + C` in the terminal to stop it, then run `npm start` again. It starts fresh each time.

---

## For Developers

### Project Files

```
kingdomland-video-checker/
├── server.js              # Express server — serves dashboard + API endpoints
├── check-videos.js        # Playwright script — opens browser, tests videos
├── crosscheck.js          # Cross-check logic — compares website vs spreadsheet
├── google-apps-script.js  # Deploy in Google Sheets for auto-update
├── index.html             # Dashboard page
├── crosscheck.html        # Cross-check page
├── .env                   # Your login, spreadsheet ID, webapp URL
├── css/
│   ├── style.css          # Dashboard styles
│   ├── crosscheck.css     # Cross-check page styles
│   └── theme.css          # Dark/light mode
├── js/
│   ├── app.js             # Dashboard client-side logic
│   ├── crosscheck-page.js # Cross-check client-side logic
│   └── theme.js           # Theme toggle
└── package.json
```

### CLI Commands (without Dashboard)

```bash
node check-videos.js              # Headless mode (fast, no browser window)
node check-videos.js --debug      # Debug mode (see the browser)
node check-videos.js --story      # Only check Story page
node check-videos.js --music      # Only check Music page
```

### API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/` | Dashboard page |
| GET | `/crosscheck` | Cross-check page |
| POST | `/api/run` | Start a video check |
| GET | `/api/events` | SSE stream for real-time progress |
| GET | `/api/report` | Latest check results |
| GET | `/api/status` | Current run status |
| POST | `/api/crosscheck` | Run cross-check comparison |
| POST | `/api/crosscheck/apply` | Apply changes to spreadsheet |
| GET | `/api/download/:format` | Download report (csv/json/txt) |
| GET | `/api/health-badge` | SVG health badge |
