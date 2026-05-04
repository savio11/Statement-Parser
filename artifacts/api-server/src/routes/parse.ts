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

type ParserStrategy = "credit-card" | "running-balance" | "generic";

// ─── Shared utilities ──────────────────────────────────────────────────────────

function categorize(merchant: string): string {
  const m = merchant.toLowerCase();
  if (/mcdonalds|kfc|subway|pizza|burger|restaurant|cafe|starbucks|costa|tesco|asda|sainsbury|lidl|aldi|waitrose|morrisons|takeaway|sushi|indian|chinese|thai|hasty|lahori|mowgli|taj mahal|streate|botanic|nandos|tortilla|deliveroo|just eat|uber eats|pret|greggs|wasabi|caffe|coffee|donut|moes peri|haute dolci|kitchen pizzeria|ifly|b518_bar/.test(m)) return "Food & Dining";
  if (/uber|lyft|trainline|rail|tube|lul\s|tfl|arriva|bus|taxi|transport|parking|petrol|fuel|shell|railcard|ticket machine|thetrainline/.test(m)) return "Transport";
  if (/netflix|spotify|disney|sky\s|nowtv|twitch|youtube|hbo|apple tv|manchester united|mufc|ticketing|membership/.test(m)) return "Entertainment";
  if (/amazon|amznmktplace|ebay|asos|zara|h&m|primark|jd sports|sports direct|next|argos|currys|john lewis|ikea|shopping|fashion|viva\*flying|marks and spencer|boots the chemist|co-op|the cooperative/.test(m)) return "Shopping";
  if (/electricity|gas|water|sse|british gas|e\.on|edf|thames|severn|vodafone|o2|ee\s|three\s|talktalk|broadband|internet|trip\.com|trip_uk/.test(m)) return "Bills & Utilities";
  if (/rent|mortgage|letting|estate agent|benham|reeves/.test(m)) return "Housing";
  if (/gym|fitness|sport|running|yoga|pilates|swimming/.test(m)) return "Health & Fitness";
  if (/holiday|hotel|airbnb|booking|expedia|flight|easyjet|ryanair|british airways|hilton|marriott|aloft/.test(m)) return "Travel";
  if (/salary|payroll|wage|income|facebook|google|employer/.test(m)) return "Income";
  if (/payment received|transfer|revolut|monzo|paypal|cash app|wise|splitwise|refund|cashback/.test(m)) return "Transfers";
  return "Other";
}

