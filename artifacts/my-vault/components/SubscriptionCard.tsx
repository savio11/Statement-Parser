import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { DetectedSubscription } from "@/lib/subscriptions";
import { useColors } from "@/hooks/useColors";

const FREQ_COLORS: Record<string, string> = {
  weekly:    "#74B9FF",
  monthly:   "#E17055",
  quarterly: "#FDCB6E",
  annual:    "#A29BFE",
};

function relativeDate(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 13) return `in ${days}d`;
  if (days <= 45) return `in ${Math.round(days / 7)}w`;
  return `in ~${Math.round(days / 30)}mo`;
}

interface Props {
  sub: DetectedSubscription;
}

export function SubscriptionRow({ sub }: Props) {
  const colors = useColors();
  const freqColor = FREQ_COLORS[sub.frequency] ?? "#B2BEC3";
  const nextRel = relativeDate(sub.nextExpected);
  const isOverdue = sub.nextExpected < new Date().toISOString().substring(0, 10);

  return (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: `${freqColor}18` }]}>
        <Text style={styles.iconText}>📱</Text>
      </View>

      <View style={styles.middle}>
        <Text style={[styles.merchant, { color: colors.foreground }]} numberOfLines={1}>
          {sub.merchant}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.freqBadge, { backgroundColor: `${freqColor}22` }]}>
            <Text style={[styles.freqText, { color: freqColor }]}>{sub.frequencyLabel}</Text>
          </View>
          <Text style={[styles.nextText, { color: isOverdue ? "#EF4444" : colors.mutedForeground }]}>
            Next {nextRel}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <Text style={[styles.amount, { color: colors.foreground }]}>
          £{sub.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>
        {sub.frequency !== "monthly" && (
          <Text style={[styles.monthlyEquiv, { color: colors.mutedForeground }]}>
            £{sub.monthlyEquiv.toFixed(0)}/mo
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 10,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconText: { fontSize: 17 },
  middle: { flex: 1, gap: 4 },
  merchant: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  freqBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  freqText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  nextText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  right: { alignItems: "flex-end", gap: 2 },
  amount: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  monthlyEquiv: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
});
