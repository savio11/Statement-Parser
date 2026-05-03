import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { Transaction } from "@/lib/database";

export const ALL_CATEGORIES = [
  "Food & Dining",
  "Transport",
  "Entertainment",
  "Subscriptions",
  "Shopping",
  "Bills & Utilities",
  "Housing",
  "Health & Fitness",
  "Travel",
  "Income",
  "Transfers",
  "Other",
] as const;

export const CATEGORY_ICONS: Record<string, string> = {
  "Food & Dining": "🍽",
  Transport: "🚇",
  Entertainment: "🎬",
  Subscriptions: "📱",
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
  onPress?: (tx: Transaction) => void;
}

export function TransactionItem({ tx, onPress }: Props) {
  const colors = useColors();
  const isCredit = tx.type === "credit";
  const icon = CATEGORY_ICONS[tx.category] ?? "•";
  const dateStr = tx.date.substring(5).replace("-", "/");

  const inner = (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: isCredit ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.12)" }]}>
        <Text style={styles.iconText}>{icon}</Text>
      </View>
      <View style={styles.middle}>
        <Text style={[styles.merchant, { color: colors.foreground }]} numberOfLines={1}>
          {tx.merchant || tx.description}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {tx.category}  ·  {dateStr}
          </Text>
          {onPress && (
            <Feather name="edit-2" size={10} color={colors.mutedForeground} style={{ marginLeft: 4, opacity: 0.6 }} />
          )}
        </View>
      </View>
      <Text style={[styles.amount, { color: isCredit ? colors.credit : colors.debit }]}>
        {isCredit ? "+" : "-"}£{tx.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={() => onPress(tx)} activeOpacity={0.7}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  amount: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
