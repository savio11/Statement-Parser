import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "@/components/GlassCard";
import {
  deleteInvestment,
  getInvestments,
  getSetting,
  insertInvestment,
  setSetting,
  type Investment,
} from "@/lib/database";
import { useColors } from "@/hooks/useColors";

interface HoldingWithPrice extends Investment {
  currentPrice: number | null;
  marketValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  valueInHomeCurrency: number | null;
}

async function fetchPrice(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    return meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

async function fetchExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    if (!res.ok) return 1;
    const data = await res.json();
    return data?.rates?.[to] ?? 1;
  } catch {
    return 1;
  }
}

const CURRENCIES = ["USD", "GBP", "EUR", "CHF", "JPY", "CAD", "AUD"];

export default function PortfolioScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [homeCurrency, setHomeCurrency] = useState("GBP");
  const [totalValue, setTotalValue] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [showAdd, setShowAdd] = useState(false);

  const [form, setForm] = useState({
    ticker: "",
    shares: "",
    currency: "USD",
    broker_name: "",
  });

  const loadAndPrice = useCallback(async () => {
    setLoading(true);
    const [invs, savedCurrency] = await Promise.all([
      getInvestments(),
      getSetting("home_currency", "GBP"),
    ]);
    const hc = savedCurrency;
    setHomeCurrency(hc);

    if (invs.length === 0) {
      setHoldings([]);
      setTotalValue(0);
      setTotalCost(0);
      setLoading(false);
      return;
    }

    const tickers = [...new Set(invs.map((i) => i.ticker))];
    const currencies = [...new Set(invs.map((i) => i.currency))];

    const [prices, rates] = await Promise.all([
      Promise.all(tickers.map((t) => fetchPrice(t).then((p) => [t, p] as [string, number | null]))),
      Promise.all(currencies.map((c) => fetchExchangeRate(c, hc).then((r) => [c, r] as [string, number]))),
    ]);

    const priceMap = Object.fromEntries(prices);
    const rateMap = Object.fromEntries(rates);

    let tv = 0, tc = 0;

    const enriched: HoldingWithPrice[] = invs.map((inv) => {
      const currentPrice = priceMap[inv.ticker] ?? null;
      const rate = rateMap[inv.currency] ?? 1;
      const cost = inv.shares * inv.avg_price;
      tc += cost * rate;
      if (currentPrice !== null) {
        const mv = inv.shares * currentPrice;
        const mvHome = mv * rate;
        tv += mvHome;
        return {
          ...inv,
          currentPrice,
          marketValue: mv,
          pnl: mv - cost,
          pnlPct: cost > 0 ? ((mv - cost) / cost) * 100 : 0,
          valueInHomeCurrency: mvHome,
        };
      }
      return { ...inv, currentPrice: null, marketValue: null, pnl: null, pnlPct: null, valueInHomeCurrency: null };
    });

    setHoldings(enriched);
    setTotalValue(tv);
    setTotalCost(tc);
    setLoading(false);
  }, []);

  useEffect(() => { loadAndPrice(); }, [loadAndPrice]);

  async function addInvestment() {
    const ticker = form.ticker.toUpperCase().trim();
    const shares = parseFloat(form.shares);
    const broker = form.broker_name.trim() || "Manual";

    if (!ticker || isNaN(shares) || shares <= 0) {
      Alert.alert("Invalid input", "Please enter a ticker symbol and number of shares.");
      return;
    }

    setAdding(true);
    let livePrice: number | null = null;
    try {
      livePrice = await fetchPrice(ticker);
    } catch {
      livePrice = null;
    }

    if (livePrice === null) {
      Alert.alert(
        "Price not found",
        `Could not fetch a live price for "${ticker}". Check the ticker symbol and try again.`,
        [{ text: "OK" }]
      );
      setAdding(false);
      return;
    }

    await insertInvestment({
      broker_name: broker,
      source_type: "Manual",
      ticker,
      shares,
      avg_price: livePrice,
      currency: form.currency,
    });

    setForm({ ticker: "", shares: "", currency: "USD", broker_name: "" });
    setShowAdd(false);
    setAdding(false);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await loadAndPrice();
  }

  async function removeHolding(id: string) {
    Alert.alert("Remove holding", "Delete this investment?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteInvestment(id);
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await loadAndPrice();
        },
      },
    ]);
  }

  async function changeHomeCurrency(currency: string) {
    setHomeCurrency(currency);
    await setSetting("home_currency", currency);
    await loadAndPrice();
  }

  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const isPnlPositive = totalPnl >= 0;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = Platform.OS === "web" ? 34 : 90;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.screenTitle, { color: colors.foreground }]}>Portfolio</Text>
            <Text style={[styles.screenSub, { color: colors.mutedForeground }]}>
              {holdings.length} holding{holdings.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={loadAndPrice} style={styles.iconBtn} disabled={loading}>
              <Feather name="refresh-cw" size={16} color={loading ? colors.mutedForeground : colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowAdd(true)}
              style={[styles.addBtn, { backgroundColor: colors.primary }]}
            >
              <Feather name="plus" size={16} color={colors.background} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Total portfolio value */}
        <GlassCard style={styles.netWorthCard} padding={20}>
          <Text style={[styles.nwLabel, { color: colors.mutedForeground }]}>Total Portfolio Value</Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : (
            <>
              <Text style={[styles.nwValue, { color: colors.primary }]}>
                {homeCurrency}{" "}
                {totalValue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
              {totalCost > 0 && (
                <Text style={[styles.nwPnl, { color: isPnlPositive ? colors.credit : colors.debit }]}>
                  {isPnlPositive ? "▲" : "▼"} {Math.abs(totalPnlPct).toFixed(2)}%
                  {"  "}({isPnlPositive ? "+" : ""}
                  {homeCurrency} {Math.abs(totalPnl).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                </Text>
              )}
            </>
          )}
        </GlassCard>

        {/* Home currency picker */}
        <View style={styles.currencyRow}>
          <Text style={[styles.currencyLabel, { color: colors.mutedForeground }]}>Home:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {CURRENCIES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => changeHomeCurrency(c)}
                style={[
                  styles.currencyChip,
                  homeCurrency === c && { backgroundColor: colors.primary },
                  { borderColor: colors.border },
                ]}
              >
                <Text style={[styles.currencyChipText, { color: homeCurrency === c ? colors.background : colors.mutedForeground }]}>
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Holdings list */}
        <GlassCard padding={0} style={{ marginBottom: 12 }}>
          {holdings.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="trending-up" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Tap + to add a holding. The current price is used as your cost basis.
              </Text>
            </View>
          ) : (
            holdings.map((h, i) => {
              const isUp = (h.pnl ?? 0) >= 0;
              return (
                <View key={h.id}>
                  <TouchableOpacity
                    style={styles.holdingRow}
                    onLongPress={() => removeHolding(h.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.tickerBadge, { backgroundColor: "rgba(0,212,255,0.10)" }]}>
                      <Text style={[styles.tickerText, { color: colors.primary }]}>{h.ticker}</Text>
                    </View>
                    <View style={styles.holdingMiddle}>
                      <Text style={[styles.holdingBroker, { color: colors.foreground }]}>{h.broker_name}</Text>
                      <Text style={[styles.holdingMeta, { color: colors.mutedForeground }]}>
                        {h.shares} shares · {h.currency}
                      </Text>
                    </View>
                    <View style={styles.holdingRight}>
                      {h.currentPrice !== null ? (
                        <>
                          <Text style={[styles.holdingValue, { color: colors.foreground }]}>
                            {homeCurrency}{" "}
                            {(h.valueInHomeCurrency ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Text>
                          <Text style={[styles.holdingPnl, { color: isUp ? colors.credit : colors.debit }]}>
                            {isUp ? "+" : ""}{(h.pnlPct ?? 0).toFixed(2)}%
                          </Text>
                        </>
                      ) : (
                        <Text style={[styles.holdingMeta, { color: colors.mutedForeground }]}>No price</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                  {i < holdings.length - 1 && (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  )}
                </View>
              );
            })
          )}
        </GlassCard>

        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Long-press a holding to remove · Prices via Yahoo Finance
        </Text>
      </ScrollView>

      {/* Add holding modal */}
      <Modal visible={showAdd} animationType="slide" transparent presentationStyle="pageSheet">
        <View style={[styles.modal, { backgroundColor: "#0D1121" }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Holding</Text>
          <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
            Today's live price will be used as your cost basis
          </Text>

          {[
            { label: "Ticker Symbol", key: "ticker", placeholder: "e.g. AAPL", autoCapitalize: "characters" as const, keyboard: "default" as const },
            { label: "Shares", key: "shares", placeholder: "e.g. 10.5", autoCapitalize: "none" as const, keyboard: "decimal-pad" as const },
            { label: "Broker / Account (optional)", key: "broker_name", placeholder: "e.g. Freetrade", autoCapitalize: "words" as const, keyboard: "default" as const },
          ].map(({ label, key, placeholder, autoCapitalize, keyboard }) => (
            <View key={key} style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
                placeholder={placeholder}
                placeholderTextColor={colors.mutedForeground}
                value={(form as Record<string, string>)[key]}
                onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                autoCapitalize={autoCapitalize}
                keyboardType={keyboard}
              />
            </View>
          ))}

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Currency</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setForm((f) => ({ ...f, currency: c }))}
                  style={[
                    styles.currencyChip,
                    form.currency === c && { backgroundColor: colors.primary },
                    { borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.currencyChipText, { color: form.currency === c ? colors.background : colors.mutedForeground }]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={[styles.modalActions, { paddingBottom: insets.bottom + 20 }]}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => { setShowAdd(false); setForm({ ticker: "", shares: "", currency: "USD", broker_name: "" }); }}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.confirmBtn, { backgroundColor: colors.primary, opacity: adding ? 0.7 : 1 }]}
              onPress={addInvestment}
              disabled={adding}
            >
              {adding ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <Text style={{ color: colors.background, fontFamily: "Inter_600SemiBold" }}>Add</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  screenSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  iconBtn: { padding: 8 },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  netWorthCard: { marginBottom: 12 },
  nwLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  nwValue: {
    fontSize: 30,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  nwPnl: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginTop: 6,
  },
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  currencyLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flexShrink: 0,
  },
  currencyChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  currencyChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  holdingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  tickerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 52,
    alignItems: "center",
  },
  tickerText: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  holdingMiddle: { flex: 1 },
  holdingBroker: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  holdingMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  holdingRight: { alignItems: "flex-end" },
  holdingValue: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  holdingPnl: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  emptyBox: {
    padding: 40,
    alignItems: "center",
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 8,
  },
  modal: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: 100,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 20,
  },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 16,
    marginTop: "auto",
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtn: { borderWidth: 1 },
  confirmBtn: {},
});
