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
  if (avgDays >= 5  && avgDays <= 10)  return { frequency: "weekly",    label: "Weekly",    multiplier: 52 / 12 };
  if (avgDays >= 24 && avgDays <= 38)  return { frequency: "monthly",   label: "Monthly",   multiplier: 1 };
  if (avgDays >= 82 && avgDays <= 98)  return { frequency: "quarterly", label: "Quarterly", multiplier: 1 / 3 };
  if (avgDays >= 340 && avgDays <= 390) return { frequency: "annual",   label: "Annual",    multiplier: 1 / 12 };
  return null;
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Group transactions by exact amount (rounded to 2dp).
 * Returns a map of amount-string → transactions.
 */
function groupByExactAmount(txs: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const key = tx.amount.toFixed(2);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }
  return groups;
}

export function detectSubscriptions(transactions: Transaction[]): DetectedSubscription[] {
  const debits = transactions.filter((t) => t.type === "debit");

  // Group by normalized merchant name
  const merchantGroups = new Map<string, { txs: Transaction[]; merchant: string }>();
  for (const tx of debits) {
    const key = normalizeMerchant(tx.merchant || tx.description);
    if (!merchantGroups.has(key)) merchantGroups.set(key, { txs: [], merchant: tx.merchant || tx.description });
    merchantGroups.get(key)!.txs.push(tx);
  }

  const results: DetectedSubscription[] = [];

  for (const [mKey, { txs }] of merchantGroups) {
    if (txs.length < 2) continue;

    // Within each merchant, further split by exact price
    const amountGroups = groupByExactAmount(txs);

    for (const [, group] of amountGroups) {
      if (group.length < 2) continue;

      // Sort by date
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));

      // RULE 1: Must span at least 2 different calendar months (YYYY-MM)
      const distinctMonths = new Set(sorted.map((t) => t.date.substring(0, 7)));
      if (distinctMonths.size < 2) continue;

      // Calculate intervals between consecutive charges
      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
      }
      const validIntervals = intervals.filter((d) => d > 0 && d < 400);
      if (validIntervals.length === 0) continue;

      const avgInterval = validIntervals.reduce((s, v) => s + v, 0) / validIntervals.length;
      const classified = classifyFrequency(avgInterval);
      if (!classified) continue;

      // RULE 2: For monthly subscriptions, day-of-month must be consistent (±5 days)
      if (classified.frequency === "monthly") {
        const dayNums = sorted.map((t) => new Date(t.date).getDate());
        const medDay = median(dayNums);
        // Wrap-around aware: day 1 and day 28 are close in some months
        const maxDev = Math.max(...dayNums.map((d) => {
          const diff = Math.abs(d - medDay);
          return Math.min(diff, 31 - diff); // handle month-end wrap
        }));
        if (maxDev > 5) continue;
      }

      // RULE 3: For weekly, interval variance must be tight (±2 days)
      if (classified.frequency === "weekly") {
        const devs = validIntervals.map((v) => Math.abs(v - avgInterval));
        if (Math.max(...devs) > 2) continue;
      }

      const amounts = sorted.map((t) => t.amount);
      const med = median(amounts);
      const lastDate = sorted[sorted.length - 1].date;
      const nextExpected = addDays(lastDate, avgInterval);
      const monthlyEquiv = +(med * classified.multiplier).toFixed(2);

      results.push({
        merchant: sorted[sorted.length - 1].merchant || sorted[sorted.length - 1].description,
        normalizedKey: `${mKey}_${med.toFixed(2)}`,
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
  }

  return results.sort((a, b) => b.monthlyEquiv - a.monthlyEquiv);
}
