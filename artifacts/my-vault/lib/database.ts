import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export interface Transaction {
  id: string;
  account_id: string | null;
  date: string;
  description: string;
  merchant: string;
  amount: number;
  type: "credit" | "debit";
  category: string;
  source_type: string;
  created_at: number;
}

export interface Investment {
  id: string;
  broker_name: string;
  source_type: "Statement" | "Manual";
  ticker: string;
  shares: number;
  avg_price: number;
  currency: string;
  created_at: number;
}

export interface MonthlyCashflow {
  month: string;
  credits: number;
  debits: number;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export function categorize(merchant: string): string {
  const m = merchant.toLowerCase();
  if (/mcdonalds|kfc|subway|pizza|burger|restaurant|cafe|starbucks|costa|tesco|asda|sainsbury|lidl|aldi|waitrose|morrisons|takeaway|sushi|indian|chinese|thai|hasty|lahori|mowgli|taj mahal|streate/.test(m)) return "Food & Dining";
  if (/uber|lyft|trainline|rail|tube|lul\s|tfl|arriva|bus|taxi|transport|parking|petrol|fuel|shell|railcard|ticket machine/.test(m)) return "Transport";
  if (/netflix|spotify|disney\+|disney plus|apple tv\+|apple one|hbo|paramount|now tv|nowtv|dazn|crunchyroll|mubi|bbc sounds|audible|kindle unlimited|duolingo|headspace|calm|grammarly|1password|lastpass|nordvpn|expressvpn|dropbox|icloud|google one|microsoft 365|office 365|adobe|canva|figma|notion|obsidian|chatgpt|claude|github copilot|cursor|linear|slack|zoom|twitch/.test(m)) return "Subscriptions";
  if (/sky\s|nowtv|twitch|youtube premium|hbo|manchester united|mufc|ticketing/.test(m)) return "Entertainment";
  if (/amazon|ebay|asos|zara|h&m|primark|jd sports|sports direct|next|argos|currys|john lewis|ikea|shopping|fashion/.test(m)) return "Shopping";
  if (/electricity|gas|water|sse|british gas|e\.on|edf|thames|severn|vodafone|o2|ee\s|three\s|talktalk|broadband|internet/.test(m)) return "Bills & Utilities";
  if (/rent|mortgage|letting|estate agent|benham|reeves/.test(m)) return "Housing";
  if (/gym|fitness|sport|running|yoga|pilates|swimming|botanic/.test(m)) return "Health & Fitness";
  if (/holiday|hotel|airbnb|booking|expedia|flight|easyjet|ryanair|british airways|hilton|marriott|aloft|trip_uk/.test(m)) return "Travel";
  if (/salary|payroll|wage|income|facebook|google|employer/.test(m)) return "Income";
  if (/transfer|payment|revolut|monzo|paypal|cash app|wise|splitwise/.test(m)) return "Transfers";
  return "Other";
}

// ─── AsyncStorage helpers ─────────────────────────────────────────────────────

const AS_TX_KEY = "vault_transactions";
const AS_INV_KEY = "vault_investments";
const AS_SETTINGS_KEY = "vault_settings";

async function asGetAll<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T[]) : [];
}

async function asSetAll<T>(key: string, items: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(items));
}

// ─── SQLite (native) implementation ──────────────────────────────────────────

type SQLiteDb = import("expo-sqlite").SQLiteDatabase;

// Single promise so SQLite is only opened once; resolves to null if unavailable
const _dbPromise: Promise<SQLiteDb | null> =
  Platform.OS === "web"
    ? Promise.resolve(null)
    : (async () => {
        try {
          const SQLite = await import("expo-sqlite");
          const db = await SQLite.openDatabaseAsync("myvault.db");
          await initSchema(db);
          return db;
        } catch {
          return null; // Expo Go or restricted environment — fall back to AsyncStorage
        }
      })();

async function getDb(): Promise<SQLiteDb | null> {
  return _dbPromise;
}

async function initSchema(db: SQLiteDb) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      merchant TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      category TEXT DEFAULT 'Other',
      source_type TEXT DEFAULT 'Statement',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      broker_name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'Manual',
      ticker TEXT NOT NULL,
      shares REAL NOT NULL,
      avg_price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function insertTransactions(
  txs: Array<{
    account_id?: string | null;
    date: string;
    description: string;
    merchant: string;
    amount: number;
    type: string;
    category?: string;
    source_type?: string;
  }>
): Promise<number> {
  const db = await getDb();

  if (!db) {
    const existing = await asGetAll<Transaction>(AS_TX_KEY);
    const next = txs.map((tx) => ({
      id: genId(),
      account_id: tx.account_id ?? null,
      date: tx.date,
      description: tx.description,
      merchant: tx.merchant,
      amount: tx.amount,
      type: tx.type as "credit" | "debit",
      category: tx.category ?? categorize(tx.merchant),
      source_type: tx.source_type ?? "Statement",
      created_at: Date.now(),
    }));
    await asSetAll(AS_TX_KEY, [...existing, ...next]);
    return next.length;
  }

  let inserted = 0;
  await db.withTransactionAsync(async () => {
    for (const tx of txs) {
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, date, description, merchant, amount, type, category, source_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          genId(), tx.account_id ?? null, tx.date, tx.description,
          tx.merchant, tx.amount, tx.type,
          tx.category ?? categorize(tx.merchant),
          tx.source_type ?? "Statement", Date.now(),
        ]
      );
      inserted++;
    }
  });
  return inserted;
}

