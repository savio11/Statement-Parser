# Running My Vault Locally

This project is a pnpm monorepo with two services:

- **API Server** — Express 5 + Node.js, handles PDF/CSV parsing, OCR, and live stock prices
- **My Vault** — Expo SDK 54 mobile app (runs in browser, iOS, or Android)

---

## Prerequisites

### 1. Node.js v24

Install via [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 24
nvm use 24
```

Or download directly from [nodejs.org](https://nodejs.org).

### 2. pnpm

The workspace enforces pnpm — npm and yarn will be rejected.

```bash
npm install -g pnpm
```

### 3. System tools for PDF parsing (OCR)

The API server calls two system binaries to parse image-based PDFs. Install them for your OS:

**macOS**
```bash
brew install poppler tesseract
```

**Ubuntu / Debian**
```bash
sudo apt install poppler-utils tesseract-ocr
```

**Windows**
- poppler: download from https://github.com/oschwartz10612/poppler-windows/releases
- tesseract: download the installer from https://github.com/UB-Mannheim/tesseract/wiki
- Add both to your system PATH after installing.

> If you skip this step the app still works — PDF/CSV parsing just falls back to text extraction only, without OCR for image-based statements.

### 4. Expo Go (for testing on a real phone — optional)

Install **Expo Go** from the App Store (iOS) or Play Store (Android).

---

## One-time Setup

### Step 1 — Fix platform overrides in pnpm-workspace.yaml

The workspace currently excludes all non-Linux native binaries (optimised for Replit's servers). Before installing, open `pnpm-workspace.yaml` and **delete the override lines for your platform** from the `overrides:` section.

**Mac (Apple Silicon — M1/M2/M3)**
Delete any line containing `darwin-arm64`.

**Mac (Intel)**
Delete any line containing `darwin-x64`.

**Windows**
Delete any line containing `win32`.

For example, on Apple Silicon you would remove lines like:
```yaml
"esbuild>@esbuild/darwin-arm64": "-"
"rollup>@rollup/rollup-darwin-arm64": "-"
"@expo/ngrok-bin>@expo/ngrok-bin-darwin-arm64": "-"
# ... and so on for darwin-arm64
```

### Step 2 — Install dependencies

```bash
pnpm install
```

### Step 3 — Update the Tesseract binary paths

Open `artifacts/api-server/src/routes/parse.ts` and update the two hardcoded Nix paths near the top of the file:

```ts
// Replace these two lines:
const TESSERACT_BIN = "/nix/store/.../bin/tesseract";
const TESSDATA_DIR  = "/nix/store/.../share/tessdata";

// With the paths on your machine, for example:

// macOS (after brew install tesseract):
const TESSERACT_BIN = "tesseract";       // it's on PATH
const TESSDATA_DIR  = "/usr/local/share/tessdata";  // Intel Mac
// or for Apple Silicon:
const TESSDATA_DIR  = "/opt/homebrew/share/tessdata";

// Linux (after apt install tesseract-ocr):
const TESSERACT_BIN = "tesseract";
const TESSDATA_DIR  = "/usr/share/tessdata";

// Windows (adjust to your install path):
const TESSERACT_BIN = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const TESSDATA_DIR  = "C:\\Program Files\\Tesseract-OCR\\tessdata";
```

To find your exact paths run:
```bash
which tesseract            # Mac / Linux
tesseract --list-langs     # confirm tessdata is found
```

### Step 4 — Update the Expo domain

Open `artifacts/my-vault/.env` and replace the Replit domain with localhost:

```
EXPO_PUBLIC_DOMAIN=localhost:8080
```

---

## Running the Services

You need two terminals running at the same time.

### Terminal 1 — API Server

```bash
PORT=8080 pnpm --filter @workspace/api-server run dev
```

The server will be available at `http://localhost:8080`.

Environment variables:

| Variable | Value | Required |
|---|---|---|
| `PORT` | e.g. `8080` | Yes — the server won't start without it |

### Terminal 2 — Expo App

Do **not** use the `dev` script from `package.json` — it contains Replit-specific environment variables. Call Expo directly instead:

```bash
cd artifacts/my-vault
npx expo start
```

Then choose how to open it:

| Key | Action |
|---|---|
| `w` | Open in your browser (recommended for quick testing) |
| `i` | Open in iOS Simulator (requires Xcode on Mac) |
| `a` | Open in Android Emulator (requires Android Studio) |
| Scan QR | Open in Expo Go on your phone (press `s` first to switch to Expo Go mode) |

---

## How data is stored

All app data — transactions, investments, manual assets, budgets, settings — is stored **locally on the device** using SQLite (native) or AsyncStorage (web/browser). There is no external database or cloud account to set up.

---

## Building a standalone app

### iOS (Mac only, requires Xcode)

```bash
cd artifacts/my-vault
npx expo run:ios
```

### Android (requires Android Studio)

```bash
cd artifacts/my-vault
npx expo run:android
```

### Web (static build)

```bash
cd artifacts/my-vault
npx expo export --platform web
```

---

## Troubleshooting

**`pnpm install` fails with a missing native binary**
You missed a platform override in `pnpm-workspace.yaml`. Search for your platform string (e.g. `darwin-arm64`) and delete those lines.

**`PORT environment variable is required` on startup**
Make sure you pass `PORT=8080` before the start command. On Windows use `set PORT=8080 &&` prefix or set it in a `.env` file.

**PDF parsing returns no transactions**
Check that `tesseract` is installed and the paths in `parse.ts` are correct. Run `tesseract --version` in your terminal to verify.

**Expo QR code does not connect from phone**
Your computer and phone must be on the same Wi-Fi network. If it still fails, run `npx expo start --tunnel` which routes through a public tunnel (requires `@expo/ngrok` to be installed).

**Stock prices not loading**
The API server fetches live prices from Yahoo Finance — make sure it is running (`Terminal 1`) and that `EXPO_PUBLIC_DOMAIN` in `.env` points to the correct address.
