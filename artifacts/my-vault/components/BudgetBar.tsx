import React from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { CATEGORY_COLORS } from "@/components/DonutChart";
import { CATEGORY_ICONS } from "@/components/TransactionItem";
import { useColors } from "@/hooks/useColors";

interface Props {
  category: string;
  spent: number;
  limit: number;
}

function barColor(pct: number): string {
  if (pct >= 1) return "#EF4444";
  if (pct >= 0.75) return "#F59E0B";
  return "#10B981";
}

export function BudgetBar({ category, spent, limit }: Props) {
  const colors = useColors();
  const pct = limit > 0 ? Math.min(spent / limit, 1) : 0;
  const accent = CATEGORY_COLORS[category] ?? "#00D4FF";
  const fill = barColor(pct);
  const over = spent > limit;

  return (
    <View style={styles.row}>
      <View style={styles.topRow}>
        <View style={styles.labelGroup}>
          <Text style={styles.icon}>{CATEGORY_ICONS[category] ?? "•"}</Text>
          <Text style={[styles.catName, { color: colors.foreground }]} numberOfLines={1}>
            {category}
          </Text>
        </View>
        <View style={styles.amtGroup}>
          <Text style={[styles.spent, { color: over ? "#EF4444" : colors.foreground }]}>
            £{spent.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </Text>
          <Text style={[styles.limit, { color: colors.mutedForeground }]}>
            {" / "}£{limit.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </Text>
        </View>
      </View>

      <View style={[styles.track, { backgroundColor: "rgba(255,255,255,0.07)" }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.round(pct * 100)}%` as any,
              backgroundColor: fill,
            },
          ]}
        />
      </View>

      {over && (
        <Text style={styles.overText}>
          £{(spent - limit).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} over budget
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: 14,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  labelGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  icon: {
    fontSize: 15,
    width: 20,
    textAlign: "center",
  },
  catName: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  amtGroup: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  spent: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  limit: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  overText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#EF4444",
    marginTop: 3,
  },
});