export async function getTransactions(limit = 200): Promise<Transaction[]> {
  const db = await getDb();
  if (!db) {
    const all = await asGetAll<Transaction>(AS_TX_KEY);
    return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }
  return db.getAllAsync<Transaction>(
    "SELECT * FROM transactions ORDER BY date DESC LIMIT ?", [limit]
  );
}

export async function deleteAllTransactions(): Promise<void> {
  const db = await getDb();
  if (!db) {
    await asSetAll(AS_TX_KEY, []);
    return;
  }
  await db.runAsync("DELETE FROM transactions");
}

export async function getMonthlyCashflow(): Promise<MonthlyCashflow[]> {
  const db = await getDb();
  if (!db) {
    const all = await asGetAll<Transaction>(AS_TX_KEY);
    const byMonth: Record<string, { credits: number; debits: number }> = {};
    for (const tx of all) {
      const month = tx.date.substring(0, 7);
      if (!byMonth[month]) byMonth[month] = { credits: 0, debits: 0 };
      if (tx.type === "credit") byMonth[month].credits += tx.amount;
      else byMonth[month].debits += tx.amount;
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, v]) => ({ month, credits: +v.credits.toFixed(2), debits: +v.debits.toFixed(2) }));
  }
  return db.getAllAsync<MonthlyCashflow>(
    `SELECT strftime('%Y-%m', date) as month,
      ROUND(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END),2) as credits,
      ROUND(SUM(CASE WHEN type='debit' THEN amount ELSE 0 END),2) as debits
    FROM transactions GROUP BY month ORDER BY month DESC`
  );
}

export async function getTotals(): Promise<{ totalCredits: number; totalDebits: number; balance: number }> {
  const db = await getDb();
  if (!db) {
    const all = await asGetAll<Transaction>(AS_TX_KEY);
    let credits = 0, debits = 0;
    for (const tx of all) {
      if (tx.type === "credit") credits += tx.amount;
      else debits += tx.amount;
    }
    return { totalCredits: +credits.toFixed(2), totalDebits: +debits.toFixed(2), balance: +(credits - debits).toFixed(2) };
  }
  const row = await db.getFirstAsync<{ credits: number; debits: number }>(
    `SELECT ROUND(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END),2) as credits,
            ROUND(SUM(CASE WHEN type='debit' THEN amount ELSE 0 END),2) as debits
     FROM transactions`
  );
  const c = row?.credits ?? 0, d = row?.debits ?? 0;
  return { totalCredits: c, totalDebits: d, balance: +(c - d).toFixed(2) };
}

export async function getInvestments(): Promise<Investment[]> {
  const db = await getDb();
  if (!db) return asGetAll<Investment>(AS_INV_KEY);
  return db.getAllAsync<Investment>("SELECT * FROM investments ORDER BY broker_name, ticker");
}

