import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { Transaction } from "@/lib/database";

const CATEGORY_ICONS: Record<string, string> = {
  "Food & Dining": "🍽",
  Transport: "🚇",
  Entertainment: "🎬",
  Shopping: "🛍",
  "Bills & Utilities": "💡",
  Housing: "🏠",
  "Health & Fitness": "💪",
  Travel: "✈",
  Income: "💰",
  Transfers: "↔",
  Other: "•",
};

interface Props {
  tx: Transaction;
}

export function TransactionItem({ tx }: Props) {
  const colors = useColors();
  const isCredit = tx.type === "credit";
  const icon = CATEGORY_ICONS[tx.category] ?? "•";
  const dateStr = tx.date.substring(5).replace("-", "/");

  return (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: isCredit ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.12)" }]}>
        <Text style={styles.iconText}>{icon}</Text>
      </View>
      <View style={styles.middle}>
        <Text style={[styles.merchant, { color: colors.foreground }]} numberOfLines={1}>
          {tx.merchant || tx.description}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {tx.category}  ·  {dateStr}
        </Text>
      </View>
      <Text style={[styles.amount, { color: isCredit ? colors.credit : colors.debit }]}>
        {isCredit ? "+" : "-"}£{tx.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 18,
  },
  middle: {
    flex: 1,
  },
  merchant: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  meta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  amount: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
