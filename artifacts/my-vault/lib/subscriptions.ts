import type { Transaction } from "./database";

export type SubFrequency = "weekly" | "monthly" | "quarterly" | "annual";

export interface DetectedSubscription {
  merchant: string;
  normalizedKey: string;
  amount: number;
  amountRange: [number, number];
  frequency: SubFrequency;
  frequencyLabel: string;
  monthlyEquiv: number;
  lastDate: string;
  nextExpected: string;
  occurrences: number;
  category: string;
}

function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(ltd|limited|plc|inc|llc|gmbh|sa)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function daysBetween(d1: string, d2: string): number {
  return (new Date(d2).getTime() - new Date(d1).getTime()) / 86_400_000;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString().substring(0, 10);
}

function classifyFrequency(avgDays: number): { frequency: SubFrequency; label: string; multiplier: number } | null {
  if (avgDays >= 5 && avgDays <= 10) return { frequency: "weekly",    label: "Weekly",    multiplier: 52 / 12 };
  if (avgDays >= 24 && avgDays <= 38) return { frequency: "monthly",   label: "Monthly",   multiplier: 1 };
  if (avgDays >= 82 && avgDays <= 98) return { frequency: "quarterly", label: "Quarterly", multiplier: 1 / 3 };
  if (avgDays >= 340 && avgDays <= 390) return { frequency: "annual",   label: "Annual",    multiplier: 1 / 12 };
  return null;
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function detectSubscriptions(transactions: Transaction[]): DetectedSubscription[] {
  const debits = transactions.filter((t) => t.type === "debit");

  // Group by normalized merchant
  const groups = new Map<string, { txs: Transaction[]; merchant: string }>();
  for (const tx of debits) {
    const key = normalizeMerchant(tx.merchant || tx.description);
    if (!groups.has(key)) groups.set(key, { txs: [], merchant: tx.merchant || tx.description });
    groups.get(key)!.txs.push(tx);
  }

  const results: DetectedSubscription[] = [];

  for (const [key, { txs, merchant }] of groups) {
    if (txs.length < 2) continue;

    // Sort by date
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));

    // Calculate intervals between consecutive charges
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }

    // Filter out outliers > 400 days
    const validIntervals = intervals.filter((d) => d > 0 && d < 400);
    if (validIntervals.length === 0) continue;

    const avgInterval = validIntervals.reduce((s, v) => s + v, 0) / validIntervals.length;
    const classified = classifyFrequency(avgInterval);
    if (!classified) continue;

    // Check amount consistency: std-dev should be < 20% of median
    const amounts = sorted.map((t) => t.amount);
    const med = median(amounts);
    const stdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - med) ** 2, 0) / amounts.length);
    if (stdDev / med > 0.25) continue; // too inconsistent

    const lastDate = sorted[sorted.length - 1].date;
    const nextExpected = addDays(lastDate, avgInterval);
    const monthlyEquiv = +(med * classified.multiplier).toFixed(2);

    results.push({
      merchant: sorted[sorted.length - 1].merchant || sorted[sorted.length - 1].description,
      normalizedKey: key,
      amount: +med.toFixed(2),
      amountRange: [Math.min(...amounts), Math.max(...amounts)],
      frequency: classified.frequency,
      frequencyLabel: classified.label,
      monthlyEquiv,
      lastDate,
      nextExpected,
      occurrences: sorted.length,
      category: sorted[sorted.length - 1].category,
    });
  }

  return results.sort((a, b) => b.monthlyEquiv - a.monthlyEquiv);
}
