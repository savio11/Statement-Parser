import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { G, Line, Path, Svg, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "@/components/GlassCard";
import { useColors } from "@/hooks/useColors";
import {
  ASSET_TYPES,
  ASSET_TYPE_ICONS,
  getAssets,
  getInvestments,
  getSetting,
} from "@/lib/database";
import { fetchExchangeRate, getCurrencySymbol } from "@/lib/currency";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RATES: Record<string, number> = {
  Stocks: 10,
  "Real Estate": 6,
  "Fixed Deposit": 5,
  Gold: 7,
  Bonds: 4,
  "Savings Account": 4,
  Crypto: 20,
  Pension: 7,
  Other: 5,
};

const CLASS_ICONS: Record<string, string> = {
  Stocks: "trending-up",
  "Real Estate": "home",
  "Fixed Deposit": "shield",
  Gold: "star",
  Bonds: "file-text",
  "Savings Account": "credit-card",
  Crypto: "zap",
  Pension: "umbrella",
  Other: "box",
};

const CLASS_COLORS: Record<string, string> = {
  Stocks: "#00D4FF",
  "Real Estate": "#10B981",
  "Fixed Deposit": "#6366F1",
  Gold: "#F59E0B",
  Bonds: "#8B5CF6",
  "Savings Account": "#3B82F6",
  Crypto: "#EC4899",
  Pension: "#14B8A6",
  Other: "#94A3B8",
};

interface AssetClass {
  name: string;
  currentValue: number;
  rate: number;
}

const MILESTONE_YEARS = [1, 5, 10, 20, 30];

// ─── Growth projection chart ──────────────────────────────────────────────────

function GrowthChart({
  classes,
  years,
  homeSym,
}: {
  classes: AssetClass[];
  years: number;
  homeSym: string;
}) {
  const colors = useColors();
  const screenW = Dimensions.get("window").width;
  const chartW = screenW - 48;
  const chartH = 200;
  const padL = 56, padR = 16, padT = 16, padB = 30;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const totalAtYear = useCallback(
    (y: number) =>
      classes.reduce((s, c) => s + c.currentValue * Math.pow(1 + c.rate / 100, y), 0),
    [classes]
  );

  const totalNow = totalAtYear(0);
  const totalEnd = totalAtYear(years);

  if (totalNow === 0) {
    return (
      <View style={{ height: chartH, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
          Add assets in Portfolio to see projection
        </Text>
      </View>
    );
  }

  const stepCount = Math.min(years, 60);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= stepCount; i++) {
    const yr = (years * i) / stepCount;
    const val = totalAtYear(yr);
    pts.push({
      x: padL + (i / stepCount) * innerW,
      y: padT + innerH - ((val - 0) / (totalEnd - 0 || 1)) * innerH,
    });
  }

  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${pts[pts.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const fmtVal = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return v.toFixed(0);
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    val: totalEnd * t,
    y: padT + innerH - innerH * t,
  }));

  const xStep = Math.max(1, Math.ceil(years / 5));
  const xTicks: number[] = [];
  for (let y = 0; y <= years; y += xStep) xTicks.push(y);
  if (xTicks[xTicks.length - 1] !== years) xTicks.push(years);

  return (
    <Svg width={chartW} height={chartH}>
      {yTicks.map((tick, i) => (
        <G key={i}>
          <Line
            x1={padL} y1={tick.y} x2={chartW - padR} y2={tick.y}
            stroke="rgba(255,255,255,0.06)" strokeWidth={1}
          />
          <SvgText
            x={padL - 5} y={tick.y + 4}
            textAnchor="end" fill="rgba(240,244,255,0.4)"
            fontSize={9} fontFamily="Inter_400Regular"
          >
            {homeSym}{fmtVal(tick.val)}
          </SvgText>
        </G>
      ))}
      {xTicks.map((y) => (
        <SvgText
          key={y}
          x={padL + (y / years) * innerW}
          y={chartH - 6}
          textAnchor="middle"
          fill="rgba(240,244,255,0.4)"
          fontSize={9} fontFamily="Inter_400Regular"
        >
          {`Y${y}`}
        </SvgText>
      ))}
      <Path d={areaD} fill="rgba(0,212,255,0.07)" />
      <Path d={pathD} stroke="#00D4FF" strokeWidth={2.5} fill="none" strokeLinejoin="round" />
      <SvgText
        x={Math.min(pts[pts.length - 1].x, chartW - padR)}
        y={Math.max(pts[pts.length - 1].y - 7, padT + 12)}
        textAnchor="end"
        fill="#00D4FF"
        fontSize={10} fontFamily="Inter_700Bold"
      >
        {homeSym}{fmtVal(totalEnd)}
      </SvgText>
    </Svg>
  );
}

// ─── Rate input row ───────────────────────────────────────────────────────────

function ClassRow({
  cls,
  homeSym,
  onChange,
}: {
  cls: AssetClass;
  homeSym: string;
  onChange: (rate: number) => void;
}) {
  const colors = useColors();
  const [inputVal, setInputVal] = useState(cls.rate.toString());
  const color = CLASS_COLORS[cls.name] ?? "#94A3B8";
  const icon = CLASS_ICONS[cls.name] ?? "box";

  const fmtValue = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return v.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  function commitRate(text: string) {
    const n = parseFloat(text);
    if (!isNaN(n)) {
      onChange(Math.max(-50, Math.min(100, n)));
      setInputVal(Math.max(-50, Math.min(100, n)).toString());
    } else {
      setInputVal(cls.rate.toString());
    }
  }

  return (
    <View style={styles.classRow}>
      <View style={[styles.classIconBadge, { backgroundColor: `${color}18` }]}>
        <Feather name={icon as any} size={16} color={color} />
      </View>
      <View style={styles.classMiddle}>
        <Text style={[styles.className, { color: colors.foreground }]}>{cls.name}</Text>
        <Text style={[styles.classValue, { color: colors.mutedForeground }]}>
          {homeSym} {fmtValue(cls.currentValue)}
        </Text>
      </View>
      <View style={[styles.rateInputWrap, { borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.04)" }]}>
        <TextInput
          style={[styles.rateInput, { color: color }]}
          value={inputVal}
          onChangeText={(t) => setInputVal(t.replace(/[^0-9.\-]/g, ""))}
          onBlur={() => commitRate(inputVal)}
          onSubmitEditing={() => { commitRate(inputVal); Keyboard.dismiss(); }}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          selectTextOnFocus
        />
        <Text style={[styles.rateSuffix, { color: colors.mutedForeground }]}>% / yr</Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GrowthLabScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [homeCurrency, setHomeCurrency] = useState("GBP");
  const [years, setYears] = useState(10);
  const [classes, setClasses] = useState<AssetClass[]>([]);

  const homeSym = getCurrencySymbol(homeCurrency);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [invs, assets, hc] = await Promise.all([
      getInvestments(),
      getAssets(),
      getSetting("home_currency", "GBP"),
    ]);
    setHomeCurrency(hc);

    // Collect all unique currencies
    const currencies = new Set<string>();
    for (const inv of invs) currencies.add(inv.currency);
    for (const ast of assets) currencies.add(ast.currency);

    // Fetch FX rates
    const rateMap: Record<string, number> = { [hc]: 1 };
    await Promise.all(
      [...currencies].filter((c) => c !== hc).map(async (c) => {
        try { rateMap[c] = await fetchExchangeRate(c, hc); } catch { rateMap[c] = 1; }
      })
    );

    // Aggregate stocks (cost basis × shares × FX)
    let stocksValue = 0;
    for (const inv of invs) {
      const rate = rateMap[inv.currency] ?? 1;
      stocksValue += inv.shares * inv.avg_price * rate;
    }

    // Aggregate other asset types
    const assetTotals: Record<string, number> = {};
    for (const ast of assets) {
      const rate = rateMap[ast.currency] ?? 1;
      assetTotals[ast.type] = (assetTotals[ast.type] ?? 0) + ast.value * rate;
    }

    // Build class list (only show classes with value > 0)
    const built: AssetClass[] = [];
    if (stocksValue > 0.005) {
      built.push({ name: "Stocks", currentValue: stocksValue, rate: DEFAULT_RATES.Stocks });
    }
    for (const type of ASSET_TYPES) {
      const val = assetTotals[type] ?? 0;
      if (val > 0.005) {
        built.push({ name: type, currentValue: val, rate: DEFAULT_RATES[type] ?? 5 });
      }
    }

    setClasses(built);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  function updateRate(name: string, rate: number) {
    setClasses((prev) => prev.map((c) => c.name === name ? { ...c, rate } : c));
  }

  const totalNow = useMemo(() => classes.reduce((s, c) => s + c.currentValue, 0), [classes]);
  const totalProjected = useMemo(
    () => classes.reduce((s, c) => s + c.currentValue * Math.pow(1 + c.rate / 100, years), 0),
    [classes, years]
  );
  const totalGain = totalProjected - totalNow;
  const isGain = totalGain >= 0;

  const fmtFull = (v: number) =>
    `${homeSym} ${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtCompact = (v: number) => {
    if (v >= 1_000_000) return `${homeSym}${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${homeSym}${(v / 1_000).toFixed(1)}k`;
    return fmtFull(v);
  };

  const milestones = useMemo(
    () =>
      MILESTONE_YEARS.filter((y) => y <= years + 1).map((y) => ({
        year: y,
        value: classes.reduce((s, c) => s + c.currentValue * Math.pow(1 + c.rate / 100, Math.min(y, years)), 0),
      })),
    [classes, years]
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 100,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.screenTitle, { color: colors.foreground }]}>Growth Lab</Text>
            <Text style={[styles.screenSub, { color: colors.mutedForeground }]}>
              Net worth projection by asset class
            </Text>
          </View>
          <TouchableOpacity onPress={loadData} style={styles.iconBtn} disabled={loading}>
            <Feather name="refresh-cw" size={16} color={loading ? colors.mutedForeground : colors.primary} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ marginTop: 60, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <>
            {/* Projected total card */}
            <GlassCard style={{ marginBottom: 12 }} padding={20}>
              <Text style={[styles.projLabel, { color: colors.mutedForeground }]}>
                Projected net worth in {years} year{years !== 1 ? "s" : ""}
              </Text>
              <Text style={[styles.projValue, { color: colors.primary }]}>
                {fmtFull(totalProjected)}
              </Text>
              {totalNow > 0 && (
                <Text style={[styles.projGain, { color: isGain ? colors.credit : colors.debit }]}>
                  {isGain ? "▲" : "▼"} {fmtCompact(Math.abs(totalGain))} ({isGain ? "+" : "-"}
                  {totalNow > 0 ? ((Math.abs(totalGain) / totalNow) * 100).toFixed(1) : "0"}%)
                  {" "}from today
                </Text>
              )}

              {/* Year selector */}
              <View style={[styles.yearRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.yearLabel, { color: colors.mutedForeground }]}>Time horizon</Text>
                <View style={styles.yearControl}>
                  <TouchableOpacity
                    onPress={() => setYears((y) => Math.max(1, y - 1))}
                    style={[styles.yearBtn, { borderColor: colors.border }]}
                  >
                    <Feather name="minus" size={14} color={colors.foreground} />
                  </TouchableOpacity>
                  <Text style={[styles.yearValue, { color: colors.foreground }]}>
                    {years} yr{years !== 1 ? "s" : ""}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setYears((y) => Math.min(50, y + 1))}
                    style={[styles.yearBtn, { borderColor: colors.border }]}
                  >
                    <Feather name="plus" size={14} color={colors.foreground} />
                  </TouchableOpacity>
                  {/* Quick presets */}
                  {[5, 10, 20, 30].map((y) => (
                    <TouchableOpacity
                      key={y}
                      onPress={() => setYears(y)}
                      style={[
                        styles.presetBtn,
                        { borderColor: years === y ? colors.primary : colors.border },
                        years === y && { backgroundColor: colors.primary },
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetText,
                          { color: years === y ? colors.background : colors.mutedForeground },
                        ]}
                      >
                        {y}y
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </GlassCard>

            {/* Chart */}
            <GlassCard style={{ marginBottom: 12 }} padding={16}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>
                Projection curve
              </Text>
              <GrowthChart classes={classes} years={years} homeSym={homeSym} />
            </GlassCard>

            {/* Asset class rates */}
            <GlassCard padding={0} style={{ marginBottom: 12 }}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Asset class rates</Text>
                <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>% per year</Text>
              </View>
              {classes.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Feather name="activity" size={28} color={colors.mutedForeground} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    Add assets or holdings in Portfolio to get started
                  </Text>
                </View>
              ) : (
                classes.map((cls, i) => (
                  <View key={cls.name}>
                    <ClassRow cls={cls} homeSym={homeSym} onChange={(r) => updateRate(cls.name, r)} />
                    {i < classes.length - 1 && (
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    )}
                  </View>
                ))
              )}
            </GlassCard>

            {/* Milestone table */}
            {milestones.length > 0 && (
              <GlassCard padding={16} style={{ marginBottom: 12 }}>
                <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 14 }]}>
                  Milestones
                </Text>
                <View style={styles.milestoneHeader}>
                  <Text style={[styles.milestoneHeadCell, { color: colors.mutedForeground, flex: 1 }]}>Year</Text>
                  <Text style={[styles.milestoneHeadCell, { color: colors.mutedForeground, flex: 2, textAlign: "right" }]}>Net worth</Text>
                  <Text style={[styles.milestoneHeadCell, { color: colors.mutedForeground, flex: 2, textAlign: "right" }]}>Gain</Text>
                </View>
                {/* Today */}
                <View style={styles.milestoneRow}>
                  <Text style={[styles.milestoneCell, { color: colors.mutedForeground, flex: 1 }]}>Today</Text>
                  <Text style={[styles.milestoneCell, { color: colors.foreground, flex: 2, textAlign: "right" }]}>
                    {fmtCompact(totalNow)}
                  </Text>
                  <Text style={[styles.milestoneCell, { color: colors.mutedForeground, flex: 2, textAlign: "right" }]}>—</Text>
                </View>
                {milestones.map((m) => {
                  const gain = m.value - totalNow;
                  const pct = totalNow > 0 ? ((gain / totalNow) * 100).toFixed(0) : "0";
                  return (
                    <View key={m.year} style={styles.milestoneRow}>
                      <Text style={[styles.milestoneCell, { color: colors.mutedForeground, flex: 1 }]}>
                        Yr {m.year}
                      </Text>
                      <Text style={[styles.milestoneCell, { color: colors.primary, flex: 2, textAlign: "right", fontFamily: "Inter_600SemiBold" }]}>
                        {fmtCompact(m.value)}
                      </Text>
                      <Text style={[styles.milestoneCell, { color: gain >= 0 ? colors.credit : colors.debit, flex: 2, textAlign: "right" }]}>
                        +{pct}%
                      </Text>
                    </View>
                  );
                })}
              </GlassCard>
            )}

            <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
              Projections use cost basis for stocks. Growth rates are estimates — not financial advice.
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
  },
  screenSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 3,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  projLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  projValue: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.8,
  },
  projGain: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  yearRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    flexWrap: "wrap",
    gap: 8,
  },
  yearLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  yearControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  yearBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  yearValue: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    minWidth: 48,
    textAlign: "center",
  },
  presetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  presetText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  emptyBox: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  divider: { height: 1, marginHorizontal: 16 },
  classRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  classIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  classMiddle: { flex: 1 },
  className: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  classValue: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  rateInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 88,
  },
  rateInput: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    minWidth: 36,
    textAlign: "right",
    paddingVertical: 0,
  },
  rateSuffix: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginLeft: 3,
  },
  milestoneHeader: {
    flexDirection: "row",
    marginBottom: 6,
  },
  milestoneHeadCell: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  milestoneRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderTopWidth: 0,
  },
  milestoneCell: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  disclaimer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 16,
  },
});