/** Parse a date string into ISO YYYY-MM-DD, returns null if unrecognised. */
function parseDate(raw: string, fallbackYear?: number): string | null {
  const y = fallbackYear ?? new Date().getFullYear();
  let m: RegExpMatchArray | null;

  // DD Mon YYYY or DD Mon YY
  m = raw.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})/i);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  // DD/MM/YY or DD-MM-YY
  m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  // YYYY-MM-DD
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // Mon DD (no year — credit card style, use fallback year)
  m = raw.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i);
  if (m) return `${y}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;

  return null;
}

const ANY_AMOUNT_RE = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;
const STANDALONE_AMOUNT_RE = /^(\d{1,4}\.\d{2})$/;

// ─── Format detection ─────────────────────────────────────────────────────────
//
// Three structural signals, checked in priority order:
//
//  1. credit-card  — PDF text is extracted column-by-column; transaction rows
//     contain TWO dates (transaction date + process/post date) followed by a
//     merchant. Amounts appear as standalone lines AFTER all merchant rows on
//     each page. Characteristic of Amex, Barclaycard, MBNA, HSBC CC, etc.
//
//  2. running-balance — Each transaction row carries date, description and a
//     running account balance. Characteristic of HSBC current account,
//     Barclays, NatWest, Lloyds, Santander, Halifax, Monzo, Starling, etc.
//
//  3. generic — Unknown layout; fall back to opportunistic date+amount parsing.

function detectStrategy(text: string): ParserStrategy {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Signal 1: dual-date transaction rows (Mon D  Mon D  Merchant text)
  const dualDateRe = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\S/i;
  const dualDateCount = lines.filter((l) => dualDateRe.test(l)).length;
  if (dualDateCount >= 3) return "credit-card";

  // Signal 2: explicit balance markers
  if (/balance brought forward|balance carried forward|opening balance|closing balance/i.test(text)) {
    return "running-balance";
  }

  // Signal 3: multiple rows with a date-like start AND 2+ decimal amounts
  const multiAmtRows = lines.filter((l) => {
    const amts = [...l.matchAll(ANY_AMOUNT_RE)];
    return amts.length >= 2 && /^(\d{1,2}[\s\/\-]|\w{3}\s+\d{1,2}\s)/.test(l);
  }).length;
  if (multiAmtRows >= 3) return "running-balance";

  return "generic";
}

// ─── Strategy 1: Running-balance parser ───────────────────────────────────────
//
// Works for any bank statement where each transaction row includes a running
// account balance alongside the transaction amount. The parser identifies the
// balance column by looking for large, stable numbers; the amount is derived
// from the delta between consecutive balances.
//
// Date formats supported:  "15 Aug 22", "15 Aug 2022", "15/08/2024", "15-08-24"
// Bank-specific type codes: BP, VIS, DD, SO, ATM, CHQ, FT, TFR, BAC, etc.

function parseRunningBalance(text: string): ParsedTransaction[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: ParsedTransaction[] = [];

  const dateRe = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})|^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i;
  const typeCodeRe = /^(BP|VIS|CR|DR|DD|SO|ATM|CHQ|FT|TFR|BAC|FPS|BGC|OTH|CC|\)\)\))\s+/i;

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
          date: currentDate!,
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
    const typeMatch = raw.match(typeCodeRe);
    let typeHint: "credit" | "debit" | null = null;
    let rest = raw;
    if (typeMatch) {
      const code = typeMatch[1].toUpperCase();
      if (code === "CR" || code === "BGC" || code === "FPS" || code === "BAC") typeHint = "credit";
      else if (["DR", "BP", "DD", "SO", "VIS", "ATM", "CHQ", "FT", "TFR", ")))"].includes(code)) typeHint = "debit";
      rest = raw.substring(typeMatch[0].length);
    }
    const merchant = rest.replace(ANY_AMOUNT_RE, "").replace(/\b(CR|DR)\b/gi, "").replace(/\s{2,}/g, " ").trim();
    return { merchant, typeHint };
  }

  function parseDateLine(line: string): { date: string; rest: string } | null {
    // DD Mon YY(YY)
    let m = line.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})/i);
    if (m) {
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      return { date: `${year}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`, rest: line.substring(m[0].length).trim() };
    }
    // DD/MM/YYYY or DD/MM/YY
    m = line.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      return { date: `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, rest: line.substring(m[0].length).trim() };
    }
    return null;
  }

  // Generic header / boilerplate skip — avoids bank-specific strings
  const skipRe = /balance brought forward|balance carried forward|opening balance|closing balance|account name|account number|sort code|branch identifier|iban|bic\s|interest rate|fscs|financial services|paid out.*paid in|information about|your statement|sheet number|effective from|overdraft|aer\s|ear\s|contact tel|text phone/i;

  for (const line of lines) {
    if (/balance brought forward|opening balance/i.test(line)) {
      const amts = [...line.matchAll(ANY_AMOUNT_RE)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      if (amts.length > 0) lastBalance = amts[amts.length - 1];
      continue;
    }
    if (/balance carried forward|closing balance/i.test(line)) {
      const amts = [...line.matchAll(ANY_AMOUNT_RE)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      if (amts.length > 0) emitPending(amts[amts.length - 1]);
      continue;
    }
    if (skipRe.test(line)) continue;

    const amounts = [...line.matchAll(ANY_AMOUNT_RE)].map((m) => parseFloat(m[1].replace(/,/g, "")));
    const parsed = parseDateLine(line);

    if (parsed) {
      currentDate = parsed.date;
      const { merchant, typeHint } = extractMerchantAndType(parsed.rest);
      if (merchant && merchant.length > 1) {
        currentMerchant = merchant;
        currentTypeHint = typeHint;
      }
    } else {
      // Non-date line: may be a continuation sub-row with a new type code
      const typeMatch = line.match(typeCodeRe);
      if (typeMatch && amounts.length === 0) {
        const { merchant, typeHint } = extractMerchantAndType(line);
        if (merchant && merchant.length > 1 && merchant.length < 60) {
          currentMerchant = merchant;
          currentTypeHint = typeHint;
        }
        continue;
      }
    }

    if (amounts.length === 0) continue;

    if (amounts.length >= 2) {
      const balance = amounts[amounts.length - 1];
      const txAmt = amounts[amounts.length - 2];
      if (currentMerchant && currentDate) {
        pending.push({ merchant: currentMerchant, amount: txAmt, typeHint: currentTypeHint });
        currentMerchant = null;
        currentTypeHint = null;
      } else if (pending.length > 0 && txAmt > 0.005) {
        pending[pending.length - 1].amount = txAmt;
      }
      emitPending(balance);
    } else {
      const amt = amounts[0];
      if (isLikelyBalance(amt)) {
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

// ─── Strategy 2: Credit-card columns parser ───────────────────────────────────
//
// Many credit card PDFs (Amex, Barclaycard, MBNA, Capital One, etc.) are
// typeset with a left column (dates + merchant names) and a right column
// (amounts). The PDF text extractor reads these as separate text blocks per
// page, so merchant names and amounts come out in separate groups.
//
// Algorithm: per page-segment, collect merchant rows and standalone amounts
// separately, then zip them back together in order. Credits are detected by
// "CR" marker lines, "OTHER ACCOUNT TRANSACTIONS" headers, or merchant keywords.
//
// Date format: "Mon D  Mon D  Merchant" (transaction date + process/post date).
// Year is extracted from "Statement Period" or similar phrases; cross-year
// statements are handled by comparing transaction month to statement end month.

function parseCreditCardColumns(text: string): ParsedTransaction[] {
  const results: ParsedTransaction[] = [];

  // Year: look for 4-digit year near a period/statement date phrase
  const yearMatch = text.match(/(?:from|period|to|dated?)\s[^.]*?\b(\d{4})\b/i)
    ?? text.match(/\b(20\d{2})\b/);
  const stmtYear = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

  // End month for cross-year detection ("From X Month to Y Month YYYY")
  const endMonthMatch = text.match(/to\s+\d+\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)
    ?? text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^,\n]*\d{4}/i);
  const endMonthStr = endMonthMatch ? (endMonthMatch[1] ?? endMonthMatch[0].substring(0, 3)) : "Dec";
  const endMonthNum = parseInt(MONTHS[endMonthStr.toLowerCase().substring(0, 3)] ?? "12");

  // Dual-date transaction line: "Apr 8  Apr 8  MERCHANT" or "08 Apr  09 Apr  MERCHANT"
  const txLineRe = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(.+)/i;
  const txLineRe2 = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(.+)/i;

  // Noise: category labels inserted between transactions and amounts in PDF
  const noiseLabelRe = /^(GOODS|MERCHANDISE|THE COOPERATIVE|ONLINE|CONTACTLESS|DeliverooGoldBenefit|Other Account Holder Charges|Popeyes Louisiana Kitchen.*)$/i;

  // Generic boilerplate common to all credit card statements
  const boilerplateRe = /^(Page \d|Prepared for|Statement of Account|Account Summary|Credit Summary|Rates of Interest|For more information|How you can pay|Previous Closing|Next Cardmembership|If you do not|In these|To switch|Estimated Interest|Please send|Your next annual|You must pay|If you are unable|All transactions|Direct Debit|Debit Card|Internet Banking|CHAPS|International payment|Please Note|For enquiries|Membership Rewards|Conversion rate|Period \d|Card Type|Points|Total Points|Maximum \d|We won|We'll|You can update|You can manage|The information|Compound|Annual Rate|Simple|Monthly Rate|Goods And Services|Cash Advance|Balance Transfer|Customer Service|Statement includes|Minimum Repayment|Payment Due Date|Membership Number)/i;

  interface PageSeg {
    transactions: Array<{ month: string; day: string; merchant: string }>;
    amounts: number[];
    crBeforeCount: number;
    otherAcctStart: number;
  }

  const segs: PageSeg[] = [];
  let seg: PageSeg = { transactions: [], amounts: [], crBeforeCount: 0, otherAcctStart: -1 };
  let txStarted = false;

  const pushSeg = () => {
    if (seg.transactions.length > 0) segs.push(seg);
    seg = { transactions: [], amounts: [], crBeforeCount: 0, otherAcctStart: -1 };
    txStarted = false;
  };

  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(line)) { pushSeg(); continue; }
    if (boilerplateRe.test(line)) continue;
    if (noiseLabelRe.test(line)) continue;
    if (/^[\d,]+\.\d{2}$/.test(line) && line.includes(",")) continue; // large totals
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) continue;               // date-only lines
    if (/^\d{4,}$/.test(line)) continue;                             // integer-only (points)
    if (/^Total new spend|^Total of other|^Total amount/i.test(line)) continue;
    if (/^OTHER ACCOUNT TRANSACTIONS$/i.test(line)) {
      seg.otherAcctStart = seg.amounts.length;
      continue;
    }
    if (line === "CR") {
      if (!txStarted) seg.crBeforeCount++;
      continue;
    }

    // Try dual-date transaction line (Month-first or Day-first)
    let txMatch = line.match(txLineRe);
    let month = "", day = "", merchant = "";
    if (txMatch) {
      month = txMatch[1]; day = txMatch[2]; merchant = txMatch[3].trim();
    } else {
      txMatch = line.match(txLineRe2);
      if (txMatch) { day = txMatch[1]; month = txMatch[2]; merchant = txMatch[3].trim(); }
    }

    if (txMatch) {
      txStarted = true;
      seg.transactions.push({ month, day, merchant });
      continue;
    }

    // Standalone amount line
    const amtMatch = line.match(STANDALONE_AMOUNT_RE);
    if (amtMatch && txStarted) {
      seg.amounts.push(parseFloat(amtMatch[1]));
    }
  }
  pushSeg();

  for (const s of segs) {
    const count = Math.min(s.transactions.length, s.amounts.length);
    for (let i = 0; i < count; i++) {
      const { month, day, merchant } = s.transactions[i];
      const amount = s.amounts[i];
      const txMonthNum = parseInt(MONTHS[month.toLowerCase().substring(0, 3)] ?? "01");
      const year = txMonthNum - endMonthNum > 6 ? stmtYear - 1 : stmtYear;
      const date = `${year}-${MONTHS[month.toLowerCase().substring(0, 3)]}-${day.padStart(2, "0")}`;

      const isOtherAcctCredit = s.otherAcctStart >= 0 && i >= s.otherAcctStart;
      const isKeyword = /payment received|refund|cashback|gold benefit|credit note|reward/i.test(merchant);
      const isCRMark = i < s.crBeforeCount;
      const type: "credit" | "debit" = isKeyword || isOtherAcctCredit || isCRMark ? "credit" : "debit";

      results.push({
        date, description: merchant, merchant,
        amount: parseFloat(amount.toFixed(2)),
        type,
        category: categorize(merchant),
      });
    }
  }

  return results;
}

// ─── Strategy 3: Generic fallback parser ─────────────────────────────────────
//
// Opportunistically finds any line starting with a recognised date pattern
// and extracts amounts from it. Credit vs debit is inferred from:
//   • "CR" / "DR" keywords or suffixes
//   • leading "+" / "-" sign before the amount
//   • merchant keywords (salary, payment received, refund…)
//
// Works as a catch-all for unusual or unknown bank statement layouts.

function parseGeneric(text: string): ParsedTransaction[] {
  const results: ParsedTransaction[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const typeCodeRe = /^(BP|VIS|CR|DR|DD|SO|ATM|CHQ|FT|TFR|BAC|FPS|BGC|CC)\s+/i;
  let currentDate: string | null = null;
  const fallbackYear = (() => {
    const m = text.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1]) : new Date().getFullYear();
  })();

  for (const line of lines) {
    const date = parseDate(line, fallbackYear);
    if (date) {
      currentDate = date;
    }
    if (!currentDate) continue;

    const amounts = [...line.matchAll(ANY_AMOUNT_RE)].map((m) => parseFloat(m[1].replace(/,/g, "")));
    if (amounts.length === 0) continue;

    const hasCR = /\bCR\b/.test(line) || /(?:^|\s)\+\d/.test(line);
    const hasDR = /\bDR\b/.test(line) || /(?:^|\s)-\d/.test(line);
    const keywordCredit = /payment received|salary|income|refund|cashback|credit/i.test(line);
    const isCredit = hasCR || (!hasDR && keywordCredit);

    let rest = line;
    const dm = rest.match(/^(\d{1,2}[\s\/\-]|\w{3}\s+\d{1,2}\s)/);
    if (dm) rest = rest.substring(dm[0].length).trim();
    const merchant = rest
      .replace(ANY_AMOUNT_RE, "")
      .replace(typeCodeRe, "")
      .replace(/\b(CR|DR)\b/gi, "")
      .replace(/[+\-](?=\d)/, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!merchant || merchant.length < 2 || amounts[0] < 0.005) continue;

    results.push({
      date: currentDate,
      description: merchant,
      merchant,
      amount: parseFloat(amounts[0].toFixed(2)),
      type: isCredit ? "credit" : "debit",
      category: categorize(merchant),
    });
  }

  return results;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
//
// Handles any CSV with header row. Accepts many column-name variants:
// Barclays, NatWest, Lloyds, Santander, Starling, Monzo, Revolut export formats.

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
    const dateRaw = getCol(cols, "date", "transaction date", "value date", "completed date", "time");
    if (!dateRaw) continue;

    const date = parseDate(dateRaw.split(" ")[0]) ?? dateRaw;
    const desc = getCol(cols, "description", "transaction description", "details", "reference", "merchant", "payee", "notes", "name");
    const paidOut = parseFloat(getCol(cols, "paid out", "debit", "withdrawal", "amount out", "debit amount", "money out").replace(/[^0-9.]/g, "") || "0");
    const paidIn = parseFloat(getCol(cols, "paid in", "credit", "deposit", "amount in", "credit amount", "money in").replace(/[^0-9.]/g, "") || "0");

    let amount = 0;
    let type: "credit" | "debit" = "debit";

    if (paidIn > 0) { amount = paidIn; type = "credit"; }
    else if (paidOut > 0) { amount = paidOut; type = "debit"; }
    else {
      const amtStr = getCol(cols, "amount", "net amount", "transaction amount", "local amount");
      const amt = parseFloat(amtStr.replace(/[^0-9.\-]/g, "") || "0");
      if (amt > 0) { amount = amt; type = "credit"; }
      else if (amt < 0) { amount = Math.abs(amt); type = "debit"; }
      else continue;
    }

    const merchant = desc || "Unknown";
    results.push({ date, description: merchant, merchant, amount, type, category: categorize(merchant) });
  }
  return results;
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

