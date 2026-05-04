import { Router, Request, Response } from "express";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

interface ParsedTransaction {
  date: string;
  description: string;
  merchant: string;
  amount: number;
  type: "credit" | "debit";
  category: string;
}

function categorize(merchant: string): string {
  const m = merchant.toLowerCase();
  if (/mcdonalds|kfc|subway|pizza|burger|restaurant|cafe|starbucks|costa|tesco|asda|sainsbury|lidl|aldi|waitrose|morrisons|takeaway|sushi|indian|chinese|thai|hasty|lahori|mowgli|taj mahal|streate|botanic/.test(m)) return "Food & Dining";
  if (/uber|lyft|trainline|rail|tube|lul\s|tfl|arriva|bus|taxi|transport|parking|petrol|fuel|shell|railcard|ticket machine/.test(m)) return "Transport";
  if (/netflix|spotify|disney|sky\s|nowtv|twitch|youtube|hbo|apple tv|manchester united|mufc|ticketing/.test(m)) return "Entertainment";
  if (/amazon|ebay|asos|zara|h&m|primark|jd sports|sports direct|next|argos|currys|john lewis|ikea|shopping|fashion/.test(m)) return "Shopping";
  if (/electricity|gas|water|sse|british gas|e\.on|edf|thames|severn|vodafone|o2|ee\s|three\s|talktalk|broadband|internet/.test(m)) return "Bills & Utilities";
  if (/rent|mortgage|letting|estate agent|benham|reeves/.test(m)) return "Housing";
  if (/gym|fitness|sport|running|yoga|pilates|swimming/.test(m)) return "Health & Fitness";
  if (/holiday|hotel|airbnb|booking|expedia|flight|easyjet|ryanair|british airways|hilton|marriott|aloft|trip_uk/.test(m)) return "Travel";
  if (/salary|payroll|wage|income|facebook|google|employer/.test(m)) return "Income";
  if (/transfer|payment|revolut|monzo|paypal|cash app|wise|splitwise/.test(m)) return "Transfers";
  return "Other";
}

// ─── HSBC-style PDF parser ────────────────────────────────────────────────────
// Handles multi-transaction date groups where several merchants share one final
// running balance. Uses two signals to identify a running balance:
//   1. Lines with 2+ amounts → last amount is the balance
//   2. Lines with 1 amount → balance if within 60% of the previous balance
//      (transaction amounts are much smaller than the running account balance)

function parsePDFText(text: string): ParsedTransaction[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: ParsedTransaction[] = [];

  const dateRe = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})/i;
  const amountRe = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;
  const typeRe = /^(BP|VIS|CR|DD|SO|ATM|CHQ|\)\)\)|CC)\s+/i;

  let lastBalance: number | null = null;
  let currentDate: string | null = null;
  let currentMerchant: string | null = null;
  let currentTypeHint: "credit" | "debit" | null = null;

  interface PendingTx { merchant: string; amount: number; typeHint: "credit" | "debit" | null }
  let pending: PendingTx[] = [];

  function isLikelyBalance(amt: number): boolean {
    if (lastBalance === null) return amt > 500;
    if (amt < 50) return false;
    const diff = Math.abs(amt - lastBalance);
    return diff < Math.max(lastBalance * 0.65, 8000);
  }

  function emitPending(newBalance: number) {
    if (pending.length > 0 && lastBalance !== null && currentDate) {
      const totalChange = newBalance - lastBalance;
      for (const p of pending) {
        if (p.amount < 0.005) continue;
        const type: "credit" | "debit" = p.typeHint ?? (totalChange >= 0 ? "credit" : "debit");
        results.push({
          date: currentDate,
          description: p.merchant,
          merchant: p.merchant,
          amount: parseFloat(p.amount.toFixed(2)),
          type,
          category: categorize(p.merchant),
        });
      }
    }
    lastBalance = newBalance;
    pending = [];
    currentMerchant = null;
    currentTypeHint = null;
  }

  function extractMerchantAndType(raw: string): { merchant: string; typeHint: "credit" | "debit" | null } {
    const m = raw.match(typeRe);
    let typeHint: "credit" | "debit" | null = null;
    let rest = raw;
    if (m) {
      const code = m[1].toUpperCase();
      if (code === "CR") typeHint = "credit";
      else if (["BP", "DD", "SO", "VIS", ")))"].includes(code)) typeHint = "debit";
      rest = raw.substring(m[0].length);
    }
    const merchant = rest.replace(amountRe, "").replace(/\s{2,}/g, " ").trim();
    return { merchant, typeHint };
  }

  for (const line of lines) {
    // ── Balance markers ─────────────────────────────────────────────────────
    if (/balance brought forward|opening balance/i.test(line)) {
      const amts = [...line.matchAll(amountRe)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      if (amts.length > 0) lastBalance = amts[amts.length - 1];
      continue;
    }
    if (/balance carried forward|closing balance/i.test(line)) {
      const amts = [...line.matchAll(amountRe)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      if (amts.length > 0) emitPending(amts[amts.length - 1]);
      continue;
    }
    // ── Skip headers / footers ───────────────────────────────────────────────
    if (/hsbc uk bank|contact tel|text phone|account name|your hsbc|your statement|sheet number|sortcode|paid out.*paid in|interest rate|information about|fscs|financial services|international bank|branch identifier|iban|bic\s|aer\s|ear\s|arranged overdraft|credit interest|unarranged|current account|business banking|effective from/i.test(line)) {
      continue;
    }

    const amounts = [...line.matchAll(amountRe)].map((m) => parseFloat(m[1].replace(/,/g, "")));
    const dateMatch = line.match(dateRe);

    // ── Date line ────────────────────────────────────────────────────────────
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const month = MONTHS[dateMatch[2].toLowerCase()];
      const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      currentDate = `${year}-${month}-${day}`;

      const rest = line.substring(dateMatch[0].length).trim();
      const { merchant, typeHint } = extractMerchantAndType(rest);
      if (merchant && merchant.length > 1) {
        currentMerchant = merchant;
        currentTypeHint = typeHint;
      }
    } else {
      // Non-date line: look for sub-transaction type codes (new merchant in same date group)
      const typeMatch = line.match(typeRe);
      if (typeMatch && amounts.length === 0) {
        // New sub-transaction marker with no amounts → update current merchant
        const { merchant, typeHint } = extractMerchantAndType(line);
        if (merchant && merchant.length > 1 && merchant.length < 50) {
          currentMerchant = merchant;
          currentTypeHint = typeHint;
        }
        continue;
      }
    }

    if (amounts.length === 0) continue;

    // ── Lines with 2+ amounts: last = balance, rest = tx amount(s) ───────────
    if (amounts.length >= 2) {
      const balance = amounts[amounts.length - 1];
      const txAmt = amounts[amounts.length - 2]; // take the one immediately before balance

      if (currentMerchant && currentDate) {
        pending.push({ merchant: currentMerchant, amount: txAmt, typeHint: currentTypeHint });
        currentMerchant = null;
        currentTypeHint = null;
      } else if (pending.length > 0 && txAmt > 0.005) {
        pending[pending.length - 1].amount = txAmt;
      }
      emitPending(balance);

    // ── Single amount: heuristic to detect balance vs tx amount ──────────────
    } else {
      const amt = amounts[0];
      if (isLikelyBalance(amt)) {
        // It's a balance — first push any dangling merchant
        if (currentMerchant && currentDate && lastBalance !== null) {
          const impliedAmt = Math.abs(amt - lastBalance - pending.reduce((s, p) => s + (p.typeHint === "credit" ? p.amount : -p.amount), 0));
          if (impliedAmt > 0.005 && impliedAmt < 50000) {
            pending.push({ merchant: currentMerchant, amount: impliedAmt, typeHint: currentTypeHint });
          }
          currentMerchant = null;
          currentTypeHint = null;
        }
        emitPending(amt);
      } else {
        // It's a transaction amount — store it for the current merchant
        if (currentMerchant && currentDate) {
          pending.push({ merchant: currentMerchant, amount: amt, typeHint: currentTypeHint });
          currentMerchant = null;
          currentTypeHint = null;
        } else if (pending.length > 0) {
          pending[pending.length - 1].amount = amt;
        }
      }
    }
  }

  return results;
}

