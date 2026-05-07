# My Vault — Developer Reference

A complete guide to understanding, navigating, and modifying this codebase. After reading this document you should be able to find any piece of functionality and make changes confidently.

---

## Table of Contents

1. [What the app does](#1-what-the-app-does)
2. [Project structure](#2-project-structure)
3. [The two services](#3-the-two-services)
4. [Mobile app — screens and features](#4-mobile-app--screens-and-features)
5. [Data storage — how everything is saved](#5-data-storage--how-everything-is-saved)
6. [Shared libraries](#6-shared-libraries)
7. [API server — routes explained](#7-api-server--routes-explained)
8. [PDF and CSV parsing — deep dive](#8-pdf-and-csv-parsing--deep-dive)
9. [Multi-currency system](#9-multi-currency-system)
10. [Subscription detection](#10-subscription-detection)
11. [UI system — design language](#11-ui-system--design-language)
12. [Authentication (biometric lock)](#12-authentication-biometric-lock)
13. [Notifications](#13-notifications)
14. [Common tasks — how to make changes](#14-common-tasks--how-to-make-changes)
15. [Known sharp edges](#15-known-sharp-edges)

---

## 1. What the app does

My Vault is a **local-first personal finance app** for iOS and Android. "Local-first" means all data is stored on the user's own device — there is no user account, no cloud database, and no login.

Core features:
- Import bank statements (PDF or CSV) and automatically parse transactions
- Categorise spending and visualise it as a donut chart
- Monthly cashflow chart (money in vs money out)
- Set monthly budgets per category with progress tracking
- Automatically detect recurring subscriptions
- Track a stock portfolio with live prices from Yahoo Finance
- Track manual assets (property, gold, fixed deposits, crypto, etc.)
- Convert everything into any display currency using live FX rates
- Project future net worth by asset class in the Growth Lab
- Biometric lock (Face ID / fingerprint) to protect the app

---

## 2. Project structure

```
/                                    ← monorepo root
├── artifacts/
│   ├── my-vault/                    ← Expo mobile app
│   │   ├── app/
│   │   │   ├── (tabs)/              ← the four main screens
│   │   │   │   ├── _layout.tsx      ← tab bar + biometric lock
│   │   │   │   ├── index.tsx        ← Dashboard screen
│   │   │   │   ├── accounts.tsx     ← Accounts screen (import + transactions)
│   │   │   │   ├── portfolio.tsx    ← Portfolio screen (stocks + assets)
│   │   │   │   └── growth.tsx       ← Growth Lab screen
│   │   │   └── _layout.tsx          ← root app layout (fonts, auth context)
│   │   ├── components/
│   │   │   ├── GlassCard.tsx        ← frosted glass card container
│   │   │   ├── TransactionItem.tsx  ← single transaction row + categories
│   │   │   ├── DonutChart.tsx       ← spending breakdown donut + legend
│   │   │   ├── BudgetBar.tsx        ← progress bar for budget tracking
│   │   │   └── SubscriptionCard.tsx ← subscription row component
│   │   ├── context/
│   │   │   └── AuthContext.tsx      ← biometric auth state
│   │   ├── hooks/
│   │   │   └── useColors.ts         ← theme colour constants
│   │   ├── lib/
│   │   │   ├── database.ts          ← ALL database logic (SQLite + AsyncStorage)
│   │   │   ├── currency.ts          ← FX rates, currency list, formatters
│   │   │   ├── subscriptions.ts     ← recurring charge detection algorithm
│   │   │   ├── fileReader.ts        ← reads files as base64 or text
│   │   │   └── notifications.ts     ← push notification scheduling
│   │   ├── .env                     ← EXPO_PUBLIC_DOMAIN (points to API server)
│   │   └── app.json                 ← Expo config (bundle ID, version, plugins)
│   └── api-server/
│       └── src/
│           ├── index.ts             ← Express app entry, PORT binding
│           └── routes/
│               ├── parse.ts         ← POST /api/parse-pdf and /api/parse-holdings
│               └── stocks.ts        ← GET /api/stocks/price, /search, /fx
├── pnpm-workspace.yaml              ← workspace config + native binary overrides
├── replit.md                        ← project memory (keep up to date)
├── RUN_LOCALLY.md                   ← how to run on your own machine
├── RUN_ON_CLOUD.md                  ← how to deploy the API server + app stores
└── MY_VAULT.md                      ← this file
```

---

## 3. The two services

The project is split into two independent processes:

### API Server (`artifacts/api-server`)

An Express 5 Node.js server. It exists for two reasons:

1. **PDF parsing requires system binaries** — `pdftoppm` (converts PDF pages to images) and `tesseract` (OCR, reads text from images). These cannot run inside a mobile app; they must run on a server.
2. **Yahoo Finance CORS restrictions** — Yahoo Finance blocks direct browser/app requests. The API server acts as a proxy, making the request server-side and returning the result.

The server exposes routes under `/api/` and must be running for PDF import and stock prices to work.

**Entry point:** `artifacts/api-server/src/index.ts`
**Routes:** `artifacts/api-server/src/routes/`
**Build:** compiled to `artifacts/api-server/dist/` using esbuild (CommonJS bundle)

### Mobile App (`artifacts/my-vault`)

An Expo SDK 54 app built with React Native and expo-router. It runs on iOS, Android, and in the browser (web mode has limited functionality — no biometrics).

The app knows where the API server is via the `EXPO_PUBLIC_DOMAIN` environment variable defined in `artifacts/my-vault/.env`.

```
# artifacts/my-vault/.env
EXPO_PUBLIC_DOMAIN=your-api-domain.com   # no https://, just the host
```

All API calls from the app prepend `https://` to this value. For example:
```ts
const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "localhost"}`;
fetch(`${BASE}/api/stocks/price/AAPL`)
```

---

## 4. Mobile app — screens and features

### Tab bar (`app/(tabs)/_layout.tsx`)

The tab bar is the first thing that renders after the app loads. It does two things:

1. **Checks authentication state** — if the user is not authenticated, it renders a `LockScreen` instead of the tabs. The lock screen triggers biometric authentication on mount.

2. **Picks the right tab layout** — on iOS 26+ with Liquid Glass available (`isLiquidGlassAvailable()` from expo-glass-effect), it uses the native `NativeTabs` component. On all other platforms, it uses the classic `Tabs` with a blurred background (BlurView on iOS, solid `#0D1121` on Android/web).

The four tabs are: **Dashboard**, **Accounts**, **Portfolio**, **Growth Lab**.

---

### Dashboard (`app/(tabs)/index.tsx`)

The main overview screen. Loads data every time the tab comes into focus (using `useFocusEffect`).

**What it shows:**

| Section | What it does |
|---|---|
| Net Balance | Sum of all transaction credits minus debits, plus the portfolio total — all converted to the display currency |
| Income / Spent | Two side-by-side cards, credits total and debits total |
| Monthly Cashflow chart | SVG bar chart showing green (income) and red (spending) bars per month. Filterable by year and quarter |
| Spending Breakdown | Donut chart of spending by category, with a legend |
| Monthly Budgets | Progress bars showing current month spend vs user-set limits per category |
| Subscriptions | List of auto-detected recurring charges sorted by monthly cost |
| Recent Transactions | Last 10 transactions |

**Currency conversion on the Dashboard:**

The Dashboard is the most complex screen for currency handling. Here is the exact flow:

1. Load cashflow data grouped by currency (`getMonthlyCashflowByCurrency`)
2. Load transaction totals grouped by currency (`getTotalsByCurrency`)
3. Collect all unique currencies seen across both datasets, plus the portfolio's saved currency
4. Fetch FX rates for all of them in parallel (`fetchExchangeRate`)
5. Multiply every amount by its rate and sum into the single display currency
6. The display currency is saved in the `home_currency` setting and shared with the Portfolio tab

**How the portfolio total gets here:**

The Portfolio tab calculates the total portfolio value and saves it to two SQLite settings keys: `portfolio_total_value` (number as string) and `portfolio_total_currency` (currency code). The Dashboard reads these and converts to the display currency using the FX rate.

---

### Accounts (`app/(tabs)/accounts.tsx`)

The statement import and transaction browser screen.

**Importing a statement:**

1. User taps "Upload Statement" → `DocumentPicker` opens a file picker (PDF or CSV)
2. **CSV path:** The file is read as text on-device (`readFileAsText`), then `parseCSV()` (inside `accounts.tsx` itself) converts it to transaction rows
3. **PDF path:** The file is read as base64 (`readFileAsBase64`), sent to `POST /api/parse-pdf` on the API server, which returns parsed transactions as JSON

After parsing, a preview modal shows the transactions before they are saved. The user selects the statement currency (important for multi-currency users) and taps "Import". Newly detected subscriptions are shown in an alert.

**Transaction browser:**

Transactions are grouped by month. Each month group is a collapsible `GlassCard` showing the month name, total credits, total debits, and transaction count.

- **Tap a month header:** expand or collapse it
- **Long-press a month header:** delete all transactions in that month (with confirmation alert)
- **Tap a transaction row:** open a re-categorisation modal (also has a delete button)

**Monthly reminder:**

A card at the bottom lets users schedule a monthly push notification to remind them to upload their statement. Uses `expo-notifications`. The reminder is stored locally and fires every month on the selected day. This does not work on web.

---

### Portfolio (`app/(tabs)/portfolio.tsx`)

Tracks stock holdings and manual assets.

**Two types of holdings:**

1. **Stock investments** — ticker symbol, number of shares, average buy price, broker name, currency. Live prices fetched from Yahoo Finance via the API server.
2. **Manual assets** — name, type (from `ASSET_TYPES`), value, currency, optional notes. No live price — value is what the user enters.

**Broker-grouped view:**

Holdings are grouped by `broker_name`. Each broker is a collapsible `GlassCard` header showing the broker's name and total value. Tap to expand and see individual holdings. Long-press a broker header to delete all its holdings.

**Adding a stock manually:**

1. Tap the `+` button in the header
2. Search for a company (type-ahead search, 350ms debounce, calls `/api/stocks/search`)
3. Select a result to auto-fill the ticker
4. Enter the number of shares
5. The API server fetches the current price to use as the average buy price
6. If the price can't be fetched, the user enters it manually

**Importing holdings from a PDF:**

Tap the download icon in the header. Pick a PDF holdings statement. The file is sent to `POST /api/parse-holdings`. The response includes detected holdings with tickers (where resolvable), quantities, prices, and the broker/platform name. A preview modal shows what will be imported. Existing holdings from that broker are deleted before the new import is saved.

**Manual assets:**

Tap the house icon in the header to add a manual asset. Asset types are: Real Estate, Fixed Deposit, Gold, Bonds, Savings Account, Crypto, Pension, Other.

**Total portfolio value:**

After every data load, the total (stocks + manual assets, all converted to home currency) is saved to SQLite settings so the Dashboard can display it.

---

### Growth Lab (`app/(tabs)/growth.tsx`)

A future net worth projection tool.

**How it works:**

1. Loads all investments and manual assets from the database
2. Groups them by asset class (stocks form one class, each manual asset type is its own class)
3. Converts all values to the home currency using FX rates
4. Displays each class with an editable growth rate (% per year, defaults: Stocks 10%, Gold 7%, Crypto 20%, etc.)
5. Uses compound interest formula: `value × (1 + rate/100)^years`
6. Plots the total across all classes as an SVG curve
7. Shows a milestone table at Y1, Y5, Y10, Y20, Y30 (up to the selected horizon)

**Note on stocks:** growth uses cost basis (avg_price × shares), not live market value, because that is the stable, user-controlled baseline.

The time horizon can be 1–50 years and is set with `–`/`+` buttons or quick-select presets (5y, 10y, 20y, 30y).

---

## 5. Data storage — how everything is saved

**File:** `artifacts/my-vault/lib/database.ts`

All storage logic is in this single file. It has two backends that are selected automatically:

| Platform | Backend |
|---|---|
| iOS / Android (native) | `expo-sqlite` — a real SQLite database file (`myvault.db`) on the device |
| Web (browser) | `AsyncStorage` — key-value storage, serialized as JSON |

Every exported function (`getTransactions`, `insertInvestment`, etc.) works on both backends transparently. If SQLite is available, it's used; otherwise the AsyncStorage fallback handles it.

### Database schema

```sql
-- Bank statement transactions
CREATE TABLE transactions (
  id          TEXT PRIMARY KEY,
  account_id  TEXT,
  date        TEXT NOT NULL,       -- "YYYY-MM-DD"
  description TEXT NOT NULL,
  merchant    TEXT NOT NULL,
  amount      REAL NOT NULL,       -- always positive; type indicates direction
  type        TEXT NOT NULL,       -- "credit" or "debit"
  category    TEXT DEFAULT 'Other',
  source_type TEXT DEFAULT 'Statement',
  currency    TEXT,                -- added via ALTER TABLE migration
  created_at  INTEGER NOT NULL     -- unix ms
);

-- Stock portfolio holdings
CREATE TABLE investments (
  id          TEXT PRIMARY KEY,
  broker_name TEXT NOT NULL,
  source_type TEXT NOT NULL,       -- "Manual" or "Statement"
  ticker      TEXT NOT NULL,
  shares      REAL NOT NULL,
  avg_price   REAL NOT NULL,
  currency    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Manual assets (property, gold, etc.)
CREATE TABLE assets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,       -- one of ASSET_TYPES
  value       REAL NOT NULL,
  currency    TEXT NOT NULL,
  notes       TEXT DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- App settings (key-value)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Important settings keys

| Key | What it stores |
|---|---|
| `home_currency` | The user's chosen display currency (e.g. "GBP") — shared between Dashboard and Portfolio |
| `portfolio_total_value` | Last calculated portfolio total (number as string) |
| `portfolio_total_currency` | Currency of the saved portfolio total |
| `budget_<Category>` | Monthly budget limit for each category (e.g. `budget_Food & Dining`) |
| `reminder_enabled` | "true" or "false" — whether the monthly reminder is on |
| `reminder_day` | Day of month for the monthly reminder |

### Schema migrations

When the app first runs, `initSchema()` creates all tables. If a column was added in a later version (like the `currency` column on transactions), an `ALTER TABLE` migration runs silently, catching the error if the column already exists:

```ts
try {
  await db.runAsync("ALTER TABLE transactions ADD COLUMN currency TEXT DEFAULT 'GBP'");
} catch { /* already exists */ }
```

**When adding a new column:** add it to `CREATE TABLE` (for fresh installs) and add a matching `ALTER TABLE` in the migrations block (for existing users).

### Auto-categorisation

`categorize(merchant)` in `database.ts` is called whenever a transaction is saved. It matches the merchant name against a list of regex patterns and assigns a category. The same logic exists in `parse.ts` on the API server for PDF imports.

To add a new merchant to a category, add it to the relevant regex in `categorize()`. Both files should be kept in sync.

---

## 6. Shared libraries

### `lib/currency.ts`

```ts
CURRENCIES          // string[] — the list of currencies shown in the picker
CURRENCY_SYMBOLS    // Record<string, string> — e.g. { GBP: "£", USD: "$" }
getCurrencySymbol(currency)        // returns the symbol or currency code as fallback
formatCurrency(amount, currency)   // returns formatted string, e.g. "£1,234.56"
fetchExchangeRate(from, to)        // calls /api/stocks/fx, returns a number (rate)
```

`fetchExchangeRate` returns `1` silently on any error — callers don't need to handle failures. To add a new currency, add it to `CURRENCIES` and `CURRENCY_SYMBOLS`.

### `lib/database.ts`

Every exported function here is the only way the app reads or writes data. Never query SQLite directly from a screen — always go through these functions.

Key exports beyond the schema functions:

```ts
categorize(merchant)                    // auto-assign category from merchant name
getTotalsByCurrency()                   // { GBP: { credits, debits }, USD: {...}, ... }
getMonthlyCashflowByCurrency()          // per-month, per-currency cashflow
getCategoryBreakdown()                  // sorted array of { category, total, pct }
getBudgets()                            // { "Food & Dining": 300, ... }
setBudget(category, limit)              // save or update a budget
deleteBudget(category)                  // remove a budget
getThisMonthCategorySpend()             // { "Food & Dining": 145.20, ... }
updateTransactionCategory(id, category) // re-label a transaction
deleteInvestmentsByBroker(brokerName)   // delete all Statement-type holdings for a broker
ASSET_TYPES                             // readonly tuple of asset type strings
ASSET_TYPE_ICONS                        // Record<string, string> of emoji icons
```

### `lib/subscriptions.ts`

The subscription detection algorithm. Takes a `Transaction[]` array and returns `DetectedSubscription[]`.

**How it works:**
1. Filter to debit transactions only
2. Group by normalised merchant name (lowercased, suffixes like "Ltd" removed, non-alphanumeric removed)
3. Within each merchant group, further split by exact amount (rounded to 2 decimal places)
4. For each amount group with 2+ occurrences:
   - Check that they span at least 2 different calendar months (avoids false positives from same-month duplicates)
   - Calculate average interval in days between consecutive charges
   - Classify as weekly (5–10 days), monthly (24–38 days), quarterly (82–98 days), or annual (340–390 days)
   - For monthly: check that the day-of-month is consistent (±5 days)
   - For weekly: check that interval variance is tight (±2 days)
5. Return `DetectedSubscription` with `monthlyEquiv` (normalised to monthly cost for sorting)

The `nextExpected` date is calculated by adding the average interval to the last seen date.

### `lib/fileReader.ts`

Reads a file from the device filesystem as either text or base64. Handles the difference between Expo's newer file system API and the legacy API that some Expo versions use.

```ts
readFileAsBase64(uri)  // returns a base64 string (used for PDF → API server)
readFileAsText(uri)    // returns the raw text content (used for CSV parsing)
```

### `lib/notifications.ts`

```ts
requestNotificationPermissions()     // asks the OS for permission; returns boolean
scheduleMonthlyReminder(day)         // schedules a repeating notification on that day of month
cancelReminder()                     // cancels the scheduled reminder
getReminderSettings()                // { enabled: boolean, day: number }
notifyNewSubscription(merchant, monthlyEquiv)  // fires an immediate notification
```

Does nothing (gracefully) on web.

---

## 7. API server — routes explained

**File:** `artifacts/api-server/src/routes/`

### `GET /api/stocks/price/:ticker`

Fetches the current price of a stock from Yahoo Finance.

- Input: ticker symbol in the URL (e.g. `/api/stocks/price/AAPL`)
- Yahoo Finance is called with the ticker; returns `regularMarketPrice` and `currency`
- Special case: Yahoo returns LSE prices in pence (`GBp`/`GBX`). These are divided by 100 and the currency is changed to `GBP`
- Returns: `{ ticker, price, currency, exchange, name }`
- Returns 404 if the ticker is not found

### `GET /api/stocks/search?q=`

Searches for companies by name or ticker.

- Input: search string as query param `q`
- Calls Yahoo Finance search API, filters to EQUITY and ETF types
- Returns: `{ results: [{ symbol, name, exchange, type }] }`

### `GET /api/stocks/fx?from=X&to=Y`

Converts between two currencies.

- Input: `from` and `to` as 3-letter currency codes
- Calls the Frankfurter API (free, no API key needed)
- Response is cached for 5 minutes (`Cache-Control: public, max-age=300`)
- Returns: `{ rate: number }`
- Returns `{ rate: 1 }` if `from === to`

### `POST /api/parse-pdf`

Accepts a bank statement PDF and returns parsed transactions.

- Input JSON: `{ base64: string, filename: string }`
- Decodes the base64 to a Buffer
- Tries text extraction first (fast, works for digital PDFs)
- If fewer than 3 transactions found and the PDF has images, falls back to OCR
- OCR flow: convert each page to a PNG using `pdftoppm`, then run `tesseract` on each image
- Detected format (running-balance, credit-card columns, deposits/withdrawals, generic) determines the parsing strategy
- Returns: `{ transactions: ParsedTransaction[], strategy: string, pageCount: number }`

### `POST /api/parse-holdings`

Accepts a broker holdings statement PDF and returns investment positions.

- Input JSON: `{ base64: string }`
- Uses OCR if needed (same flow as above)
- Looks for ISIN codes, ticker symbols, quantities, prices
- Tries to resolve ISINs to Yahoo Finance tickers via the search API
- Returns: `{ holdings: ParsedHolding[], platform: string, asOf: string }`

---

## 8. PDF and CSV parsing — deep dive

**File:** `artifacts/api-server/src/routes/parse.ts`

### Format detection

The first step is `detectStrategy(text)`. It reads the full extracted text and decides which parser to use:

| Strategy | Detection signal |
|---|---|
| `credit-card` | 3+ lines that start with two dates followed by a merchant (dual-date pattern), e.g. "Apr 8  Apr 8  AMAZON" |
| `deposits-withdrawals` | Text contains "Deposits Withdrawals" or "Paid In Paid Out" headers, or dates in DDMmmYYYY format (HSBC India, SBI, ICICI) |
| `running-balance` | Explicit "Balance Brought Forward" / "Opening Balance" phrases, or 3+ rows each containing a date and 2+ decimal amounts |
| `generic` | None of the above — opportunistic parsing |

### Running-balance parser (`parseRunningBalance`)

This handles HSBC UK current accounts, Barclays, NatWest, Lloyds, Santander, Halifax, Monzo, Starling, and similar banks where each row has a running account balance.

**Core algorithm:**
1. Maintain `lastBalance` — the running account balance after each row
2. When a date line is found, record `currentDate` and `currentMerchant`
3. When a line contains 2+ amounts, treat the last amount as the new balance and the second-to-last as the transaction amount
4. When a line contains 1 amount:
   - If it looks like a balance (close in value to `lastBalance`), call `emitPending(balance)`
   - Otherwise, it's a transaction amount — queue it in `pending`
5. `emitPending(newBalance)`: take all `pending` transactions and emit them. The credit/debit direction for each comes from the type code hint (BP, CR, DD, etc.), falling back to whether the overall balance change was positive or negative

**Type codes:** `BP`, `OBP`, `VIS`, `CR`, `DR`, `DD`, `SO`, `ATM`, `CHQ`, `FT`, `TFR`, `STO`, `BAC`, `FPS`, `BGC`, `OTH`, `CC` — recognised from the start of a transaction description line. Credit indicators: `CR`, `BGC`, `FPS`, `BAC`. Debit indicators: all others.

### Credit-card parser (`parseCreditCardColumns`)

Handles Amex, Barclaycard, MBNA, HSBC credit cards, and Capital One. These PDFs extract text in two columns — the left column has dates and merchant names, the right column has amounts — but they come out interleaved when extracted as text.

**Algorithm:**
1. Split the text by page separators (`-- 1 of N --`)
2. Within each page segment, collect transaction rows and standalone amounts separately
3. Zip them back together in order
4. Credits are identified by: `CR` marker lines before the transactions, "OTHER ACCOUNT TRANSACTIONS" headers, or merchant keywords like "Payment Received", "Refund", "Cashback"

### Deposits-withdrawals parser (`parseDepositsWithdrawals`)

For Indian banks and some international formats (HSBC India, SBI, ICICI, DBS) where each row has separate Deposits and Withdrawals columns.

### Generic parser (`parseGeneric`)

A catch-all. Finds any line starting with a recognised date pattern and extracts amounts from it. Credits identified by `CR` keyword, `+` prefix, or salary/refund keywords.

### Adding support for a new bank

1. Run a test import — note the strategy detected and what comes back
2. If it uses an existing strategy: look at the categorise regex and the type codes — add any new bank-specific codes
3. If it's a new format: add detection logic to `detectStrategy()` and write a new parser function following the same `ParsedTransaction[]` return type

---

## 9. Multi-currency system

The app fully supports multiple currencies at every level.

**How currencies flow through the app:**

1. At import, the user selects the statement currency (a picker shown in the preview modal). This is stored on every transaction as the `currency` column.
2. Investments each have their own `currency` (the currency the stock is priced in, e.g. USD for US stocks, GBP for LSE stocks).
3. Manual assets each have their own `currency`.
4. The user picks a **home/display currency** (stored in `home_currency` setting). This is shared across Dashboard and Portfolio via the same settings key.

**FX conversion:**

Whenever amounts from multiple currencies need to be summed or displayed, the app:
1. Collects all unique currencies present in the dataset
2. Calls `fetchExchangeRate(currency, homeCurrency)` for each — in parallel using `Promise.all`
3. Multiplies each amount by its rate and sums

The FX rate is fetched live from the Frankfurter API (free, no key) via the API server, cached on the server for 5 minutes. If the rate cannot be fetched, the fallback is `1` (no conversion).

**Currencies supported:** GBP, USD, EUR, INR, CHF, JPY, CAD, AUD, SGD, HKD, AED

To add a new currency: add it to `CURRENCIES` and `CURRENCY_SYMBOLS` in `lib/currency.ts`.

---

## 10. Subscription detection

**File:** `artifacts/my-vault/lib/subscriptions.ts`

Called in two places:
- `accounts.tsx` — after every import, to detect newly added subscriptions and show an alert
- `index.tsx` (Dashboard) — on load, to show the subscriptions list with monthly costs

The detection is purely algorithmic — no hardcoded merchant list. It analyses transaction history to find recurring patterns.

**Rules a transaction group must pass to be called a subscription:**
1. Same normalised merchant name
2. Same exact amount (to 2 decimal places)
3. 2+ occurrences
4. Spans at least 2 different calendar months
5. Average interval falls into weekly/monthly/quarterly/annual bands
6. For monthly: day-of-month is consistent within ±5 days

**Output fields:**
- `merchant` — display name
- `amount` — the recurring amount
- `frequency` / `frequencyLabel` — e.g. "monthly" / "Monthly"
- `monthlyEquiv` — amount normalised to per-month cost (used for sorting)
- `lastDate` — date of most recent charge
- `nextExpected` — predicted next charge date

---

## 11. UI system — design language

The app uses a **dark glassmorphism** style.

### Colours

Defined in `hooks/useColors.ts`:

| Token | Value | Usage |
|---|---|---|
| `background` | `#080B14` | Screen backgrounds |
| `foreground` | `#F0F4FF` | Primary text |
| `mutedForeground` | `rgba(240,244,255,0.45)` | Labels, secondary text |
| `primary` | `#00D4FF` | Accent, buttons, active states |
| `credit` | `#10B981` | Income, positive amounts |
| `debit` | `#EF4444` | Spending, negative amounts |
| `border` | `rgba(255,255,255,0.08)` | Card borders, dividers |
| `cardBg` | `rgba(255,255,255,0.04)` | Glass card backgrounds |

### GlassCard component

`components/GlassCard.tsx` is the primary card container. Every card in the app uses this. Props: `style`, `padding` (default 16), `children`.

It renders a `View` with the glass background colour and a subtle border. On iOS it does not use BlurView (that is only used for the tab bar background).

### Typography

The app uses the Inter font family, loaded at startup:
- `Inter_400Regular` — body text
- `Inter_500Medium` — labels
- `Inter_600SemiBold` — subheadings
- `Inter_700Bold` — headings and large numbers

All `Text` components should specify `fontFamily` explicitly — there is no global default.

### Charts

All charts are built with `react-native-svg` — no charting library. They are raw SVG elements (`Rect`, `Path`, `Line`, `Text`) drawn with manual coordinate calculations. The chart width is derived from `Dimensions.get("window").width` minus padding.

### Modal rules

Never combine `transparent` with `presentationStyle="pageSheet"` on a Modal — this causes a crash on iOS. The pattern used throughout the app:

```tsx
<Modal
  visible={visible}
  animationType="slide"
  presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
>
```

---

## 12. Authentication (biometric lock)

**Files:** `context/AuthContext.tsx`, `app/(tabs)/_layout.tsx`

The auth system is simple by design — it is purely client-side on the device. There are no tokens, sessions, or servers involved.

**How it works:**
1. `AuthContext` holds a boolean `isAuthenticated` state, defaulting to `false`
2. When the user opens the app (or tabs back in), `_layout.tsx` checks `isAuthenticated`
3. If false, it renders `LockScreen` instead of the tabs
4. `LockScreen` immediately calls `authenticate()` on mount (so Face ID / fingerprint prompt appears automatically)
5. `authenticate()` uses `expo-local-authentication` — if biometrics are enrolled, it uses them; if not, it falls back to device PIN/passcode
6. On web, authentication is skipped (always authenticated)

The auth state lives in memory. If the app is fully closed and reopened, the user must authenticate again. There is no "remember me" or session timeout.

To change this behaviour, edit `AuthContext.tsx`.

---

## 13. Notifications

**File:** `lib/notifications.ts`

Uses `expo-notifications`. Works on iOS and Android only (web is silently skipped).

Two types of notification:

1. **Monthly reminder** — a repeating scheduled notification. The user picks the day of month. Stored using `Notifications.scheduleNotificationAsync` with a `CalendarTrigger`.

2. **Subscription detected** — an immediate notification fired after import when a new recurring charge is detected. Triggered by `notifyNewSubscription(merchant, monthlyEquiv)`.

Before scheduling, `requestNotificationPermissions()` must be called — it asks the OS for permission and returns `true` if granted.

---

## 14. Common tasks — how to make changes

### Add a new spending category

1. Open `components/TransactionItem.tsx` — add the category to `ALL_CATEGORIES` and give it an icon in `CATEGORY_ICONS`
2. Open `components/DonutChart.tsx` — add a colour in `CATEGORY_COLORS`
3. Open `lib/database.ts` — add keyword matches in `categorize()`
4. Open `api-server/src/routes/parse.ts` — add the same keywords in the `categorize()` there

### Add a new currency

1. Open `lib/currency.ts` — add to `CURRENCIES` and `CURRENCY_SYMBOLS`

### Add a new manual asset type

1. Open `lib/database.ts` — add to `ASSET_TYPES` and `ASSET_TYPE_ICONS`
2. Open `app/(tabs)/growth.tsx` — add a default growth rate in `DEFAULT_RATES` and an icon in `CLASS_ICONS` and a colour in `CLASS_COLORS`

### Add a new screen / tab

1. Create a file in `app/(tabs)/yourscreen.tsx` (default export a React component)
2. Open `app/(tabs)/_layout.tsx`:
   - Add a `<Tabs.Screen>` entry in `ClassicTabLayout`
   - Add a `<NativeTabs.Trigger>` entry in `NativeTabLayout`

### Change the API server's base URL

Edit `artifacts/my-vault/.env`:
```
EXPO_PUBLIC_DOMAIN=your-new-domain.com
```

This propagates to all three API call locations: `lib/currency.ts`, and the two inline `BASE` constants in `portfolio.tsx` and `accounts.tsx`.

### Add a new API server route

1. Create `artifacts/api-server/src/routes/yourroute.ts` — export a Router
2. Open `artifacts/api-server/src/index.ts` — import and `app.use("/api", yourRouter)`
3. Rebuild: `pnpm --filter @workspace/api-server run build`

### Change the categorisation logic for PDF parsing

Edit the `categorize()` function inside `artifacts/api-server/src/routes/parse.ts` and mirror the change in `artifacts/my-vault/lib/database.ts`.

### Change default growth rates in Growth Lab

Edit `DEFAULT_RATES` near the top of `artifacts/my-vault/app/(tabs)/growth.tsx`. These are only the starting values — the user can change them in the UI and they reset on each screen visit.

---

## 15. Known sharp edges

**Tesseract binary paths are hardcoded**

In `artifacts/api-server/src/routes/parse.ts`, lines 13–14:
```ts
const TESSERACT_BIN = "/nix/store/.../bin/tesseract";
const TESSDATA_DIR  = "/nix/store/.../share/tessdata";
```
These paths work on Replit only. Change them when deploying elsewhere. See `RUN_LOCALLY.md` for the correct paths per OS.

**pnpm-workspace.yaml excludes non-Linux native binaries**

The `overrides` section blocks `darwin-*` and `win32-*` native packages to keep the Replit environment lean. Remove the relevant lines for your platform before running `pnpm install` locally. See `RUN_LOCALLY.md`, Step 1.

**home_currency is the same setting for Dashboard and Portfolio**

Both tabs read and write `home_currency`. Changing the currency on one tab immediately affects the other. This is by design — keep it that way when adding new screens.

**Modal rule: no `transparent` + `presentationStyle="pageSheet"` together**

This combination crashes iOS. Always use either `presentationStyle` alone or `transparent` alone, never both.

**`deleteInvestmentsByBroker` only deletes `source_type = "Statement"` holdings**

This is intentional — manually added holdings (`source_type = "Manual"`) under the same broker name are not deleted when you import a new statement from that broker. If you need to delete all holdings for a broker regardless of source, change the SQL in `database.ts`.

**CSV parsing is done client-side**

CSV files are parsed in `accounts.tsx` directly on the device (the `parseCSV` function at the top of the file). They do not go to the API server. Only PDFs are sent to the server.

**The web platform has limited functionality**

- No biometric lock (always authenticated)
- No push notifications
- No haptic feedback
- SQLite is not available (falls back to AsyncStorage, which has lower storage limits)

**`app.json` has `"origin": "https://replit.com/"`**

This is required for expo-router to work in the Replit preview. Change it to your own domain before building for the App Store. See `RUN_ON_CLOUD.md`.
