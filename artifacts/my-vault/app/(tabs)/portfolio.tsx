import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { readFileAsBase64 } from "@/lib/fileReader";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  deleteInvestmentsByBroker,
  getInvestments,
  getSetting,
  insertInvestment,
  setSetting,
  updateInvestment,
  getAssets,
  insertAsset,
  updateAsset,
  deleteAsset,
  ASSET_TYPES,
  ASSET_TYPE_ICONS,
  type Investment,
  type Asset,
} from "@/lib/database";
import { CURRENCIES, fetchExchangeRate } from "@/lib/currency";
import { useColors } from "@/hooks/useColors";

interface HoldingWithPrice extends Investment {
  currentPrice: number | null;
  marketValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  valueInHomeCurrency: number | null;
}

interface StockResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

interface ParsedHolding {
  name: string;
  isin: string;
  quantity: number;
  price: number;
  currency: string;
  ticker: string;
  tickerResolved: boolean;
}

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "localhost"}`;

async function fetchPriceViaProxy(ticker: string): Promise<{ price: number; currency: string } | null> {
  try {
    const res = await fetch(`${BASE}/api/stocks/price/${encodeURIComponent(ticker)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { price: data.price, currency: data.currency ?? "USD" };
  } catch {
    return null;
  }
}

