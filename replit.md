# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains an Express API server and the "My Vault" Expo mobile finance app.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Mobile**: Expo SDK 54, expo-router, React Native
- **Mobile storage**: expo-sqlite (native) / AsyncStorage (web fallback)
- **Build**: esbuild (CJS bundle for API server)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/my-vault exec tsc --noEmit` — typecheck the Expo app
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## My Vault — Mobile Finance App

Dark glassmorphism finance app at `artifacts/my-vault`.

### Features
- **Biometric lock** (expo-local-authentication)
- **Bank statement import** — PDF + CSV parsing via api-server, SQLite storage
- **Multi-currency** — statements tagged with any currency at import; dashboard/portfolio convert all amounts to the user's chosen display currency via live FX rates (`/api/stocks/fx`)
- **Dashboard** — Net Balance, Income/Spent (FX-converted), Monthly Cashflow chart, Spending Breakdown donut, Monthly Budgets, Subscription detection, Recent Transactions
- **Accounts tab** — statement upload, monthly transaction browser with long-press delete, category re-labelling
- **Portfolio tab** — live stock prices (Yahoo Finance via api-server), multi-currency holdings, P&L tracking, bulk delete, CSV/PDF holdings import
- **Other Assets** — manual asset tracking: Real Estate, Fixed Deposit, Gold, Bonds, Savings Account, Crypto, Pension, Other; each with name, type, value, currency; FX-converted into portfolio total

### Key Libraries (my-vault)
- `artifacts/my-vault/lib/currency.ts` — CURRENCIES, CURRENCY_SYMBOLS, getCurrencySymbol, formatCurrency, fetchExchangeRate
- `artifacts/my-vault/lib/database.ts` — SQLite/AsyncStorage: transactions (with currency column), investments, assets tables; getTotalsByCurrency, getMonthlyCashflowByCurrency, Asset CRUD
- `artifacts/my-vault/lib/fileReader.ts` — expo-file-system/legacy for PDF/CSV base64 reads
- `artifacts/my-vault/lib/subscriptions.ts` — recurring charge detection

### API Server routes (artifacts/api-server)
- `POST /api/parse-statement` — PDF/CSV bank statement parsing
- `POST /api/parse-holdings` — PDF holdings/portfolio parsing
- `GET /api/stocks/price/:ticker` — live Yahoo Finance price
- `GET /api/stocks/search?q=` — company/ticker search
- `GET /api/stocks/fx?from=X&to=Y` — exchange rate lookup

### Architecture notes
- `home_currency` setting is shared between portfolio and dashboard (same SQLite `settings` table key)
- SQLite migration: `ALTER TABLE transactions ADD COLUMN currency TEXT DEFAULT 'GBP'` (runs silently if already exists)
- Assets table: `id, name, type, value, currency, notes, created_at`
- Portfolio total = stock market value + manual asset values (all converted to home currency), saved to `portfolio_total_value` setting for the dashboard to display