function parseBankPDF(text: string): { transactions: ParsedTransaction[]; strategy: ParserStrategy } {
  const strategy = detectStrategy(text);
  let transactions: ParsedTransaction[];
  if (strategy === "credit-card") transactions = parseCreditCardColumns(text);
  else if (strategy === "running-balance") transactions = parseRunningBalance(text);
  else transactions = parseGeneric(text);
  return { transactions, strategy };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post("/parse-pdf", async (req: Request, res: Response) => {
  try {
    const body = req.body as { base64?: string; filename?: string };
    if (!body.base64) { res.status(400).json({ error: "base64 field required" }); return; }

    const buffer = Buffer.from(body.base64, "base64");
    // pdf-parse v2: class-based API — new PDFParse({ data }) + .getText()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse } = (globalThis as any).require("pdf-parse") as {
      PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string; total: number }> };
    };
    const parsed = await new PDFParse({ data: buffer }).getText();
    const { transactions, strategy } = parseBankPDF(parsed.text);
    res.json({ transactions, pageCount: parsed.total, strategy });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse error";
    req.log?.error({ err: e }, "PDF parse error");
    res.status(500).json({ error: msg });
  }
});

router.post("/parse-csv", async (req: Request, res: Response) => {
  try {
    const body = req.body as { text?: string };
    if (!body.text) { res.status(400).json({ error: "text field required" }); return; }
    const transactions = parseCSVText(body.text);
    res.json({ transactions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse error";
    res.status(500).json({ error: msg });
  }
});

export default router;
