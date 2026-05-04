import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { G, Rect, Text as SvgText, Line, Svg } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "@/components/GlassCard";
import { TransactionItem } from "@/components/TransactionItem";
import { DonutChart, CategoryLegend, CATEGORY_COLORS } from "@/components/DonutChart";
import { CATEGORY_ICONS, ALL_CATEGORIES } from "@/components/TransactionItem";
import { BudgetBar } from "@/components/BudgetBar";
import { SubscriptionRow } from "@/components/SubscriptionCard";
import {
  getBudgets,
  setBudget,
  deleteBudget,
  getCategoryBreakdown,
  getMonthlyCashflow,
  getSetting,
  getThisMonthCategorySpend,
  getTransactions,
  getTotals,
  type CategoryTotal,
  type MonthlyCashflow,
  type Transaction,
} from "@/lib/database";
import { detectSubscriptions, type DetectedSubscription } from "@/lib/subscriptions";
import { useColors } from "@/hooks/useColors";

const MONTH_SHORT: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

// ─── Cashflow chart ───────────────────────────────────────────────────────────

function CashflowChart({ data }: { data: MonthlyCashflow[] }) {
  const colors = useColors();
  const screenW = Dimensions.get("window").width;
  const chartW = screenW - 48;
  const chartH = 160;
  const padL = 44, padR = 12, padT = 12, padB = 28;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const reversed = [...data].reverse();
  const maxVal = Math.max(...reversed.flatMap((d) => [d.credits, d.debits]), 1);

  if (reversed.length === 0) {
    return (
      <View style={{ height: chartH, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>No data yet</Text>
      </View>
    );
  }

  const groupW = innerW / reversed.length;
  const barW = Math.min(groupW * 0.35, 18);
  const gap = 3;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ val: maxVal * t, y: padT + innerH - innerH * t }));

  return (
    <Svg width={chartW} height={chartH}>
      {yTicks.map((tick, i) => (
        <G key={i}>
          <Line x1={padL} y1={tick.y} x2={chartW - padR} y2={tick.y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          <SvgText x={padL - 6} y={tick.y + 4} textAnchor="end" fill="rgba(240,244,255,0.35)" fontSize={9} fontFamily="Inter_400Regular">
            {tick.val >= 1000 ? `${(tick.val / 1000).toFixed(0)}k` : tick.val.toFixed(0)}
          </SvgText>
        </G>
      ))}
      {reversed.map((item, i) => {
        const x = padL + i * groupW + (groupW - barW * 2 - gap) / 2;
        const creditH = Math.max((item.credits / maxVal) * innerH, 2);
        const debitH = Math.max((item.debits / maxVal) * innerH, 2);
        const label = MONTH_SHORT[item.month.substring(5)] ?? item.month.substring(5);
        return (
          <G key={i}>
            <Rect x={x} y={padT + innerH - creditH} width={barW} height={creditH} fill="#10B981" rx={4} />
            <Rect x={x + barW + gap} y={padT + innerH - debitH} width={barW} height={debitH} fill="#EF4444" rx={4} />
            <SvgText x={x + barW} y={chartH - 6} textAnchor="middle" fill="rgba(240,244,255,0.45)" fontSize={9} fontFamily="Inter_400Regular">
              {label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Manage budgets modal ─────────────────────────────────────────────────────

interface ManageBudgetsModalProps {
  visible: boolean;
  onClose: () => void;
  budgets: Record<string, number>;
  monthSpend: Record<string, number>;
  onSave: (updated: Record<string, number>) => Promise<void>;
}

function ManageBudgetsModal({ visible, onClose, budgets, monthSpend, onSave }: ManageBudgetsModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      const init: Record<string, string> = {};
      for (const cat of ALL_CATEGORIES) {
        init[cat] = budgets[cat] != null ? budgets[cat].toFixed(0) : "";
      }
      setDraft(init);
    }
  }, [visible, budgets]);

  async function handleSave() {
    setSaving(true);
    Keyboard.dismiss();
    const updated: Record<string, number> = {};
    for (const cat of ALL_CATEGORIES) {
      const val = parseFloat(draft[cat] ?? "");
      if (!isNaN(val) && val > 0) updated[cat] = val;
    }
    await onSave(updated);
    setSaving(false);
    onClose();
  }

  const currentMonthName = new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}>
      <View style={[mStyles.modal, { backgroundColor: "#0D1121" }]}>
        <View style={mStyles.handle} />
        <View style={mStyles.titleRow}>
          <View>
            <Text style={[mStyles.title, { color: colors.foreground }]}>Monthly Budgets</Text>
            <Text style={[mStyles.sub, { color: colors.mutedForeground }]}>{currentMonthName}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={mStyles.closeBtn}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[mStyles.hint, { color: colors.mutedForeground }]}>
            Set a monthly limit per category. Leave blank to remove a budget.
          </Text>

          {ALL_CATEGORIES.map((cat) => {
            const color = CATEGORY_COLORS[cat] ?? "#636E72";
            const spent = monthSpend[cat] ?? 0;
            const limitVal = parseFloat(draft[cat] ?? "");
            const hasLimit = !isNaN(limitVal) && limitVal > 0;
            const pct = hasLimit ? Math.min(spent / limitVal, 1) : null;

            return (
              <View key={cat} style={[mStyles.catRow, { borderColor: "rgba(255,255,255,0.08)" }]}>
                <View style={[mStyles.catDot, { backgroundColor: color }]} />
                <Text style={mStyles.catIcon}>{CATEGORY_ICONS[cat] ?? "•"}</Text>
                <View style={mStyles.catMiddle}>
                  <Text style={[mStyles.catName, { color: colors.foreground }]}>{cat}</Text>
                  {spent > 0 && (
                    <Text style={[mStyles.catSpent, { color: colors.mutedForeground }]}>
                      £{spent.toLocaleString("en-GB", { minimumFractionDigits: 0 })} spent this month
                    </Text>
                  )}
                  {pct !== null && (
                    <View style={[mStyles.miniTrack, { backgroundColor: "rgba(255,255,255,0.07)", marginTop: 4 }]}>
                      <View
                        style={[
                          mStyles.miniFill,
                          {
                            width: `${Math.round(pct * 100)}%` as any,
                            backgroundColor: pct >= 1 ? "#EF4444" : pct >= 0.75 ? "#F59E0B" : "#10B981",
                          },
                        ]}
                      />
                    </View>
                  )}
                </View>
                <View style={[mStyles.inputWrap, { borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.05)" }]}>
                  <Text style={[mStyles.pound, { color: colors.mutedForeground }]}>£</Text>
                  <TextInput
                    style={[mStyles.input, { color: colors.foreground }]}
                    value={draft[cat] ?? ""}
                    onChangeText={(v) => setDraft((d) => ({ ...d, [cat]: v.replace(/[^0-9]/g, "") }))}
                    keyboardType="number-pad"
                    placeholder="—"
                    placeholderTextColor={colors.mutedForeground}
                    maxLength={6}
                  />
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={[mStyles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={[mStyles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={[mStyles.saveTxt, { color: colors.background }]}>
              {saving ? "Saving…" : "Save Budgets"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const mStyles = StyleSheet.create({
  modal: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: 60,
    paddingTop: 12,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center", marginBottom: 16,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  title: {
    fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  sub: {
    fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2,
  },
  closeBtn: { padding: 4 },
  hint: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    marginBottom: 16, marginTop: 4, lineHeight: 18,
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  catIcon: { fontSize: 16, width: 22, textAlign: "center" },
  catMiddle: { flex: 1 },
  catName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  catSpent: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  miniTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  miniFill: { height: 4, borderRadius: 2 },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6,
    minWidth: 72,
  },
  pound: { fontSize: 13, fontFamily: "Inter_500Medium", marginRight: 2 },
  input: { fontSize: 14, fontFamily: "Inter_600SemiBold", minWidth: 40, textAlign: "right" },
  footer: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  saveBtn: {
    paddingVertical: 15, borderRadius: 12,
    alignItems: "center",
  },
  saveTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [cashflow, setCashflow] = useState<MonthlyCashflow[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState({ totalCredits: 0, totalDebits: 0, balance: 0 });
  const [breakdown, setBreakdown] = useState<CategoryTotal[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [monthSpend, setMonthSpend] = useState<Record<string, number>>({});
  const [budgetModalVisible, setBudgetModalVisible] = useState(false);
  const [subscriptions, setSubscriptions] = useState<DetectedSubscription[]>([]);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [cfYear, setCfYear] = useState<string>("all");
  const [cfQuarter, setCfQuarter] = useState<string>("all");

  const load = useCallback(async () => {
    const [cf, allTx, tot, bk, bg, ms, pv] = await Promise.all([
      getMonthlyCashflow(),
      getTransactions(500),
      getTotals(),
      getCategoryBreakdown(),
      getBudgets(),
      getThisMonthCategorySpend(),
      getSetting("portfolio_total_value", "0"),
    ]);
    setCashflow(cf);
    setRecent(allTx.slice(0, 10));
    setTotals(tot);
    setBreakdown(bk);
    setBudgets(bg);
    setMonthSpend(ms);
    setSubscriptions(detectSubscriptions(allTx));
    setPortfolioValue(parseFloat(pv) || 0);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function handleSaveBudgets(updated: Record<string, number>) {
    const old = budgets;
    // delete removed budgets
    for (const cat of ALL_CATEGORIES) {
      if (old[cat] != null && updated[cat] == null) await deleteBudget(cat);
    }
    // upsert new/changed budgets
    for (const [cat, limit] of Object.entries(updated)) {
      await setBudget(cat, limit);
    }
    await load();
  }

  const formatAmount = (n: number) =>
    n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = Platform.OS === "web" ? 34 : 90;

  const budgetedCategories = ALL_CATEGORIES.filter((c) => budgets[c] != null);
  const overBudgetCount = budgetedCategories.filter((c) => (monthSpend[c] ?? 0) > budgets[c]).length;

  const currentMonth = new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });

  const totalMonthlySubCost = subscriptions.reduce((s, sub) => s + sub.monthlyEquiv, 0);

  const cfYears = useMemo(() => {
    const years = [...new Set(cashflow.map((d) => d.month.substring(0, 4)))].sort((a, b) => b.localeCompare(a));
    return years;
  }, [cashflow]);

  const QUARTER_MONTHS: Record<string, string[]> = {
    Q1: ["01", "02", "03"],
    Q2: ["04", "05", "06"],
    Q3: ["07", "08", "09"],
    Q4: ["10", "11", "12"],
  };

  const filteredCashflow = useMemo(() => {
    let data = cashflow;
    if (cfYear !== "all") data = data.filter((d) => d.month.startsWith(cfYear));
    if (cfQuarter !== "all") {
      const months = QUARTER_MONTHS[cfQuarter] ?? [];
      data = data.filter((d) => months.includes(d.month.substring(5)));
    }
    return data;
  }, [cashflow, cfYear, cfQuarter]);

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad, paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>My Vault</Text>
        <Text style={[styles.screenSub, { color: colors.mutedForeground }]}>Financial overview</Text>

        {/* Net Balance card — always visible, includes portfolio when available */}
        <GlassCard style={{ marginBottom: 10, padding: 16 }}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Net Balance</Text>
          <Text style={[styles.statValue, { color: colors.primary, fontSize: 26, marginBottom: portfolioValue > 0 ? 4 : 0 }]}>
            £{formatAmount(totals.balance + portfolioValue)}
          </Text>
          {portfolioValue > 0 && (
            <View style={{ flexDirection: "row", gap: 14, marginTop: 2 }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
                {"Bank "}
                <Text style={{ color: colors.foreground }}>£{formatAmount(totals.balance)}</Text>
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
                {"Portfolio "}
                <Text style={{ color: colors.credit }}>£{formatAmount(portfolioValue)}</Text>
              </Text>
            </View>
          )}
        </GlassCard>

        <View style={styles.statRow}>
          <GlassCard style={styles.statCard}>
            <View style={styles.statHeaderRow}>
              <Feather name="arrow-down-circle" size={14} color={colors.credit} />
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Income</Text>
            </View>
            <Text style={[styles.statValue, { color: colors.credit }]}>£{formatAmount(totals.totalCredits)}</Text>
          </GlassCard>
          <GlassCard style={styles.statCard}>
            <View style={styles.statHeaderRow}>
              <Feather name="arrow-up-circle" size={14} color={colors.debit} />
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Spent</Text>
            </View>
            <Text style={[styles.statValue, { color: colors.debit }]}>£{formatAmount(totals.totalDebits)}</Text>
          </GlassCard>
        </View>

        {/* Cashflow chart */}
        <GlassCard style={styles.chartCard} padding={16}>
          <View style={styles.chartHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Monthly Cashflow</Text>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#10B981" }]} />
                <Text style={[styles.legendText, { color: colors.mutedForeground }]}>In</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#EF4444" }]} />
                <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Out</Text>
              </View>
            </View>
          </View>

          {cfYears.length > 0 && (
            <>
              {/* Year selector */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {(["all", ...cfYears] as string[]).map((y) => (
                  <TouchableOpacity
                    key={y}
                    onPress={() => { setCfYear(y); setCfQuarter("all"); }}
                    style={[
                      styles.cfChip,
                      { borderColor: cfYear === y ? colors.primary : colors.border },
                      cfYear === y && { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text style={[styles.cfChipText, { color: cfYear === y ? colors.background : colors.mutedForeground }]}>
                      {y === "all" ? "All" : y}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Quarter selector — only shown when a specific year is selected */}
              {cfYear !== "all" && (
                <View style={styles.cfQuarterRow}>
                  {(["all", "Q1", "Q2", "Q3", "Q4"] as string[]).map((q) => (
                    <TouchableOpacity
                      key={q}
                      onPress={() => setCfQuarter(q)}
                      style={[
                        styles.cfChip,
                        { borderColor: cfQuarter === q ? colors.primary : colors.border },
                        cfQuarter === q && { backgroundColor: colors.primary },
                      ]}
                    >
                      <Text style={[styles.cfChipText, { color: cfQuarter === q ? colors.background : colors.mutedForeground }]}>
                        {q === "all" ? "All" : q}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          <CashflowChart data={filteredCashflow} />
        </GlassCard>

        {/* Spending breakdown donut */}
        <GlassCard style={styles.chartCard} padding={16}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Spending Breakdown</Text>
          {breakdown.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No spending data yet</Text>
            </View>
          ) : (
            <View style={styles.breakdownRow}>
              <DonutChart data={breakdown} size={148} />
              <CategoryLegend data={breakdown} limit={6} />
            </View>
          )}
        </GlassCard>

        {/* Monthly budgets */}
        <GlassCard style={styles.chartCard} padding={16}>
          <View style={styles.chartHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Monthly Budgets</Text>
              {overBudgetCount > 0 && (
                <View style={styles.alertBadge}>
                  <Feather name="alert-circle" size={11} color="#EF4444" />
                  <Text style={styles.alertText}>{overBudgetCount} over limit</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[styles.manageBtn, { borderColor: colors.border }]}
              onPress={() => setBudgetModalVisible(true)}
            >
              <Feather name="sliders" size={13} color={colors.primary} />
              <Text style={[styles.manageTxt, { color: colors.primary }]}>Manage</Text>
            </TouchableOpacity>
          </View>

          {budgetedCategories.length === 0 ? (
            <TouchableOpacity style={styles.emptyBudgetBtn} onPress={() => setBudgetModalVisible(true)}>
              <Feather name="plus-circle" size={18} color={colors.primary} />
              <Text style={[styles.emptyBudgetText, { color: colors.primary }]}>
                Set up your first budget
              </Text>
            </TouchableOpacity>
          ) : (
            budgetedCategories.map((cat) => (
              <BudgetBar
                key={cat}
                category={cat}
                spent={monthSpend[cat] ?? 0}
                limit={budgets[cat]}
              />
            ))
          )}

          {budgetedCategories.length > 0 && (
            <Text style={[styles.monthNote, { color: colors.mutedForeground }]}>
              {currentMonth}
            </Text>
          )}
        </GlassCard>

        {/* Subscriptions */}
        <GlassCard style={styles.chartCard} padding={16}>
          <View style={styles.chartHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Subscriptions</Text>
              {subscriptions.length > 0 && (
                <Text style={[styles.subTotalText, { color: colors.mutedForeground }]}>
                  £{totalMonthlySubCost.toFixed(2)}/mo detected
                </Text>
              )}
            </View>
            <View style={[styles.subBadge, { backgroundColor: "rgba(225,112,85,0.15)" }]}>
              <Text style={styles.subBadgeText}>📱 Auto-detected</Text>
            </View>
          </View>

          {subscriptions.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={{ fontSize: 24 }}>📱</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No recurring charges detected yet.{"\n"}Import statements to analyse your subscriptions.
              </Text>
            </View>
          ) : (
            subscriptions.map((sub, i) => (
              <View key={sub.normalizedKey}>
                <SubscriptionRow sub={sub} />
                {i < subscriptions.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: colors.border, marginLeft: 48 }]} />
                )}
              </View>
            ))
          )}
        </GlassCard>

        {/* Recent transactions */}
        <GlassCard style={styles.txCard} padding={0}>
          <View style={styles.txHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Transactions</Text>
          </View>
          {recent.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="inbox" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Upload a statement to get started
              </Text>
            </View>
          ) : (
            recent.map((tx, i) => (
              <View key={tx.id}>
                <View style={{ paddingHorizontal: 16 }}>
                  <TransactionItem tx={tx} />
                </View>
                {i < recent.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                )}
              </View>
            ))
          )}
        </GlassCard>
      </ScrollView>

      <ManageBudgetsModal
        visible={budgetModalVisible}
        onClose={() => setBudgetModalVisible(false)}
        budgets={budgets}
        monthSpend={monthSpend}
        onSave={handleSaveBudgets}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screenTitle: {
    fontSize: 28, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: -0.5,
  },
  screenSub: {
    fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 20,
  },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  statCard: { flex: 1, padding: 16 },
  statCardWide: { flex: 1 },
  statHeaderRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  chartCard: { marginTop: 6, marginBottom: 10 },
  chartHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12,
  },
  legendRow: { flexDirection: "row", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sectionTitle: {
    fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 4,
  },
  alertBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  alertText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#EF4444" },
  manageBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  manageTxt: { fontSize: 12, fontFamily: "Inter_500Medium" },
  emptyBudgetBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 20,
  },
  emptyBudgetText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  monthNote: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    textAlign: "right", marginTop: 4,
  },
  breakdownRow: { flexDirection: "row", alignItems: "center" },
  txCard: { marginBottom: 10, paddingHorizontal: 0 },
  txHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 68, marginRight: 16 },
  emptyBox: { paddingVertical: 24, alignItems: "center", gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  subTotalText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  subBadge: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  subBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#E17055" },
  cfChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cfChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  cfQuarterRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
});
