# 🎬 Kingdomland Video Checker — Step-by-Step Setup Guide

## What This Does

This tool automatically opens a browser, logs into go.kingdomlandkids.com, clicks on every single video (all 125), and checks if it loads. At the end, you get a report showing which ones pass and which ones fail — so you don't have to check them one by one.

---

## Prerequisites

You need **one thing** installed on your computer: **Node.js**

### Step 1: Install Node.js

1. Open your browser and go to: **https://nodejs.org**
2. Download the **LTS** version (the green button on the left)
3. Run the installer — just click Next/Continue through everything
4. To verify it worked, open your **Terminal** (Mac) or **Command Prompt** (Windows):
   - **Mac**: Press `Cmd + Space`, type "Terminal", press Enter
   - **Windows**: Press `Win + R`, type "cmd", press Enter
5. Type this and press Enter:
   ```
   node --version
   ```
   You should see something like `v20.11.0` — any version is fine.

> ✅ If you see a version number, you're good! Move on to Step 2.

---

## Step 2: Download and Unzip the Project

1. Download the `kingdomland-video-checker.zip` file from this chat
2. Unzip it to a folder on your computer (e.g., your Desktop)
3. You should now have a folder containing:
   - `check-videos.js` — the main script
   - `README.md` — this guide

---

## Step 3: Open Terminal in the Project Folder

### On Mac:
1. Open **Terminal** (Cmd + Space → type "Terminal")
2. Type `cd ` (with a space after cd), then **drag the folder** from Finder into the Terminal window
3. Press Enter

### On Windows:
1. Open the project folder in File Explorer
2. Click in the **address bar** at the top
3. Type `cmd` and press Enter — this opens Command Prompt right in that folder

> You should see something like:
> ```
> C:\Users\Jojo\Desktop\kingdomland-video-checker>
> ```
> or on Mac:
> ```
> Jojos-MacBook:kingdomland-video-checker jojo$
> ```

---

## Step 4: Install Dependencies

Copy and paste these commands **one at a time** into your terminal and press Enter after each:

**Command 1:**
```bash
npm init -y
```

Wait for it to finish, then:

**Command 2:**
```bash
npm install playwright
```

Wait for it to finish (might take 1-2 minutes), then:

**Command 3:**
```bash
npx playwright install chromium
```

This downloads a browser for the tool to use. Wait for it to finish.

> ✅ You should see "Downloading Chromium" and then it completes. You're ready!

---

## Step 5: Run the Video Checker

### First Run — Debug Mode (RECOMMENDED)

For your first time, run in **debug mode** so you can see the browser in action:

```bash
node check-videos.js --debug
```

This will:
1. Open a Chrome window
2. Navigate to the login page and log in
3. **STORY page**: Scroll to load all sections, then navigate each carousel (clicking the `>` arrow) to discover every video — even ones hidden off-screen
4. Click each video card, wait for it to load, and record the result
5. **MUSIC page**: Click through EPISODES and RECOMMENDED tabs, clicking "View more" to load all videos in the grid
6. Click each music video card, check if it loads
7. Print a summary and save report files

> 💡 Watch the browser as it runs. If something looks wrong (login fails, wrong page, etc.), press `Ctrl + C` in the terminal to stop it.

### Normal Run — Fast/Headless Mode

Once you've confirmed it works in debug mode:

```bash
node check-videos.js
```

This runs without showing the browser (much faster).

### Check Only One Page

```bash
node check-videos.js --story
```
or
```bash
node check-videos.js --music
```

---

## Step 6: Read the Report

When the script finishes, you'll see a summary in the terminal like this:

```
============================================================
VIDEO LOAD REPORT -- go.kingdomlandkids.com
============================================================
Date:       3/1/2026, 6:45:00 PM
Total:      125 videos checked
Loaded OK:  120
Failed:     3
Timed out:  2
------------------------------------------------------------

FAILED VIDEOS:
----------------------------------------
  1. [STORY] Bible Adventures > Faithfulness
     URL:   https://go.kingdomlandkids.com/watch/abc123
     Error: No <video> element found

  2. [MUSIC] Sing-a-long > Row Your Boat
     URL:   https://go.kingdomlandkids.com/watch/xyz789
     Error: MediaError: NETWORK
  ...
```

Plus **two report files** are saved in the same folder:

| File                  | What it is                                                  |
|-----------------------|-------------------------------------------------------------|
| **video-report.csv**  | Open in Excel or Google Sheets — easy to share with the team |
| **video-report.json** | Detailed technical data (for debugging if needed)            |

---

## Troubleshooting

### "Login failed" error
- Run with `--debug` and watch the browser
- Make sure the email and password in the script are correct
- The login form selectors might need adjusting — look at where the cursor types

### "0 videos found" on a page
- Run with `--debug` and watch — is the page loading correctly?
- **STORY page**: The script clicks `< >` carousel arrows to find all videos. If the arrow buttons changed, the selectors may need updating
- **MUSIC page**: The script clicks "View more" and checks both EPISODES and RECOMMENDED tabs. If the button text changed (e.g., "Load more"), update the `clickViewMore` function

### Script stops or crashes mid-way
- Just run it again — it starts fresh each time
- If it keeps failing on the same video, note which one and check it manually

### Videos time out but work when you check manually
- Increase the timeout: In `check-videos.js`, find `videoLoadTimeout: 20000` and change to `30000` (30 seconds)

---

## Quick Reference — All Commands

```bash
# ONE-TIME SETUP (only do this once):
npm init -y
npm install playwright
npx playwright install chromium

# RUN THE CHECKER:
node check-videos.js              # Fast mode (no browser window)
node check-videos.js --debug      # See the browser (recommended first time)
node check-videos.js --story      # Only check STORY page
node check-videos.js --music      # Only check MUSIC page
```

---

## Need Help?

If something doesn't work, take a screenshot of the error in the terminal and send it back here — I can help fix it!
