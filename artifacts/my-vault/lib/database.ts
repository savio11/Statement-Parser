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
  if (/netflix|spotify|disney|sky\s|nowtv|twitch|youtube|hbo|apple tv|manchester united|mufc|ticketing/.test(m)) return "Entertainment";
  if (/amazon|ebay|asos|zara|h&m|primark|jd sports|sports direct|next|argos|currys|john lewis|ikea|shopping|fashion/.test(m)) return "Shopping";
  if (/electricity|gas|water|sse|british gas|e\.on|edf|thames|severn|vodafone|o2|ee\s|three\s|talktalk|broadband|internet/.test(m)) return "Bills & Utilities";
  if (/rent|mortgage|letting|estate agent|benham|reeves/.test(m)) return "Housing";
  if (/gym|fitness|sport|running|yoga|pilates|swimming|botanic/.test(m)) return "Health & Fitness";
  if (/holiday|hotel|airbnb|booking|expedia|flight|easyjet|ryanair|british airways|hilton|marriott|aloft|trip_uk/.test(m)) return "Travel";
  if (/salary|payroll|wage|income|facebook|google|employer/.test(m)) return "Income";
  if (/transfer|payment|revolut|monzo|paypal|cash app|wise|splitwise/.test(m)) return "Transfers";
  return "Other";
}

// ─── AsyncStorage (web) implementation ───────────────────────────────────────

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
let _db: SQLiteDb | null = null;

async function getNativeDb(): Promise<SQLiteDb> {
  if (!_db) {
    const SQLite = await import("expo-sqlite");
    _db = await SQLite.openDatabaseAsync("myvault.db");
    await initSchema(_db);
  }
  return _db;
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
  if (Platform.OS === "web") {
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

  const db = await getNativeDb();
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
  if (Platform.OS === "web") {
    const all = await asGetAll<Transaction>(AS_TX_KEY);
    return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }
  const db = await getNativeDb();
  return db.getAllAsync<Transaction>(
    "SELECT * FROM transactions ORDER BY date DESC LIMIT ?", [limit]
  );
}

export async function deleteAllTransactions(): Promise<void> {
  if (Platform.OS === "web") {
    await asSetAll(AS_TX_KEY, []);
    return;
  }
  const db = await getNativeDb();
  await db.runAsync("DELETE FROM transactions");
}

export async function getMonthlyCashflow(): Promise<MonthlyCashflow[]> {
  if (Platform.OS === "web") {
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
      .slice(0, 6)
      .map(([month, v]) => ({ month, credits: +v.credits.toFixed(2), debits: +v.debits.toFixed(2) }));
  }
  const db = await getNativeDb();
  return db.getAllAsync<MonthlyCashflow>(
    `SELECT strftime('%Y-%m', date) as month,
      ROUND(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END),2) as credits,
      ROUND(SUM(CASE WHEN type='debit' THEN amount ELSE 0 END),2) as debits
    FROM transactions GROUP BY month ORDER BY month DESC LIMIT 6`
  );
}

export async function getTotals(): Promise<{ totalCredits: number; totalDebits: number; balance: number }> {
  if (Platform.OS === "web") {
    const all = await asGetAll<Transaction>(AS_TX_KEY);
    let credits = 0, debits = 0;
    for (const tx of all) {
      if (tx.type === "credit") credits += tx.amount;
      else debits += tx.amount;
    }
    return { totalCredits: +credits.toFixed(2), totalDebits: +debits.toFixed(2), balance: +(credits - debits).toFixed(2) };
  }
  const db = await getNativeDb();
  const row = await db.getFirstAsync<{ credits: number; debits: number }>(
    `SELECT ROUND(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END),2) as credits,
            ROUND(SUM(CASE WHEN type='debit' THEN amount ELSE 0 END),2) as debits
     FROM transactions`
  );
  const c = row?.credits ?? 0, d = row?.debits ?? 0;
  return { totalCredits: c, totalDebits: d, balance: +(c - d).toFixed(2) };
}

export async function getInvestments(): Promise<Investment[]> {
  if (Platform.OS === "web") {
    return asGetAll<Investment>(AS_INV_KEY);
  }
  const db = await getNativeDb();
  return db.getAllAsync<Investment>("SELECT * FROM investments ORDER BY broker_name, ticker");
}

export async function insertInvestment(inv: Omit<Investment, "id" | "created_at">): Promise<void> {
  if (Platform.OS === "web") {
    const existing = await asGetAll<Investment>(AS_INV_KEY);
    await asSetAll(AS_INV_KEY, [...existing, { ...inv, id: genId(), created_at: Date.now() }]);
    return;
  }
  const db = await getNativeDb();
  await db.runAsync(
    `INSERT INTO investments (id, broker_name, source_type, ticker, shares, avg_price, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [genId(), inv.broker_name, inv.source_type, inv.ticker, inv.shares, inv.avg_price, inv.currency, Date.now()]
  );
}

export async function deleteInvestment(id: string): Promise<void> {
  if (Platform.OS === "web") {
    const existing = await asGetAll<Investment>(AS_INV_KEY);
    await asSetAll(AS_INV_KEY, existing.filter((i) => i.id !== id));
    return;
  }
  const db = await getNativeDb();
  await db.runAsync("DELETE FROM investments WHERE id = ?", [id]);
}

export async function deleteInvestmentsByBroker(brokerName: string): Promise<void> {
  if (Platform.OS === "web") {
    const existing = await asGetAll<Investment>(AS_INV_KEY);
    await asSetAll(AS_INV_KEY, existing.filter((i) => !(i.broker_name === brokerName && i.source_type === "Statement")));
    return;
  }
  const db = await getNativeDb();
  await db.runAsync("DELETE FROM investments WHERE broker_name = ? AND source_type = 'Statement'", [brokerName]);
}

export async function getSetting(key: string, fallback = ""): Promise<string> {
  if (Platform.OS === "web") {
    const raw = await AsyncStorage.getItem(`${AS_SETTINGS_KEY}_${key}`);
    return raw ?? fallback;
  }
  const db = await getNativeDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(`${AS_SETTINGS_KEY}_${key}`, value);
    return;
  }
  const db = await getNativeDb();
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
}
