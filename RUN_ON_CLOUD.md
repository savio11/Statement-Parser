# Deploying My Vault — Cloud Server & App Store Guide

This guide covers two things:

1. **Hosting the API server** on a Hostinger VPS so PDF parsing, OCR, and stock prices work for real users
2. **Publishing the mobile app** to the Apple App Store and Google Play Store

Follow every step in order. Nothing is skipped.

---

## Part 1 — Hosting the API Server on Hostinger VPS

### Why you need a VPS

The My Vault mobile app needs a backend server running at all times to:
- Parse PDF and CSV bank statements
- Run OCR on image-based PDFs (using Tesseract)
- Fetch live stock prices from Yahoo Finance

A VPS (Virtual Private Server) is a Linux computer in the cloud that runs 24/7.

---

### Step 1 — Buy a Hostinger VPS

1. Go to https://www.hostinger.com/vps-hosting
2. Choose the **KVM 2** plan or higher (minimum 2 GB RAM — the OCR tool needs it)
3. During checkout, select:
   - **Operating System:** Ubuntu 22.04 LTS
   - **Region:** closest to your users (e.g. UK, EU, US)
4. Complete payment. You'll receive an email with your VPS IP address and root password.

> Save the IP address and root password — you'll use them throughout this guide.

---

### Step 2 — Connect to your VPS via SSH

**On Mac / Linux**, open Terminal:
```bash
ssh root@YOUR_VPS_IP
```
Replace `YOUR_VPS_IP` with the IP address from your Hostinger email. Type `yes` when asked about the fingerprint. Enter your root password.