async function searchStocksViaProxy(query: string): Promise<StockResult[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`${BASE}/api/stocks/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}


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
  const [editingHolding, setEditingHolding] = useState<HoldingWithPrice | null>(null);
  const [editShares, setEditShares] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCurrency, setEditCurrency] = useState("USD");
  const [editSaving, setEditSaving] = useState(false);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Broker group expand/collapse
  const [expandedBrokers, setExpandedBrokers] = useState<Set<string>>(new Set());

  // Holdings import state
  const [showImportHoldings, setShowImportHoldings] = useState(false);
  const [importUploading, setImportUploading] = useState(false);
  const [importHoldings, setImportHoldings] = useState<ParsedHolding[]>([]);
  const [importPlatform, setImportPlatform] = useState("");
  const [importAsOf, setImportAsOf] = useState("");

  // Manual assets state
  const [assets, setAssets] = useState<Asset[]>([]);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [assetName, setAssetName] = useState("");
  const [assetType, setAssetType] = useState<string>(ASSET_TYPES[0]);
  const [assetValue, setAssetValue] = useState("");
  const [assetCurrency, setAssetCurrency] = useState("GBP");
  const [assetNotes, setAssetNotes] = useState("");
  const [assetSaving, setAssetSaving] = useState(false);

  // Form state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StockResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<StockResult | null>(null);
  const [shares, setShares] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [broker, setBroker] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [needsManualPrice, setNeedsManualPrice] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAndPrice = useCallback(async () => {
    setLoading(true);
    const [invs, manualAssets, savedCurrency] = await Promise.all([
      getInvestments(),
      getAssets(),
      getSetting("home_currency", "GBP"),
    ]);
    const hc = savedCurrency;
    setHomeCurrency(hc);
    setAssets(manualAssets);

    // Collect all currencies (stocks + assets)
    const assetCurrencies = manualAssets.map((a) => a.currency);

    if (invs.length === 0) {
      // Still need to convert asset values
      const uniqueAssetCurs = [...new Set(assetCurrencies)];
      const assetRates = await Promise.all(
        uniqueAssetCurs.map((c) => fetchExchangeRate(c, hc).then((r) => [c, r] as [string, number]))
      );
      const assetRateMap = Object.fromEntries(assetRates);
      const assetTotal = manualAssets.reduce((s, a) => s + a.value * (assetRateMap[a.currency] ?? 1), 0);

      setHoldings([]);
      setTotalValue(assetTotal);
      setTotalCost(0);
      setLoading(false);
      setSetting("portfolio_total_value", assetTotal.toFixed(2)).catch(() => {});
      setSetting("portfolio_total_currency", hc).catch(() => {});
      return;
    }

    const tickers = [...new Set(invs.map((i) => i.ticker))];

    // Fetch live prices first so we know what currencies Yahoo Finance uses
    const priceResults = await Promise.all(
      tickers.map((t) => fetchPriceViaProxy(t).then((r) => [t, r] as [string, { price: number; currency: string } | null]))
    );
    const priceMap = Object.fromEntries(priceResults);

    // Collect all currencies needed: stored (for cost basis) + live price (for MV) + assets
    const allCurrencies = [...new Set([
      ...invs.map((i) => i.currency),
      ...priceResults.map(([, r]) => r?.currency).filter((c): c is string => !!c),
      ...assetCurrencies,
    ])];

    const rateResults = await Promise.all(
      allCurrencies.map((c) => fetchExchangeRate(c, hc).then((r) => [c, r] as [string, number]))
    );
    const rateMap = Object.fromEntries(rateResults);

    let tv = 0, tc = 0;

    const enriched: HoldingWithPrice[] = invs.map((inv) => {
      const priceInfo = priceMap[inv.ticker] ?? null;
      const currentPrice = priceInfo?.price ?? null;
      const priceCurrency = priceInfo?.currency ?? inv.currency;
      const costRate = rateMap[inv.currency] ?? 1;
      const priceRate = rateMap[priceCurrency] ?? 1;
      const cost = inv.shares * inv.avg_price;
      tc += cost * costRate;
      if (currentPrice !== null) {
        const mv = inv.shares * currentPrice;
        const mvHome = mv * priceRate;
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

    // Add manual asset values
    const assetTotal = manualAssets.reduce((s, a) => s + a.value * (rateMap[a.currency] ?? 1), 0);
    const grandTotal = tv + assetTotal;

    setHoldings(enriched);
    setTotalValue(grandTotal);
    setTotalCost(tc);
    setLoading(false);
    setSetting("portfolio_total_value", grandTotal.toFixed(2)).catch(() => {});
    setSetting("portfolio_total_currency", hc).catch(() => {});
  }, []);

  useEffect(() => { loadAndPrice(); }, [loadAndPrice]);

  function handleSearchChange(text: string) {
    setSearchQuery(text);
    setSelectedCompany(null);
    setNeedsManualPrice(false);

    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const results = await searchStocksViaProxy(text);
      setSearchResults(results);
      setSearching(false);
    }, 350);
  }

  function selectCompany(result: StockResult) {
    setSelectedCompany(result);
    setSearchQuery(result.symbol);
    setSearchResults([]);
    // Guess currency from exchange
    const gbpExchanges = ["LSE", "LON", "London Stock Exchange"];
    const eurExchanges = ["XETRA", "FRA", "AMS", "PAR", "MIL", "BRU", "LIS"];
    if (gbpExchanges.some((e) => result.exchange.includes(e))) setCurrency("GBP");
    else if (eurExchanges.some((e) => result.exchange.includes(e))) setCurrency("EUR");
    else setCurrency("USD");
  }

  function resetForm() {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedCompany(null);
    setShares("");
    setCurrency("USD");
    setBroker("");
    setManualPrice("");
    setNeedsManualPrice(false);
  }

  async function addInvestment() {
    const ticker = searchQuery.toUpperCase().trim();
    const sharesNum = parseFloat(shares);

    if (!ticker) {
      Alert.alert("Missing ticker", "Search for a company or enter a ticker symbol.");
      return;
    }
    if (isNaN(sharesNum) || sharesNum <= 0) {
      Alert.alert("Invalid shares", "Please enter a valid number of shares.");
      return;
    }

    let avgPrice: number;

    if (needsManualPrice) {
      avgPrice = parseFloat(manualPrice);
      if (isNaN(avgPrice) || avgPrice <= 0) {
        Alert.alert("Invalid price", "Please enter a valid price.");
        return;
      }
    } else {
      setAdding(true);
      const priceInfo = await fetchPriceViaProxy(ticker);
      if (!priceInfo) {
        setAdding(false);
        setNeedsManualPrice(true);
        Alert.alert(
          "Price unavailable",
          `Could not fetch a live price for "${ticker}". Enter the current price manually to proceed.`
        );
        return;
      }
      avgPrice = priceInfo.price;
      if (priceInfo.currency && currency === "USD") {
        setCurrency(priceInfo.currency);
      }
    }

    setAdding(true);
    await insertInvestment({
      broker_name: broker.trim() || "Manual",
      source_type: "Manual",
      ticker,
      shares: sharesNum,
      avg_price: avgPrice,
      currency,
    });

    resetForm();
    setShowAdd(false);
    setAdding(false);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await loadAndPrice();
  }

  function openEdit(h: HoldingWithPrice) {
    setEditingHolding(h);
    setEditShares(h.shares.toString());
    setEditPrice(h.avg_price.toFixed(2));
    setEditCurrency(h.currency);
  }

  async function saveEdit() {
    if (!editingHolding) return;
    const sharesNum = parseFloat(editShares);
    const priceNum = parseFloat(editPrice);
    if (isNaN(sharesNum) || sharesNum <= 0) {
      Alert.alert("Invalid shares", "Please enter a valid number of shares.");
      return;
    }
    if (isNaN(priceNum) || priceNum <= 0) {
      Alert.alert("Invalid price", "Please enter a valid price.");
      return;
    }
    setEditSaving(true);
    await updateInvestment(editingHolding.id, sharesNum, priceNum, editCurrency);
    setEditSaving(false);
    setEditingHolding(null);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await loadAndPrice();
  }

  async function removeHolding(id: string) {
    await deleteInvestment(id);
    setEditingHolding(null);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await loadAndPrice();
  }

  function enterSelectMode(id: string) {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function cancelSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function deleteSelected() {
    for (const id of selectedIds) {
      await deleteInvestment(id);
    }
    cancelSelectMode();
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await loadAndPrice();
  }

  function toggleBroker(broker: string) {
    setExpandedBrokers((prev) => {
      const next = new Set(prev);
      if (next.has(broker)) next.delete(broker); else next.add(broker);
      return next;
    });
  }

  async function deleteBroker(brokerName: string, count: number) {
    Alert.alert(
      `Delete ${brokerName}?`,
      `This will permanently remove all ${count} holding${count !== 1 ? "s" : ""} from ${brokerName}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            await deleteInvestmentsByBroker(brokerName);
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await loadAndPrice();
          },
        },
      ]
    );
  }

  // Group holdings by broker for the collapsed/expanded view
  const brokerGroups = React.useMemo(() => {
    const byBroker: Record<string, HoldingWithPrice[]> = {};
    for (const h of holdings) {
      if (!byBroker[h.broker_name]) byBroker[h.broker_name] = [];
      byBroker[h.broker_name].push(h);
    }
    return Object.entries(byBroker).map(([broker, hs]) => {
      const totalValue = hs.reduce((s, h) => s + (h.valueInHomeCurrency ?? 0), 0);
      const priced = hs.filter((h) => h.currentPrice !== null);
      return { broker, holdings: hs, totalValue, pricedCount: priced.length };
    });
  }, [holdings]);

  async function changeHomeCurrency(c: string) {
    setHomeCurrency(c);
    await setSetting("home_currency", c);
    await loadAndPrice();
  }

  async function handleImportHoldings() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setImportUploading(true);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const base64 = await readFileAsBase64(asset.uri);
      const response = await fetch(`${BASE}/api/parse-holdings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64 }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Holdings parsing failed");
      }
      const data = await response.json() as { holdings: ParsedHolding[]; platform: string; asOf: string };
      if (!data.holdings?.length) {
        Alert.alert("No holdings found", "Could not detect any positions in this PDF. Make sure it's a holdings statement.");
        return;
      }
      setImportHoldings(data.holdings);
      setImportPlatform(data.platform ?? "Broker");
      setImportAsOf(data.asOf ?? "");
      setShowImportHoldings(true);
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setImportUploading(false);
    }
  }

  async function confirmImportHoldings() {
    const platform = importPlatform || "Broker";
    await deleteInvestmentsByBroker(platform);
    let imported = 0;
    for (const h of importHoldings) {
      const ticker = h.tickerResolved ? h.ticker : h.name.split(" ").slice(0, 2).join("_").toUpperCase();
      await insertInvestment({
        broker_name: platform,
        source_type: "Statement",
        ticker,
        shares: h.quantity,
        avg_price: h.price,
        currency: h.currency,
      });
      imported++;
    }
    setShowImportHoldings(false);
    setImportHoldings([]);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await loadAndPrice();
    Alert.alert(
      "Holdings imported",
      `${imported} position${imported !== 1 ? "s" : ""} from ${platform} saved.${
        importHoldings.filter((h) => !h.tickerResolved).length > 0
          ? `\n\n${importHoldings.filter((h) => !h.tickerResolved).length} couldn't be auto-matched — tap ✏️ to fix their tickers.`
          : ""
      }`
    );
  }

  function openAddAsset() {
    setEditingAsset(null);
    setAssetName("");
    setAssetType(ASSET_TYPES[0]);
    setAssetValue("");
    setAssetCurrency("GBP");
    setAssetNotes("");
    setShowAddAsset(true);
  }

  function openEditAsset(a: Asset) {
    setEditingAsset(a);
    setAssetName(a.name);
    setAssetType(a.type);
    setAssetValue(a.value.toString());
    setAssetCurrency(a.currency);
    setAssetNotes(a.notes ?? "");
    setShowAddAsset(true);
  }

  async function saveAsset() {
    const val = parseFloat(assetValue);
    if (!assetName.trim()) {
      Alert.alert("Missing name", "Please enter a name for this asset.");
      return;
    }
    if (isNaN(val) || val <= 0) {
      Alert.alert("Invalid value", "Please enter a valid asset value.");
      return;
    }
    setAssetSaving(true);
    if (editingAsset) {
      await updateAsset(editingAsset.id, { name: assetName.trim(), type: assetType, value: val, currency: assetCurrency, notes: assetNotes });
    } else {
      await insertAsset({ name: assetName.trim(), type: assetType, value: val, currency: assetCurrency, notes: assetNotes });
    }
    setAssetSaving(false);
    setShowAddAsset(false);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await loadAndPrice();
  }

  async function removeAsset(id: string) {
    Alert.alert("Delete Asset", "Remove this asset from your portfolio?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          await deleteAsset(id);
          setShowAddAsset(false);
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await loadAndPrice();
        },
      },
    ]);
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
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        {selectMode ? (
          <View style={[styles.header, styles.selectBar]}>
            <TouchableOpacity onPress={cancelSelectMode} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              {selectedIds.size} selected
            </Text>
            <TouchableOpacity
              onPress={deleteSelected}
              disabled={selectedIds.size === 0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: selectedIds.size > 0 ? "#EF4444" : colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
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
                onPress={handleImportHoldings}
                style={styles.iconBtn}
                disabled={importUploading}
              >
                {importUploading
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Feather name="download" size={16} color={colors.primary} />}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openAddAsset}
                style={[styles.addBtn, { backgroundColor: "rgba(0,212,255,0.15)", borderWidth: 1, borderColor: colors.primary }]}
              >
                <Feather name="home" size={14} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { resetForm(); setShowAdd(true); }}
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="plus" size={16} color={colors.background} />
              </TouchableOpacity>
            </View>
          </View>
        )}

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
                  {"  "}({isPnlPositive ? "+" : "-"}{homeCurrency}{" "}
                  {Math.abs(totalPnl).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                </Text>
              )}
            </>
          )}
          <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />
          <Text style={[styles.currencyLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>Display in</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {CURRENCIES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => changeHomeCurrency(c)}
                style={[
                  styles.currencyChip,
                  { borderColor: homeCurrency === c ? colors.primary : colors.border },
                  homeCurrency === c && { backgroundColor: colors.primary },
                ]}
              >
                <Text style={[styles.currencyChipText, { color: homeCurrency === c ? colors.background : colors.mutedForeground }]}>
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </GlassCard>

        {/* Holdings list — grouped by broker */}
        {holdings.length === 0 ? (
          <GlassCard padding={0} style={{ marginBottom: 12 }}>
            <View style={styles.emptyBox}>
              <Feather name="trending-up" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Tap + to add a holding. Search by company name or ticker.
              </Text>
            </View>
          </GlassCard>
        ) : (
          brokerGroups.map(({ broker, holdings: bhs, totalValue: bv }) => {
            const expanded = expandedBrokers.has(broker);
            return (
              <GlassCard key={broker} padding={0} style={{ marginBottom: 10 }}>
                {/* Broker header */}
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => toggleBroker(broker)}
                  onLongPress={() => deleteBroker(broker, bhs.length)}
                  delayLongPress={500}
                  style={styles.brokerHeader}
                >
                  <View style={[styles.brokerIconBadge, { backgroundColor: "rgba(0,212,255,0.10)" }]}>
                    <Feather name="briefcase" size={16} color={colors.primary} />
                  </View>
                  <View style={styles.brokerMiddle}>
                    <Text style={[styles.brokerName, { color: colors.foreground }]}>{broker}</Text>
                    <Text style={[styles.brokerMeta, { color: colors.mutedForeground }]}>
                      {bhs.length} holding{bhs.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <View style={styles.brokerRight}>
                    <Text style={[styles.brokerValue, { color: colors.primary }]}>
                      {homeCurrency} {bv.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <Feather
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.mutedForeground}
                    style={{ marginLeft: 6 }}
                  />
                </TouchableOpacity>

                {/* Individual holdings (shown when expanded) */}
                {expanded && bhs.map((h, i) => {
                  const isUp = (h.pnl ?? 0) >= 0;
                  const isSelected = selectedIds.has(h.id);
                  return (
                    <View key={h.id}>
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onLongPress={() => enterSelectMode(h.id)}
                        onPress={() => selectMode ? toggleSelect(h.id) : openEdit(h)}
                        style={[
                          styles.holdingRow,
                          isSelected && { backgroundColor: "rgba(0,212,255,0.07)" },
                        ]}
                      >
                        {selectMode && (
                          <View style={[
                            styles.checkbox,
                            { borderColor: isSelected ? colors.primary : colors.border },
                            isSelected && { backgroundColor: colors.primary },
                          ]}>
                            {isSelected && <Feather name="check" size={11} color={colors.background} />}
                          </View>
                        )}
                        <View style={[styles.tickerBadge, { backgroundColor: "rgba(0,212,255,0.10)" }]}>
                          <Text style={[styles.tickerText, { color: colors.primary }]}>{h.ticker}</Text>
                        </View>
                        <View style={styles.holdingMiddle}>
                          <Text style={[styles.holdingBroker, { color: colors.foreground }]}>{h.ticker}</Text>
                          <Text style={[styles.holdingMeta, { color: colors.mutedForeground }]}>
                            {h.shares} sh · {h.currency}
                            {h.currentPrice !== null ? ` · @${h.currentPrice.toFixed(2)}` : ""}
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
                        {!selectMode && (
                          <View style={styles.editBtn}>
                            <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </GlassCard>
            );
          })
        )}

        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Tap broker to expand · Long press to delete all holdings
        </Text>

        {/* Other Assets section */}
        <View style={styles.assetSectionHeader}>
          <Text style={[styles.assetSectionTitle, { color: colors.foreground }]}>Other Assets</Text>
          <TouchableOpacity onPress={openAddAsset} style={[styles.assetAddBtn, { borderColor: colors.primary }]}>
            <Feather name="plus" size={13} color={colors.primary} />
            <Text style={[styles.assetAddBtnText, { color: colors.primary }]}>Add</Text>
          </TouchableOpacity>
        </View>
        <GlassCard padding={0} style={{ marginBottom: 20 }}>
          {assets.length === 0 ? (
            <TouchableOpacity style={styles.emptyBox} onPress={openAddAsset}>
              <Text style={{ fontSize: 28 }}>🏠</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Add property, gold, fixed deposits, bonds and more
              </Text>
            </TouchableOpacity>
          ) : (
            assets.map((a, i) => (
              <View key={a.id}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => openEditAsset(a)}
                  style={styles.assetRow}
                >
                  <View style={[styles.assetIconBadge, { backgroundColor: "rgba(0,212,255,0.08)" }]}>
                    <Text style={{ fontSize: 20 }}>{ASSET_TYPE_ICONS[a.type] ?? "💼"}</Text>
                  </View>
                  <View style={styles.assetMiddle}>
                    <Text style={[styles.assetName, { color: colors.foreground }]} numberOfLines={1}>{a.name}</Text>
                    <Text style={[styles.assetMeta, { color: colors.mutedForeground }]}>{a.type}</Text>
                  </View>
                  <View style={styles.assetRight}>
                    <Text style={[styles.assetValue, { color: colors.foreground }]}>
                      {a.currency} {a.value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                  <View style={styles.editBtn}>
                    <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                  </View>
                </TouchableOpacity>
                {i < assets.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
              </View>
            ))
          )}
        </GlassCard>
      </ScrollView>

      {/* ── Edit holding modal ── */}
      <Modal visible={!!editingHolding} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}>
        <View style={[styles.modal, { backgroundColor: "#0D1121" }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            Edit {editingHolding?.ticker}
          </Text>
          <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
            {editingHolding?.broker_name} · {editingHolding?.currency}
            {editingHolding?.currentPrice != null ? ` · Live @${editingHolding.currentPrice.toFixed(2)}` : ""}
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Number of Shares</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
              placeholder="e.g. 10.5"
              placeholderTextColor={colors.mutedForeground}
              value={editShares}
              onChangeText={setEditShares}
              keyboardType="decimal-pad"
              autoFocus
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Cost Price per Share</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
              placeholder="e.g. 150.00"
              placeholderTextColor={colors.mutedForeground}
              value={editPrice}
              onChangeText={setEditPrice}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Stock Currency</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 2 }}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setEditCurrency(c)}
                  style={[
                    styles.currencyChip,
                    { borderColor: editCurrency === c ? colors.primary : colors.border },
                    editCurrency === c && { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={[styles.currencyChipText, { color: editCurrency === c ? colors.background : colors.mutedForeground }]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={[styles.modalActions, { paddingBottom: insets.bottom + 20 }]}>
            <TouchableOpacity
              style={[styles.modalBtn, { borderWidth: 1, borderRadius: 12, borderColor: "#EF4444", flex: 1 }]}
              onPress={() => editingHolding && removeHolding(editingHolding.id)}
            >
              <Feather name="trash-2" size={14} color="#EF4444" />
              <Text style={{ color: "#EF4444", fontFamily: "Inter_500Medium", marginLeft: 4 }}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setEditingHolding(null)}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.confirmBtn, { backgroundColor: colors.primary, opacity: editSaving ? 0.7 : 1 }]}
              onPress={saveEdit}
              disabled={editSaving}
            >
              {editSaving ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <Text style={{ color: colors.background, fontFamily: "Inter_600SemiBold" }}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Holdings import modal ── */}
      <Modal visible={showImportHoldings} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}>
        <View style={[styles.modal, { backgroundColor: "#0D1121" }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            Import {importHoldings.length} Holdings
          </Text>
          <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
            {importPlatform}{importAsOf ? ` · as of ${importAsOf}` : ""}
            {"  "}·{"  "}
            <Text style={{ color: "#10B981" }}>
              {importHoldings.filter((h) => h.tickerResolved).length} auto-matched
            </Text>
            {"  "}
            {importHoldings.filter((h) => !h.tickerResolved).length > 0 && (
              <Text style={{ color: "#F59E0B" }}>
                · {importHoldings.filter((h) => !h.tickerResolved).length} unresolved
              </Text>
            )}
          </Text>
          <FlatList
            data={importHoldings}
            keyExtractor={(_, i) => i.toString()}
            style={{ flex: 1 }}
            renderItem={({ item, index }) => (
              <View>
                <View style={styles.importRow}>
                  <View style={styles.importLeft}>
                    <Text style={[styles.importName, { color: colors.foreground }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.importMeta, { color: colors.mutedForeground }]}>
                      {item.quantity} sh · {item.currency} {item.price.toFixed(item.price < 1 ? 4 : 2)}
                    </Text>
                  </View>
                  <View style={styles.importRight}>
                    <View style={[
                      styles.importTickerBadge,
                      { backgroundColor: item.tickerResolved ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)" }
                    ]}>
                      <Text style={[
                        styles.importTickerText,
                        { color: item.tickerResolved ? "#10B981" : "#F59E0B" }
                      ]}>
                        {item.tickerResolved ? item.ticker : "Unresolved"}
                      </Text>
                    </View>
                  </View>
                </View>
                {index < importHoldings.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                )}
              </View>
            )}
          />
          <View style={[styles.modalActions, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => { setShowImportHoldings(false); setImportHoldings([]); }}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.confirmBtn, { backgroundColor: colors.primary }]}
              onPress={confirmImportHoldings}
            >
              <Text style={{ color: "#080B14", fontFamily: "Inter_600SemiBold" }}>Import All</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Add / Edit Asset modal ── */}
      <Modal visible={showAddAsset} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}>
        <View style={[styles.modal, { backgroundColor: "#0D1121" }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            {editingAsset ? "Edit Asset" : "Add Asset"}
          </Text>
          <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
            Property, savings, gold, fixed deposits and more
          </Text>

          {/* Asset type picker */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Asset Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {ASSET_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setAssetType(t)}
                  style={[
                    styles.assetTypeChip,
                    { borderColor: assetType === t ? colors.primary : colors.border },
                    assetType === t && { backgroundColor: "rgba(0,212,255,0.12)" },
                  ]}
                >
                  <Text style={{ fontSize: 15 }}>{ASSET_TYPE_ICONS[t] ?? "💼"}</Text>
                  <Text style={[styles.assetTypeChipText, { color: assetType === t ? colors.primary : colors.mutedForeground }]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Asset name */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Name</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
              placeholder="e.g. My London Flat"
              placeholderTextColor={colors.mutedForeground}
              value={assetName}
              onChangeText={setAssetName}
              autoCapitalize="words"
            />
          </View>

          {/* Value */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Current Value</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
              placeholder="e.g. 250000"
              placeholderTextColor={colors.mutedForeground}
              value={assetValue}
              onChangeText={setAssetValue}
              keyboardType="decimal-pad"
            />
          </View>

          {/* Currency */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Currency</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setAssetCurrency(c)}
                  style={[
                    styles.currencyChip,
                    { borderColor: assetCurrency === c ? colors.primary : colors.border },
                    assetCurrency === c && { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={[styles.currencyChipText, { color: assetCurrency === c ? colors.background : colors.mutedForeground }]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Notes */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
              placeholder="e.g. Joint ownership, bank name…"
              placeholderTextColor={colors.mutedForeground}
              value={assetNotes}
              onChangeText={setAssetNotes}
            />
          </View>

          <View style={[styles.modalActions, { paddingBottom: insets.bottom + 20 }]}>
            {editingAsset && (
              <TouchableOpacity
                style={[styles.modalBtn, { borderWidth: 1, borderRadius: 12, borderColor: "#EF4444", flex: 0.5 }]}
                onPress={() => removeAsset(editingAsset.id)}
              >
                <Feather name="trash-2" size={14} color="#EF4444" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setShowAddAsset(false)}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.confirmBtn, { backgroundColor: colors.primary, opacity: assetSaving ? 0.7 : 1 }]}
              onPress={saveAsset}
              disabled={assetSaving}
            >
              {assetSaving ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <Text style={{ color: colors.background, fontFamily: "Inter_600SemiBold" }}>
                  {editingAsset ? "Save" : "Add Asset"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Add holding modal ── */}
      <Modal visible={showAdd} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}>
        <View style={[styles.modal, { backgroundColor: "#0D1121" }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Holding</Text>
          <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
            Search by company name or ticker symbol
          </Text>

          {/* Company search */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Company or Ticker</Text>
            <View style={styles.searchInputRow}>
              <TextInput
                style={[styles.input, styles.searchInput, { color: colors.foreground, borderColor: selectedCompany ? colors.primary : colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
                placeholder="e.g. Apple or AAPL"
                placeholderTextColor={colors.mutedForeground}
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searching && <ActivityIndicator color={colors.primary} style={styles.searchSpinner} size="small" />}
            </View>
            {selectedCompany && (
              <View style={[styles.selectedBadge, { backgroundColor: "rgba(0,212,255,0.10)", borderColor: colors.primary }]}>
                <Feather name="check-circle" size={13} color={colors.primary} />
                <Text style={[styles.selectedText, { color: colors.primary }]}>
                  {selectedCompany.name} · {selectedCompany.exchange}
                </Text>
              </View>
            )}
            {searchResults.length > 0 && (
              <View style={[styles.dropdown, { backgroundColor: "#141928", borderColor: colors.border }]}>
                {searchResults.map((r, idx) => (
                  <TouchableOpacity
                    key={r.symbol}
                    style={[styles.dropdownItem, idx < searchResults.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                    onPress={() => selectCompany(r)}
                  >
                    <Text style={[styles.dropdownTicker, { color: colors.primary }]}>{r.symbol}</Text>
                    <Text style={[styles.dropdownName, { color: colors.foreground }]} numberOfLines={1}>{r.name}</Text>
                    <Text style={[styles.dropdownExchange, { color: colors.mutedForeground }]}>{r.exchange}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Shares */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Number of Shares</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
              placeholder="e.g. 10.5"
              placeholderTextColor={colors.mutedForeground}
              value={shares}
              onChangeText={setShares}
              keyboardType="decimal-pad"
            />
          </View>

          {/* Manual price (only shown if live fetch failed) */}
          {needsManualPrice && (
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: "#F59E0B" }]}>Current Price (manual — live price unavailable)</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: "#F59E0B", backgroundColor: "rgba(245,158,11,0.05)" }]}
                placeholder="e.g. 178.50"
                placeholderTextColor={colors.mutedForeground}
                value={manualPrice}
                onChangeText={setManualPrice}
                keyboardType="decimal-pad"
              />
            </View>
          )}

          {/* Broker */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Broker / Account (optional)</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.05)" }]}
              placeholder="e.g. Freetrade"
              placeholderTextColor={colors.mutedForeground}
              value={broker}
              onChangeText={setBroker}
              autoCapitalize="words"
            />
          </View>

          {/* Currency */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Currency</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCurrency(c)}
                  style={[styles.currencyChip, currency === c && { backgroundColor: colors.primary }, { borderColor: colors.border }]}
                >
                  <Text style={[styles.currencyChipText, { color: currency === c ? colors.background : colors.mutedForeground }]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={[styles.modalActions, { paddingBottom: insets.bottom + 20 }]}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => { setShowAdd(false); resetForm(); }}
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
                <Text style={{ color: colors.background, fontFamily: "Inter_600SemiBold" }}>
                  {needsManualPrice ? "Add with manual price" : "Add"}
                </Text>
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
  editBtn: { padding: 8, marginLeft: 2 },
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
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
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
    marginTop: 60,
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
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
  },
  searchInput: {
    flex: 1,
  },
  searchSpinner: {
    position: "absolute",
    right: 12,
  },
  selectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  selectedText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  dropdown: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  dropdownTicker: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    minWidth: 52,
  },
  dropdownName: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  dropdownExchange: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flexShrink: 0,
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
  importRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  importLeft: { flex: 1 },
  importRight: { alignItems: "flex-end" },
  importName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  importMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  importTickerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  importTickerText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  selectBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  assetSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  assetSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  assetAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  assetAddBtnText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  assetIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  assetMiddle: { flex: 1 },
  assetName: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  assetMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  assetRight: { alignItems: "flex-end" },
  assetValue: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  assetTypeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  assetTypeChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  brokerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  brokerIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  brokerMiddle: { flex: 1 },
  brokerName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  brokerMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  brokerRight: { alignItems: "flex-end" },
  brokerValue: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
});
