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
  if (/mcdonalds|kfc|subway|pizza|burger|restaurant|cafe|starbucks|costa|tesco|asda|sainsbury|lidl|aldi|waitrose|morrisons|takeaway|sushi|indian|chinese|thai|hasty|lahori|mowgli|taj mahal|streate/.test(m)) return "Food & Dining";
  if (/uber|lyft|trainline|rail|tube|lul|tfl|arriva|bus|taxi|transport|parking|petrol|fuel|shell|railcard|ticket machine/.test(m)) return "Transport";
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

function parsePDFText(text: string): ParsedTransaction[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: ParsedTransaction[] = [];

  const dateRe = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})/i;
  const amountRe = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;

  let lastBalance: number | null = null;
  let pendingDate: string | null = null;
  let pendingMerchant: string | null = null;

  for (const line of lines) {
    if (/balance brought forward|balance carried forward|opening balance|closing balance|payments in|payments out|interest rate|information about|hsbc uk bank/i.test(line)) {
      const bfAmts = [...line.matchAll(amountRe)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      if (bfAmts.length > 0 && /balance brought forward/i.test(line)) {
        lastBalance = bfAmts[bfAmts.length - 1];
      }
      continue;
    }

    const dateMatch = line.match(dateRe);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const month = MONTHS[dateMatch[2].toLowerCase()];
      const yearRaw = dateMatch[3];
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      pendingDate = `${year}-${month}-${day}`;

      const rest = line.substring(dateMatch[0].length).trim();
      const cleaned = rest
        .replace(/^(BP|VIS|CR|DD|SO|ATM|CHQ|\)\)\)|CC)\s+/i, "")
        .replace(/\s{2,}.*/g, "")
        .trim();
      pendingMerchant = cleaned || "Transaction";
    }

    const amounts = [...line.matchAll(amountRe)].map((m) => parseFloat(m[1].replace(/,/g, "")));

    if (amounts.length > 0 && pendingDate && pendingMerchant) {
      const balance = amounts[amounts.length - 1];

      if (lastBalance !== null) {
        const diff = balance - lastBalance;
        const absAmt = Math.abs(diff);

        if (absAmt > 0.005 && absAmt < 100000) {
          const merchant = pendingMerchant;
          results.push({
            date: pendingDate,
            description: merchant,
            merchant,
            amount: parseFloat(absAmt.toFixed(2)),
            type: diff > 0 ? "credit" : "debit",
            category: categorize(merchant),
          });
        }
      }

      lastBalance = balance;
      pendingDate = null;
      pendingMerchant = null;
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