**On Windows**, use [PuTTY](https://www.putty.org/):
1. Download and open PuTTY
2. In "Host Name", enter your VPS IP address
3. Click **Open**
4. Log in as `root` and enter your password

You are now inside your VPS. Every command from here runs on the server unless stated otherwise.

---

### Step 3 — Set up a non-root user (security best practice)

```bash
adduser deployer
usermod -aG sudo deployer
su - deployer
```

When prompted, set a password and press Enter through the rest of the prompts.

---

### Step 4 — Install Node.js 24

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24
node --version
```

You should see `v24.x.x` printed. If not, close and reopen your SSH connection and try `nvm use 24` again.

---

### Step 5 — Install pnpm

```bash
npm install -g pnpm
pnpm --version
```

---

### Step 6 — Install system tools for PDF parsing

```bash
sudo apt update
sudo apt install -y poppler-utils tesseract-ocr
```

Verify both installed correctly:
```bash
pdftoppm -v
tesseract --version
```

Both commands should print version information without errors.

---

### Step 7 — Install Git and upload your code

```bash
sudo apt install -y git
```

Now upload your project. You have two options:

**Option A — From GitHub (recommended)**

If your project is on GitHub (even a private repo):
```bash
cd ~
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git my-vault-app
cd my-vault-app
```

**Option B — Upload directly with SFTP**

On your local machine, use [FileZilla](https://filezilla-project.org/):
1. Open FileZilla
2. Host: `sftp://YOUR_VPS_IP`, Username: `deployer`, Password: your deployer password, Port: `22`
3. Click **Quickconnect**
4. On the right side (server), navigate to `/home/deployer/`
5. On the left side (your computer), find your project folder
6. Drag the entire project folder to the right side
7. Back in your SSH terminal: `cd ~/my-vault-app` (or whatever folder name)

---

### Step 8 — Install project dependencies

The `pnpm-workspace.yaml` already has the correct settings for Linux x64 (Hostinger's VPS architecture), so no changes are needed there.

```bash
pnpm install
```

---

### Step 9 — Update the Tesseract paths

The API server has Replit-specific paths hardcoded. Update them for Ubuntu:

```bash
nano artifacts/api-server/src/routes/parse.ts
```

Find these two lines near the top of the file (around line 13–14):
```
const TESSERACT_BIN = "/nix/store/.../bin/tesseract";
const TESSDATA_DIR  = "/nix/store/.../share/tessdata";
```

Replace them with:
```
const TESSERACT_BIN = "tesseract";
const TESSDATA_DIR  = "/usr/share/tessdata";
```

Save and exit: press `Ctrl + X`, then `Y`, then `Enter`.

Verify the tessdata path is correct:
```bash
tesseract --list-langs
# The first line shows the TESSDATA_DIR path — it should match /usr/share/tessdata
```

---

### Step 10 — Set environment variables

Create an environment file for the API server:

```bash
nano ~/my-vault-app/artifacts/api-server/.env.production
```

Paste the following and fill in the values:
```
PORT=8080
SESSION_SECRET=REPLACE_WITH_A_LONG_RANDOM_STRING_AT_LEAST_32_CHARS
NODE_ENV=production
```

To generate a secure random string for `SESSION_SECRET`:
```bash
openssl rand -hex 32
```

Copy the output and paste it as the value of `SESSION_SECRET`. Save with `Ctrl + X`, `Y`, `Enter`.

---

### Step 11 — Build the API server

```bash
cd ~/my-vault-app
pnpm --filter @workspace/api-server run build
```

You should see esbuild output ending with no errors.

---

### Step 12 — Install PM2 (keeps the server running forever)

PM2 is a process manager that restarts your server if it crashes and starts it automatically on reboot.

```bash
npm install -g pm2
```

Start the API server with PM2:
```bash
cd ~/my-vault-app/artifacts/api-server
PORT=8080 SESSION_SECRET=$(grep SESSION_SECRET ~/.env.production | cut -d= -f2) pm2 start dist/index.mjs --name "my-vault-api"
```

Simpler approach — create a PM2 config file:
```bash
nano ~/my-vault-app/pm2.config.js
```

Paste:
```javascript
module.exports = {
  apps: [{
    name: "my-vault-api",
    script: "./artifacts/api-server/dist/index.mjs",
    cwd: "/home/deployer/my-vault-app",
    env: {
      PORT: 8080,
      NODE_ENV: "production",
      SESSION_SECRET: "PASTE_YOUR_SECRET_HERE"
    },
    restart_delay: 3000,
    max_restarts: 10
  }]
};
```

Replace `PASTE_YOUR_SECRET_HERE` with the value you generated in Step 10.

Save and exit (`Ctrl + X`, `Y`, `Enter`), then start it:
```bash
cd ~/my-vault-app
pm2 start pm2.config.js
pm2 save
pm2 startup
```

The `pm2 startup` command will print one more command for you to copy and run — run it. This makes PM2 start automatically if the VPS reboots.

Check it's running:
```bash
pm2 status
pm2 logs my-vault-api
```

You should see `Server listening` in the logs.

---

### Step 13 — Install Nginx (reverse proxy + SSL)

Nginx sits in front of your Node.js server and handles incoming web traffic. It also lets you use a proper domain name and HTTPS.

```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

### Step 14 — Point a domain at your VPS

You need a domain name (e.g. `api.myvaultapp.com`). If you don't have one, you can buy one from Hostinger for a few pounds/dollars per year.

**In your domain's DNS settings (Hostinger hPanel → DNS Zone Editor):**

Add an **A record**:
- Name: `api` (or whatever subdomain you want)
- Points to: `YOUR_VPS_IP`
- TTL: 3600

Wait 5–30 minutes for DNS to propagate. Test it:
```bash
ping api.yourdomain.com
# Should respond from your VPS IP
```

---

### Step 15 — Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/my-vault-api
```

Paste the following (replace `api.yourdomain.com` with your actual domain):
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location /api {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 25M;
    }
}
```

Save and exit (`Ctrl + X`, `Y`, `Enter`).

Enable the config and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/my-vault-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` should print `syntax is ok` and `test is successful`.

---

### Step 16 — Enable HTTPS with a free SSL certificate

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

Follow the prompts:
- Enter your email address
- Type `Y` to agree to terms
- Type `N` or `Y` for the newsletter (your choice)
- When asked to redirect HTTP to HTTPS, type `2` and press Enter

Test the renewal works:
```bash
sudo certbot renew --dry-run
```

Your API server is now live at `https://api.yourdomain.com` with a valid SSL certificate that auto-renews.

Test it in your browser: `https://api.yourdomain.com/api/healthz` — it should respond (404 is fine, means the server is reachable).

---

### Step 17 — Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Type `y` when asked to enable.

---

### Step 18 — Update the Expo app to use your new server

On your **local machine**, open `artifacts/my-vault/.env` and update it:
```
EXPO_PUBLIC_DOMAIN=api.yourdomain.com
```

Also update `artifacts/my-vault/app.json` — change the expo-router origin from `https://replit.com/` to your own domain:
```json
"plugins": [
  [
    "expo-router",
    {
      "origin": "https://api.yourdomain.com/"
    }
  ],
  "expo-font",
  "expo-web-browser"
]
```

Your API server is now fully set up and running in the cloud. All users of your app will use this server for PDF parsing and stock prices.

---

### Updating the server after code changes

When you change the code and want to deploy updates:

```bash
# On your VPS (SSH in first)
cd ~/my-vault-app
git pull                                          # pull latest changes
pnpm install                                      # install any new dependencies
pnpm --filter @workspace/api-server run build     # rebuild
pm2 restart my-vault-api                         # restart the server
pm2 logs my-vault-api                            # check it started correctly
```

---

---

## Part 2 — Preparing the App for Publishing

These steps are done on your **local machine**, not the VPS.

### Step 1 — Create an Expo account

Go to https://expo.dev and sign up for a free account. Verify your email.

### Step 2 — Install the EAS CLI

EAS (Expo Application Services) is the official tool for building and submitting apps.

```bash
npm install -g eas-cli
eas login
```

Log in with your Expo account credentials.

### Step 3 — Update app.json with your app's identity

Open `artifacts/my-vault/app.json` and add the bundle identifier and package name. These are permanent unique IDs — choose them carefully:

```json
{
  "expo": {
    "name": "My Vault",
    "slug": "my-vault",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "my-vault",
    "userInterfaceStyle": "dark",
    "newArchEnabled": true,
    "splash": {
      "image": "./assets/images/icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#080B14"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.yourname.myvault"
    },
    "android": {
      "package": "com.yourname.myvault",
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/icon.png",
        "backgroundColor": "#080B14"
      }
    },
    "web": {
      "favicon": "./assets/images/icon.png"
    },
    "plugins": [
      [
        "expo-router",
        {
          "origin": "https://api.yourdomain.com/"
        }
      ],
      "expo-font",
      "expo-web-browser"
    ],
    "experiments": {
      "typedRoutes": true,
      "reactCompiler": true
    }
  }
}
```

Replace `com.yourname.myvault` with a real reverse-domain identifier — for example if your name is John and your domain is johnapps.com, use `com.johnapps.myvault`. This cannot be changed after submission.

### Step 4 — Create eas.json

In the `artifacts/my-vault/` folder, create a new file called `eas.json`:

```json
{
  "cli": {
    "version": ">= 10.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}
```

### Step 5 — Link your project to Expo

```bash
cd artifacts/my-vault
eas init
```

When asked "Would you like to create a project for this directory?" type `y`. This links your local project to your Expo account.

---

---

## Part 3 — Publishing to Google Play Store (Android)

Do Android first — it has a simpler review process and faster turnaround.

### Step 1 — Create a Google Play Developer account

1. Go to https://play.google.com/console
2. Sign in with your Google account
3. Click **Get started**
4. Pay the one-time $25 registration fee
5. Fill in your developer profile (name, email, address)
6. Accept the developer agreement
7. Account approval takes up to 48 hours

### Step 2 — Build the Android app

On your local machine, from the repo root:

```bash
cd artifacts/my-vault
eas build --platform android --profile production
```

- When asked "Generate a new Android Keystore?" type `y` — EAS stores this securely for you
- The build runs in the cloud (Expo's servers) — no Android Studio needed
- Wait 10–20 minutes. When done, EAS will print a download URL for the `.aab` file

Download the `.aab` file from the URL printed, or from https://expo.dev/accounts/YOUR_USERNAME/projects/my-vault/builds

### Step 3 — Create your app in Google Play Console

1. Go to https://play.google.com/console
2. Click **Create app**
3. Fill in:
   - App name: `My Vault`
   - Default language: English (or your language)
   - App or game: **App**
   - Free or paid: **Free** (or Paid if charging upfront)
4. Tick both declaration checkboxes
5. Click **Create app**

### Step 4 — Fill in the store listing

In the left menu, go to **Grow → Store presence → Main store listing**:

- **App name:** My Vault
- **Short description:** Personal finance tracker with bank statement import (max 80 chars)
- **Full description:** Write a paragraph describing the app (500–4000 chars)
- **App icon:** Upload a 512×512 PNG (use `artifacts/my-vault/assets/images/icon.png` — resize it to 512×512 using any image editor)
- **Feature graphic:** A 1024×500 PNG banner image (create one in Canva or similar)
- **Screenshots:** Take at least 2 screenshots on a phone or from the Expo web preview. Go to **Phone screenshots** and upload them (minimum 2, maximum 8)

Click **Save**.

### Step 5 — Complete the required declarations

Work through the left menu completing every section with a red dot:

**Policy → App content:**
- **Privacy Policy:** You must provide a URL to a privacy policy. Create a simple one at https://www.privacypolicygenerator.info/ and host it anywhere (even a Google Doc with public link)
- **Ads:** Select "No ads"
- **App access:** Select "All functionality is available without special access"
- **Content rating:** Click "Start questionnaire", answer honestly (Finance app, no violence, no adult content). You'll get a rating like "Everyone"
- **Target audience:** Select age group (18+ if it handles financial data)
- **Data safety:** Fill in what data the app collects. My Vault stores data locally only — select "No" for sharing with third parties. For data collected, select "Financial info" stored on device, "Not shared"

### Step 6 — Set up pricing and distribution

In the left menu: **Monetize → Pricing and distribution** (or **Monetize → Pricing**):
- Free app: confirm it's free
- Countries: select all countries or specific ones
- Click **Save**

### Step 7 — Upload the AAB and create a release

In the left menu: **Release → Production**:

1. Click **Create new release**
2. Under "App bundles", click **Upload** and upload the `.aab` file you downloaded in Step 2
3. In "Release notes", describe what's in this version:
   ```
   Initial release of My Vault — personal finance tracker with bank statement import, investment portfolio tracking, and spending analysis.
   ```
4. Click **Save**, then **Review release**
5. Fix any errors shown (warnings can be ignored)
6. Click **Start rollout to production**

Google will review your app. First submissions typically take **3–7 days**. You'll get an email when it's approved or if changes are needed.

---

---

## Part 4 — Publishing to the Apple App Store (iOS)

### Step 1 — Create an Apple Developer account

1. Go to https://developer.apple.com/programs/
2. Click **Enroll**
3. Sign in with your Apple ID (create one if needed)
4. Choose **Individual** (unless publishing under a company)
5. Pay the **$99 USD/year** fee
6. Approval takes up to 48 hours (usually same day)

### Step 2 — Create your app in App Store Connect

1. Go to https://appstoreconnect.apple.com
2. Sign in with your Apple ID
3. Click **My Apps**
4. Click the **+** button → **New App**
5. Fill in:
   - **Platforms:** iOS
   - **Name:** My Vault
   - **Primary language:** English
   - **Bundle ID:** Click "Register a new Bundle ID" — this opens a new tab:
     - Go to https://developer.apple.com/account/resources/identifiers/add/bundleId
     - Select **App IDs**, click Continue
     - Select **App**, click Continue
     - Description: `My Vault`
     - Bundle ID: select **Explicit** and enter `com.yourname.myvault` (same as in app.json)
     - Scroll down, click **Continue**, then **Register**
     - Go back to App Store Connect, refresh the Bundle ID dropdown and select your new ID
   - **SKU:** `myvault001` (any unique internal ID you choose)
   - **User access:** Full access
6. Click **Create**

### Step 3 — Fill in the App Store listing

In your app's page, click **1.0 Prepare for Submission** (or the version number):

**App information (left sidebar):**
- **Category:** Finance
- **Privacy Policy URL:** same URL you created for Android
- **Age Rating:** Click Edit, answer the questionnaire (no violence, no adult content → will get 4+)

**App Store Listing tab:**
- **Description:** Write what the app does (up to 4000 characters)
- **Keywords:** `finance, budget, bank statement, portfolio, investments, spending` (max 100 chars, comma-separated)
- **Support URL:** Your website or GitHub repo URL
- **Screenshots:**
  - You need screenshots for iPhone 6.9" display (iPhone 16 Pro Max size: 1320×2868 pixels)
  - Take screenshots from the Expo web preview and resize them, or use [Shots.so](https://shots.so) to create nice mockups
  - Upload at least 3 screenshots
- **App Preview (optional):** A short video — skip this for now
- **Promotional Text (optional):** One line shown at the top, can change without resubmission

### Step 4 — Build the iOS app

On your local machine:

```bash
cd artifacts/my-vault
eas build --platform ios --profile production
```

- When asked about credentials, select **Manage everything with EAS** — it handles certificates automatically using your Apple account
- You'll be asked for your Apple ID and password (or app-specific password)
- EAS may ask you to log into your Apple account in the browser to approve — follow the on-screen instructions
- The build runs in the cloud and takes 15–30 minutes
- When done, a `.ipa` file link is printed

### Step 5 — Submit the build to App Store Connect

```bash
eas submit --platform ios --profile production
```

EAS will ask which build to submit — select the most recent one. It will upload directly to App Store Connect.

Alternatively: Go to https://expo.dev → your project → Builds → find the iOS build → click **Submit to App Store**.

### Step 6 — Complete the submission in App Store Connect

Go back to https://appstoreconnect.apple.com → My Apps → My Vault:

1. Under **Build**, click the **+** button and select the build you just uploaded (it may take 5–10 minutes to appear after the EAS submit step)
2. Fill in:
   - **Sign-In Information:** My Vault has no login — tick "Sign-in required: No" (or "App does not require sign-in")
   - **Review Notes:** Briefly describe what the app does and how to test it:
     ```
     My Vault is a personal finance tracker. All data is stored locally on device.
     To test: tap the Portfolio tab, tap +, search for any stock ticker (e.g. AAPL).
     The API server at https://api.yourdomain.com handles stock price lookups.
     No account or login is needed.
     ```
3. **Version Release:** Select **Automatically release this version** unless you want to control timing
4. Click **Add for Review** → **Submit to App Review**

Apple's review typically takes **1–3 days** for new apps. You'll get an email when approved or if they request changes.

---

---

## Quick Reference — Commands Summary

### API Server (run on your VPS via SSH)

| Task | Command |
|---|---|
| Check server status | `pm2 status` |
| View live logs | `pm2 logs my-vault-api` |
| Restart server | `pm2 restart my-vault-api` |
| Deploy code update | `git pull && pnpm install && pnpm --filter @workspace/api-server run build && pm2 restart my-vault-api` |
| Check Nginx config | `sudo nginx -t` |
| Reload Nginx | `sudo systemctl reload nginx` |

### App Builds (run on your local machine)

| Task | Command |
|---|---|
| Build for Android | `cd artifacts/my-vault && eas build --platform android --profile production` |
| Build for iOS | `cd artifacts/my-vault && eas build --platform ios --profile production` |
| Build both at once | `cd artifacts/my-vault && eas build --platform all --profile production` |
| Submit to Google Play | `cd artifacts/my-vault && eas submit --platform android --profile production` |
| Submit to App Store | `cd artifacts/my-vault && eas submit --platform ios --profile production` |
| View all builds | `cd artifacts/my-vault && eas build:list` |

---

## Costs Summary

| Service | Cost |
|---|---|
| Hostinger KVM 2 VPS | ~$6–10 / month |
| Domain name (optional but recommended) | ~$10–15 / year |
| SSL certificate | Free (via Let's Encrypt / Certbot) |
| Expo EAS builds | Free tier: 30 builds/month. Paid: $99/year |
| Google Play Developer account | $25 one-time |
| Apple Developer Program | $99 / year |

---

## Troubleshooting

**PM2 shows the server is errored**
```bash
pm2 logs my-vault-api --lines 50
```
Read the error. The most common causes are: wrong Tesseract path, PORT conflict, or a missing build step.

**`nginx -t` fails**
Re-check your `/etc/nginx/sites-available/my-vault-api` file. Make sure there are no typos and the domain name is correct.

**EAS build fails with "bundle identifier already in use"**
Someone else has registered that bundle ID on Apple. Change `bundleIdentifier` in `app.json` to something more unique (add your initials).

**Apple rejects the app — "Guideline 5.1.1 Privacy — Data Collection"**
Your privacy policy URL is missing or not accessible. Make sure the URL in App Store Connect is publicly reachable.

**Google Play rejects — "Your app has not been tested"**
You must complete at least 20 days of internal/closed testing with at least 12 testers before a new personal developer account can publish to production. Set up a Closed Testing track first, add 12 Gmail accounts as testers (can be your own or friends/family), and wait 20 days.

**Stock prices not loading for users**
SSH into your VPS and run `pm2 logs my-vault-api`. Check if the API server is running. If it stopped, run `pm2 restart my-vault-api`.
