import { Router, Request, Response } from "express";

const router = Router();

const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Accept": "application/json",
};

router.get("/stocks/price/:ticker", async (req: Request, res: Response) => {
  const { ticker } = req.params;
  if (!ticker || !/^[A-Za-z0-9.\-^=]+$/.test(ticker)) {
    res.status(400).json({ error: "Invalid ticker" });
    return;
  }

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
      { headers: YF_HEADERS }
    );
    if (!response.ok) {
      res.status(404).json({ error: "Ticker not found" });
      return;
    }
    const data = await response.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) {
      res.status(404).json({ error: "Price unavailable" });
      return;
    }
    res.json({
      ticker: meta.symbol,
      price: meta.regularMarketPrice,
      currency: meta.currency,
      exchange: meta.fullExchangeName,
      name: meta.shortName ?? meta.symbol,
    });
  } catch {
    res.status(502).json({ error: "Failed to fetch price" });
  }
});

router.get("/stocks/search", async (req: Request, res: Response) => {
  const q = (req.query.q as string) ?? "";
  if (!q || q.length < 1) {
    res.json({ results: [] });
    return;
  }

  try {
    const response = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=7&newsCount=0&enableFuzzyQuery=false`,
      { headers: YF_HEADERS }
    );
    if (!response.ok) {
      res.json({ results: [] });
      return;
    }
    const data = await response.json() as any;
    const quotes = (data?.quotes ?? []) as any[];
    const results = quotes
      .filter((q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF")
      .map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname ?? q.longname ?? q.symbol,
        exchange: q.exchDisp ?? q.exchange,
        type: q.quoteType,
      }));
    res.json({ results });
  } catch {
    res.json({ results: [] });
  }
});

export default router;
