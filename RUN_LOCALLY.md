# Running My Vault Locally

This project is a pnpm monorepo with two services:

- **API Server** — Express 5 + Node.js, handles PDF/CSV parsing, OCR, and live stock prices
- **My Vault** — Expo SDK 54 mobile app (runs in browser, iOS, or Android)

Jump to your OS: [macOS](#macos-setup) · [Windows](#windows-setup) · [Linux](#linux-setup)

---

## macOS Setup

### 1. Install Node.js v24

Using nvm (recommended):
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 24
nvm use 24
```

Or download the installer from [nodejs.org](https://nodejs.org).

### 2. Install pnpm

```bash
npm install -g pnpm
```

### 3. Install system tools for PDF parsing

```bash
brew install poppler tesseract
```

> If you don't have Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

### 4. Clone and install dependencies

```bash
git clone <your-repo-url>
cd <repo-folder>
```

Open `pnpm-workspace.yaml` and delete all override lines that contain your chip type:

- **Apple Silicon (M1/M2/M3/M4):** delete every line containing `darwin-arm64`
- **Intel Mac:** delete every line containing `darwin-x64`

For example, on Apple Silicon remove lines like:
```yaml
"esbuild>@esbuild/darwin-arm64": "-"
"rollup>@rollup/rollup-darwin-arm64": "-"
"@expo/ngrok-bin>@expo/ngrok-bin-darwin-arm64": "-"
```

Then install:
```bash
pnpm install
```

### 5. Update Tesseract paths in the API server

Open `artifacts/api-server/src/routes/parse.ts` and replace the two hardcoded Nix paths near the top:

```ts
// Remove these:
const TESSERACT_BIN = "/nix/store/.../bin/tesseract";
const TESSDATA_DIR  = "/nix/store/.../share/tessdata";

// Apple Silicon (M1/M2/M3/M4):
const TESSERACT_BIN = "tesseract";
const TESSDATA_DIR  = "/opt/homebrew/share/tessdata";

// Intel Mac:
const TESSERACT_BIN = "tesseract";
const TESSDATA_DIR  = "/usr/local/share/tessdata";
```

Confirm your tessdata path:
```bash
tesseract --list-langs
# The path shown above the list is your TESSDATA_DIR
```

### 6. Update the Expo domain

Open `artifacts/my-vault/.env` and change it to:
```
EXPO_PUBLIC_DOMAIN=localhost:8080
```

### 7. Run the two services

Open two separate terminal windows.

**Terminal 1 — API Server:**
```bash
PORT=8080 pnpm --filter @workspace/api-server run dev
```

**Terminal 2 — Expo App:**
```bash
cd artifacts/my-vault
npx expo start
```

Press `w` to open in browser, or scan the QR code with the Expo Go app on your phone.

---

## Windows Setup

### 1. Install Node.js v24

**Option A — Using nvm-windows (recommended):**

1. Download and run the installer from https://github.com/coreybutler/nvm-windows/releases (choose `nvm-setup.exe`)
2. Open a **new** Command Prompt or PowerShell as Administrator:
```powershell
nvm install 24
nvm use 24
node --version   # should print v24.x.x
```

**Option B — Direct installer:**

Download the Windows installer from [nodejs.org](https://nodejs.org) and run it. Make sure "Add to PATH" is checked.

### 2. Install pnpm

In Command Prompt or PowerShell:
```powershell
npm install -g pnpm
```

Verify:
```powershell
pnpm --version
```

### 3. Install system tools for PDF parsing

Both tools need to be installed and added to your system PATH.

#### Poppler (for converting PDFs to images)

1. Download the latest release from https://github.com/oschwartz10612/poppler-windows/releases
   - Download the `.zip` file (e.g. `Release-24.xx.0-0.zip`)
2. Extract it to a permanent location, e.g. `C:\tools\poppler`
3. Add the `bin` folder to your PATH:
   - Open **Start** → search "Environment Variables" → click "Edit the system environment variables"
   - Click **Environment Variables**
   - Under "System variables", find `Path` and click **Edit**
   - Click **New** and add: `C:\tools\poppler\Library\bin`
   - Click OK on all dialogs
4. Open a **new** terminal and verify:
```powershell
pdftoppm -v
```

#### Tesseract (for OCR text recognition)

1. Download the installer from https://github.com/UB-Mannheim/tesseract/wiki
   - Download `tesseract-ocr-w64-setup-x.x.exe` (64-bit)
2. Run the installer. When asked about additional language data, select **English** (already included by default)
3. Note the install path — default is `C:\Program Files\Tesseract-OCR`
4. The installer offers to add Tesseract to PATH — **tick that box**
5. Open a **new** terminal and verify:
```powershell
tesseract --version
```

> If you skip this step the app still works — PDF/CSV parsing falls back to text extraction only, without OCR for image-based statements.

### 4. Clone and install dependencies

```powershell
git clone <your-repo-url>
cd <repo-folder>
```

Open `pnpm-workspace.yaml` in a text editor (VS Code, Notepad++, etc.) and **delete all override lines containing `win32`**. Look for lines like:

```yaml
"esbuild>@esbuild/win32-x64": "-"
"esbuild>@esbuild/win32-arm64": "-"
"esbuild>@esbuild/win32-ia32": "-"
"rollup>@rollup/rollup-win32-x64-gnu": "-"
"rollup>@rollup/rollup-win32-x64-msvc": "-"
"rollup>@rollup/rollup-win32-arm64-msvc": "-"
"rollup>@rollup/rollup-win32-ia32-msvc": "-"
"@expo/ngrok-bin>@expo/ngrok-bin-win32-ia32": "-"
"@expo/ngrok-bin>@expo/ngrok-bin-win32-x64": "-"
```

Delete **all** of these `win32` lines, then install:

```powershell
pnpm install
```

### 5. Update Tesseract paths in the API server

Open `artifacts/api-server/src/routes/parse.ts` in your editor. Near the top, replace the two hardcoded Nix paths:

```ts
// Remove these:
const TESSERACT_BIN = "/nix/store/.../bin/tesseract";
const TESSDATA_DIR  = "/nix/store/.../share/tessdata";

// Add these (adjust if you installed to a different location):
const TESSERACT_BIN = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const TESSDATA_DIR  = "C:\\Program Files\\Tesseract-OCR\\tessdata";
```

To confirm the correct paths on your machine:
```powershell
where tesseract
# Example output: C:\Program Files\Tesseract-OCR\tesseract.exe
# Your TESSDATA_DIR is that folder + \tessdata
```

### 6. Update the Expo domain

Open `artifacts/my-vault/.env` in a text editor and change it to:
```
EXPO_PUBLIC_DOMAIN=localhost:8080
```

### 7. Run the two services

You need two terminal windows open at the same time.

**Terminal 1 — API Server:**

Command Prompt:
```cmd
set PORT=8080 && pnpm --filter @workspace/api-server run dev
```

PowerShell:
```powershell
$env:PORT="8080"; pnpm --filter @workspace/api-server run dev
```

The server will be available at `http://localhost:8080`. You should see a log line like `Server listening on port 8080`.

**Terminal 2 — Expo App:**

Do **not** use the `dev` script from `package.json` — it contains Replit-specific variables. Call Expo directly:

Command Prompt or PowerShell:
```powershell
cd artifacts\my-vault
npx expo start
```

Press `w` to open in your browser. To test on your phone, press `s` to switch to Expo Go mode and scan the QR code (your phone must be on the same Wi-Fi network).

---

## Linux Setup

### 1. Install Node.js v24

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc   # or ~/.zshrc
nvm install 24
nvm use 24
```

### 2. Install pnpm

```bash
npm install -g pnpm
```

### 3. Install system tools for PDF parsing

Ubuntu / Debian:
```bash
sudo apt update
sudo apt install poppler-utils tesseract-ocr
```

Fedora / RHEL:
```bash
sudo dnf install poppler-utils tesseract
```

### 4. Clone and install dependencies

```bash
git clone <your-repo-url>
cd <repo-folder>
```

Open `pnpm-workspace.yaml` and delete any override lines that block your CPU architecture (e.g. `linux-arm64` if you're on ARM). Most desktop Linux users on x86-64 can skip this step.

```bash
pnpm install
```

### 5. Update Tesseract paths

Open `artifacts/api-server/src/routes/parse.ts` and replace the two hardcoded Nix paths:

```ts
// Remove these:
const TESSERACT_BIN = "/nix/store/.../bin/tesseract";
const TESSDATA_DIR  = "/nix/store/.../share/tessdata";

// Add these:
const TESSERACT_BIN = "tesseract";
const TESSDATA_DIR  = "/usr/share/tessdata";
```

Confirm with:
```bash
tesseract --list-langs   # the header line shows your TESSDATA_DIR
```

### 6. Update the Expo domain

Open `artifacts/my-vault/.env` and change it to:
```
EXPO_PUBLIC_DOMAIN=localhost:8080
```

### 7. Run the two services

**Terminal 1 — API Server:**
```bash
PORT=8080 pnpm --filter @workspace/api-server run dev
```

**Terminal 2 — Expo App:**
```bash
cd artifacts/my-vault
npx expo start
```

Press `w` to open in your browser.

---

## How data is stored

All app data — transactions, investments, manual assets, budgets, and settings — is stored **locally on your device** using SQLite (native mobile) or AsyncStorage (browser). There is no external database or cloud account to set up.

---

## Building a standalone app

### iOS (Mac only, requires Xcode)
```bash
cd artifacts/my-vault
npx expo run:ios
```

### Android (requires Android Studio — works on Mac, Windows, Linux)
```bash
cd artifacts/my-vault
npx expo run:android
```

### Web (static export)
```bash
cd artifacts/my-vault
npx expo export --platform web
```

---

## Troubleshooting

**`pnpm install` fails with a missing native binary**
You have an override in `pnpm-workspace.yaml` blocking your platform. Open the file, search for your platform keyword (`darwin-arm64`, `darwin-x64`, `win32`, `linux-arm64`) and delete those lines, then re-run `pnpm install`.

**`PORT environment variable is required` on startup**

- Mac / Linux: prefix the command with `PORT=8080`
- Windows CMD: `set PORT=8080 && pnpm ...`
- Windows PowerShell: `$env:PORT="8080"; pnpm ...`

**PDF parsing returns no transactions or OCR fails**
1. Verify Tesseract is installed: `tesseract --version`
2. Verify pdftoppm is installed: `pdftoppm -v`
3. Double-check the `TESSERACT_BIN` and `TESSDATA_DIR` values in `parse.ts` match your actual install

**Windows: `pdftoppm` or `tesseract` is not recognised as a command**
The tool's `bin` folder is not on your PATH. Re-read Steps 3 in the Windows section above, add the folder to System PATH, then close and reopen your terminal.

**Expo QR code does not connect from phone**
Your computer and phone must be on the same Wi-Fi network. If it still fails, start Expo with a tunnel:
```bash
npx expo start --tunnel
```
This routes through a public URL so no local network is required (needs `@expo/ngrok` installed).

**Stock prices not loading**
The API server fetches live prices from Yahoo Finance. Make sure Terminal 1 is still running and `EXPO_PUBLIC_DOMAIN` in `artifacts/my-vault/.env` points to the correct address (`localhost:8080`).

**Windows: `EPERM` or permission errors during `pnpm install`**
Run your terminal as Administrator, or check that your antivirus is not blocking Node.js file operations in the project folder.
