const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "localhost"}`;

export const CURRENCIES = [
  "GBP", "USD", "EUR", "INR", "CHF", "JPY", "CAD", "AUD", "SGD", "HKD", "AED",
];

export const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", INR: "₹", CHF: "Fr",
  JPY: "¥", CAD: "C$", AUD: "A$", SGD: "S$", HKD: "HK$", AED: "د.إ",
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

export function formatCurrency(amount: number, currency: string, decimals = 2): string {
  const sym = getCurrencySymbol(currency);
  const formatted = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sym}${formatted}`;
}

export async function fetchExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  try {
    const res = await fetch(
      `${BASE}/api/stocks/fx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    if (!res.ok) return 1;
    const data = await res.json() as { rate?: number };
    return data?.rate ?? 1;
  } catch {
    return 1;
  }
}
