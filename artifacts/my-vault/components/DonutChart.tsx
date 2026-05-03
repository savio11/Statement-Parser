import React from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { G, Path, Svg } from "react-native-svg";
import type { CategoryTotal } from "@/lib/database";
import { useColors } from "@/hooks/useColors";

export const CATEGORY_COLORS: Record<string, string> = {
  "Food & Dining":    "#FF6B6B",
  Transport:          "#4ECDC4",
  Entertainment:      "#A29BFE",
  Shopping:           "#FD79A8",
  "Bills & Utilities":"#FDCB6E",
  Housing:            "#6C5CE7",
  "Health & Fitness": "#55EFC4",
  Travel:             "#74B9FF",
  Income:             "#00B894",
  Transfers:          "#B2BEC3",
  Other:              "#636E72",
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const sweep = endDeg - startDeg;
  if (sweep >= 360) {
    const p1 = polarToCartesian(cx, cy, r, 0);
    const p2 = polarToCartesian(cx, cy, r, 180);
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 1 1 ${p2.x} ${p2.y} A ${r} ${r} 0 1 1 ${p1.x} ${p1.y} Z`;
  }
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const large = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y} Z`;
}

interface Props {
  data: CategoryTotal[];
  size?: number;
}

export function DonutChart({ data, size = 160 }: Props) {
  const colors = useColors();
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = outerR * 0.55;

  let startAngle = 0;
  const slices = data.map((item) => {
    const sweep = (item.pct / 100) * 360;
    const slice = { item, startAngle, endAngle: startAngle + sweep };
    startAngle += sweep;
    return slice;
  });

  return (
    <Svg width={size} height={size}>
      {slices.map(({ item, startAngle: s, endAngle: e }, i) => {
        const color = CATEGORY_COLORS[item.category] ?? "#636E72";
        return (
          <G key={i}>
            <Path d={describeArc(cx, cy, outerR, s, e)} fill={color} />
          </G>
        );
      })}
      <Path
        d={`M ${cx - innerR} ${cy} A ${innerR} ${innerR} 0 1 1 ${cx + innerR} ${cy} A ${innerR} ${innerR} 0 1 1 ${cx - innerR} ${cy} Z`}
        fill={colors.background}
      />
    </Svg>
  );
}

interface LegendProps {
  data: CategoryTotal[];
  limit?: number;
}

export function CategoryLegend({ data, limit = 6 }: LegendProps) {
  const colors = useColors();
  const shown = data.slice(0, limit);

  return (
    <View style={styles.legend}>
      {shown.map((item) => (
        <View key={item.category} style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: CATEGORY_COLORS[item.category] ?? "#636E72" }]} />
          <Text style={[styles.legendLabel, { color: colors.foreground }]} numberOfLines={1}>
            {item.category}
          </Text>
          <Text style={[styles.legendPct, { color: colors.mutedForeground }]}>
            {item.pct}%
          </Text>
          <Text style={[styles.legendAmt, { color: colors.foreground }]}>
            £{item.total.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flex: 1,
    justifyContent: "center",
    gap: 8,
    paddingLeft: 12,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  legendLabel: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  legendPct: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    minWidth: 32,
    textAlign: "right",
  },
  legendAmt: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    minWidth: 44,
    textAlign: "right",
  },
});
