import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  Dimensions,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { G, Rect, Text as SvgText, Line, Svg } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "@/components/GlassCard";
import { TransactionItem } from "@/components/TransactionItem";
import { DonutChart, CategoryLegend } from "@/components/DonutChart";
import {
  getCategoryBreakdown,
  getMonthlyCashflow,
  getTransactions,
  getTotals,
  type CategoryTotal,
  type MonthlyCashflow,
  type Transaction,
} from "@/lib/database";
import { useColors } from "@/hooks/useColors";

const MONTH_SHORT: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

function CashflowChart({ data }: { data: MonthlyCashflow[] }) {
  const colors = useColors();
  const screenW = Dimensions.get("window").width;
  const chartW = screenW - 48;
  const chartH = 160;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const reversed = [...data].reverse();
  const maxVal = Math.max(...reversed.flatMap((d) => [d.credits, d.debits]), 1);

  if (reversed.length === 0) {
    return (
      <View style={{ height: chartH, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
          No data yet
        </Text>
      </View>
    );
  }

  const groupW = innerW / reversed.length;
  const barW = Math.min(groupW * 0.35, 18);
  const gap = 3;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    val: maxVal * t,
    y: padT + innerH - innerH * t,
  }));

  return (
    <Svg width={chartW} height={chartH}>
      {yTicks.map((tick, i) => (
        <G key={i}>
          <Line
            x1={padL}
            y1={tick.y}
            x2={chartW - padR}
            y2={tick.y}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
          <SvgText
            x={padL - 6}
            y={tick.y + 4}
            textAnchor="end"
            fill="rgba(240,244,255,0.35)"
            fontSize={9}
            fontFamily="Inter_400Regular"
          >
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
            <Rect
              x={x}
              y={padT + innerH - creditH}
              width={barW}
              height={creditH}
              fill="#10B981"
              rx={4}
            />
            <Rect
              x={x + barW + gap}
              y={padT + innerH - debitH}
              width={barW}
              height={debitH}
              fill="#EF4444"
              rx={4}
            />
            <SvgText
              x={x + barW}
              y={chartH - 6}
              textAnchor="middle"
              fill="rgba(240,244,255,0.45)"
              fontSize={9}
              fontFamily="Inter_400Regular"
            >
              {label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [cashflow, setCashflow] = useState<MonthlyCashflow[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState({ totalCredits: 0, totalDebits: 0, balance: 0 });
  const [breakdown, setBreakdown] = useState<CategoryTotal[]>([]);

  const load = useCallback(async () => {
    const [cf, tx, tot, bk] = await Promise.all([
      getMonthlyCashflow(),
      getTransactions(10),
      getTotals(),
      getCategoryBreakdown(),
    ]);
    setCashflow(cf);
    setRecent(tx);
    setTotals(tot);
    setBreakdown(bk);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const formatAmount = (n: number) =>
    n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = Platform.OS === "web" ? 34 : 90;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad, paddingHorizontal: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={[styles.screenTitle, { color: colors.foreground }]}>My Vault</Text>
      <Text style={[styles.screenSub, { color: colors.mutedForeground }]}>Financial overview</Text>

      <View style={styles.statRow}>
        <GlassCard style={[styles.statCard, styles.statCardWide]}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Net Balance</Text>
          <Text style={[styles.statValue, { color: colors.primary, fontSize: 26 }]}>
            £{formatAmount(Math.abs(totals.balance))}
          </Text>
        </GlassCard>
      </View>

      <View style={styles.statRow}>
        <GlassCard style={styles.statCard}>
          <View style={styles.statHeaderRow}>
            <Feather name="arrow-down-circle" size={14} color={colors.credit} />
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Income</Text>
          </View>
          <Text style={[styles.statValue, { color: colors.credit }]}>
            £{formatAmount(totals.totalCredits)}
          </Text>
        </GlassCard>
        <GlassCard style={styles.statCard}>
          <View style={styles.statHeaderRow}>
            <Feather name="arrow-up-circle" size={14} color={colors.debit} />
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Spent</Text>
          </View>
          <Text style={[styles.statValue, { color: colors.debit }]}>
            £{formatAmount(totals.totalDebits)}
          </Text>
        </GlassCard>
      </View>

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
        <CashflowChart data={cashflow} />
      </GlassCard>

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
  );
}

const styles = StyleSheet.create({
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
    marginBottom: 20,
  },
  statRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    padding: 16,
  },
  statCardWide: {
    flex: 1,
  },
  statHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  chartCard: {
    marginTop: 6,
    marginBottom: 10,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  legendRow: {
    flexDirection: "row",
    gap: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    marginBottom: 12,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  txCard: {
    marginBottom: 10,
    paddingHorizontal: 0,
  },
  txHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
    marginRight: 16,
  },
  emptyBox: {
    paddingVertical: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