export async function insertInvestment(inv: Omit<Investment, "id" | "created_at">): Promise<void> {
  const db = await getDb();
  if (!db) {
    const existing = await asGetAll<Investment>(AS_INV_KEY);
    await asSetAll(AS_INV_KEY, [...existing, { ...inv, id: genId(), created_at: Date.now() }]);
    return;
  }
  await db.runAsync(
    `INSERT INTO investments (id, broker_name, source_type, ticker, shares, avg_price, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [genId(), inv.broker_name, inv.source_type, inv.ticker, inv.shares, inv.avg_price, inv.currency, Date.now()]
  );
}

export async function deleteInvestment(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const existing = await asGetAll<Investment>(AS_INV_KEY);
    await asSetAll(AS_INV_KEY, existing.filter((i) => i.id !== id));
    return;
  }
  await db.runAsync("DELETE FROM investments WHERE id = ?", [id]);
}

export async function deleteInvestmentsByBroker(brokerName: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const existing = await asGetAll<Investment>(AS_INV_KEY);
    await asSetAll(AS_INV_KEY, existing.filter((i) => !(i.broker_name === brokerName && i.source_type === "Statement")));
    return;
  }
  await db.runAsync("DELETE FROM investments WHERE broker_name = ? AND source_type = 'Statement'", [brokerName]);
}

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const db = await getDb();
  if (!db) {
    const raw = await AsyncStorage.getItem(`${AS_SETTINGS_KEY}_${key}`);
    return raw ?? fallback;
  }
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    await AsyncStorage.setItem(`${AS_SETTINGS_KEY}_${key}`, value);
    return;
  }
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
}

export interface CategoryTotal {
  category: string;
  total: number;
  pct: number;
}

export async function getCategoryBreakdown(): Promise<CategoryTotal[]> {
  const db = await getDb();
  let all: Transaction[];
  if (!db) {
    all = await asGetAll<Transaction>(AS_TX_KEY);
  } else {
    all = await db.getAllAsync<Transaction>("SELECT * FROM transactions WHERE type = 'debit'");
  }

  const byCategory: Record<string, number> = {};
  for (const tx of all) {
    if (tx.type !== "debit") continue;
    byCategory[tx.category] = (byCategory[tx.category] ?? 0) + tx.amount;
  }

  const totalSpend = Object.values(byCategory).reduce((s, v) => s + v, 0);
  if (totalSpend === 0) return [];

  return Object.entries(byCategory)
    .map(([category, total]) => ({
      category,
      total: +total.toFixed(2),
      pct: +((total / totalSpend) * 100).toFixed(1),
    }))
    .sort((a, b) => b.total - a.total);
}

export async function updateTransactionCategory(id: string, category: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const all = await asGetAll<Transaction>(AS_TX_KEY);
    const updated = all.map((tx) => (tx.id === id ? { ...tx, category } : tx));
    await asSetAll(AS_TX_KEY, updated);
    return;
  }
  await db.runAsync("UPDATE transactions SET category = ? WHERE id = ?", [category, id]);
}

// ─── Budgets (stored as settings budget_<category>) ──────────────────────────

export async function getBudgets(): Promise<Record<string, number>> {
  const prefix = "budget_";
  const result: Record<string, number> = {};
  const db = await getDb();
  if (!db) {
    const keys = await AsyncStorage.getAllKeys();
    for (const k of keys) {
      if (k.startsWith(`${AS_SETTINGS_KEY}_${prefix}`)) {
        const cat = k.slice(`${AS_SETTINGS_KEY}_${prefix}`.length);
        const val = await AsyncStorage.getItem(k);
        if (val) result[cat] = parseFloat(val);
      }
    }
    return result;
  }
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key LIKE 'budget_%'"
  );
  for (const row of rows) {
    const cat = row.key.slice(prefix.length);
    result[cat] = parseFloat(row.value);
  }
  return result;
}

export async function updateInvestment(
  id: string,
  shares: number,
  avg_price: number,
  currency?: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const all = await asGetAll<Investment>(AS_INV_KEY);
    const updated = all.map((inv) =>
      inv.id === id ? { ...inv, shares, avg_price, ...(currency ? { currency } : {}) } : inv
    );
    await asSetAll(AS_INV_KEY, updated);
    return;
  }
  if (currency) {
    await db.runAsync(
      "UPDATE investments SET shares = ?, avg_price = ?, currency = ? WHERE id = ?",
      [shares, avg_price, currency, id]
    );
  } else {
    await db.runAsync("UPDATE investments SET shares = ?, avg_price = ? WHERE id = ?", [shares, avg_price, id]);
  }
}

export async function setBudget(category: string, limit: number): Promise<void> {
  await setSetting(`budget_${category}`, limit.toFixed(2));
}

export async function deleteBudget(category: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    await AsyncStorage.removeItem(`${AS_SETTINGS_KEY}_budget_${category}`);
    return;
  }
  await db.runAsync("DELETE FROM settings WHERE key = ?", [`budget_${category}`]);
}

export interface MonthSpend {
  category: string;
  spent: number;
}

export async function getThisMonthCategorySpend(): Promise<Record<string, number>> {
  const month = new Date().toISOString().substring(0, 7);
  const result: Record<string, number> = {};
  const db = await getDb();
  if (!db) {
    const all = await asGetAll<Transaction>(AS_TX_KEY);
    for (const tx of all) {
      if (tx.type !== "debit") continue;
      if (!tx.date.startsWith(month)) continue;
      result[tx.category] = (result[tx.category] ?? 0) + tx.amount;
    }
    return result;
  }
  const rows = await db.getAllAsync<{ category: string; spent: number }>(
    `SELECT category, ROUND(SUM(amount), 2) as spent
     FROM transactions
     WHERE type = 'debit' AND strftime('%Y-%m', date) = ?
     GROUP BY category`,
    [month]
  );
  for (const row of rows) {
    result[row.category] = row.spent;
  }
  return result;
}