function parseCSVText(text: string): ParsedTransaction[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));

  function getCol(cols: string[], ...names: string[]): string {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return cols[i]?.trim().replace(/"/g, "") ?? "";
    }
    return "";
  }

  const results: ParsedTransaction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const dateRaw = getCol(cols, "date", "transaction date", "value date");
    if (!dateRaw) continue;

    let date = dateRaw;
    const dmyMatch = dateRaw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (dmyMatch) {
      const d = dmyMatch[1];
      const m = dmyMatch[2];
      const y = dmyMatch[3];
      const year = y.length === 2 ? `20${y}` : y;
      date = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    const desc = getCol(cols, "description", "transaction description", "details", "reference", "merchant", "payee");
    const paidOut = parseFloat(getCol(cols, "paid out", "debit", "withdrawal", "amount out", "debit amount").replace(/,/g, "") || "0");
    const paidIn = parseFloat(getCol(cols, "paid in", "credit", "deposit", "amount in", "credit amount").replace(/,/g, "") || "0");

    let amount = 0;
    let type: "credit" | "debit" = "debit";

    if (paidIn > 0) { amount = paidIn; type = "credit"; }
    else if (paidOut > 0) { amount = paidOut; type = "debit"; }
    else {
      const amtStr = getCol(cols, "amount", "net amount", "transaction amount");
      const amt = parseFloat(amtStr.replace(/,/g, "") || "0");
      if (amt > 0) { amount = amt; type = "credit"; }
      else if (amt < 0) { amount = Math.abs(amt); type = "debit"; }
      else continue;
    }

    const merchant = desc || "Unknown";
    results.push({ date, description: merchant, merchant, amount, type, category: categorize(merchant) });
  }
  return results;
}

router.post("/parse-pdf", async (req: Request, res: Response) => {
  try {
    const body = req.body as { base64?: string; filename?: string };
    if (!body.base64) {
      res.status(400).json({ error: "base64 field required" });
      return;
    }

    const buffer = Buffer.from(body.base64, "base64");
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    const transactions = parsePDFText(parsed.text);
    res.json({ transactions, pageCount: parsed.numpages });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse error";
    req.log?.error({ err: e }, "PDF parse error");
    res.status(500).json({ error: msg });
  }
});

router.post("/parse-csv", async (req: Request, res: Response) => {
  try {
    const body = req.body as { text?: string };
    if (!body.text) {
      res.status(400).json({ error: "text field required" });
      return;
    }
    const transactions = parseCSVText(body.text);
    res.json({ transactions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse error";
    res.status(500).json({ error: msg });
  }
});

export default router;
