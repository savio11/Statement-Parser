import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { readFileAsBase64, readFileAsText } from "@/lib/fileReader";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "@/components/GlassCard";
import { TransactionItem, ALL_CATEGORIES, CATEGORY_ICONS } from "@/components/TransactionItem";
import { CATEGORY_COLORS } from "@/components/DonutChart";
import {
  categorize,
  deleteAllTransactions,
  deleteTransactionsByMonth,
  getTransactions,
  getTotals,
  insertTransactions,
  updateTransactionCategory,
  type Transaction,
} from "@/lib/database";
import {
  cancelReminder,
  getReminderSettings,
  notifyNewSubscription,
  requestNotificationPermissions,
  scheduleMonthlyReminder,
} from "@/lib/notifications";
import { detectSubscriptions } from "@/lib/subscriptions";
import { useColors } from "@/hooks/useColors";

interface ParsedTx {
  date: string;
  description: string;
  merchant: string;
  amount: number;
  type: string;
  category: string;
}

function parseCSV(text: string): ParsedTx[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));

  const getCol = (cols: string[], ...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return cols[i]?.trim().replace(/"/g, "") ?? "";
    }
    return "";
  };

  const results: ParsedTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const dateRaw = getCol(cols, "date", "transaction date", "value date");
    if (!dateRaw) continue;

    let date = dateRaw;
    const dmyMatch = dateRaw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      const year = y.length === 2 ? `20${y}` : y;
      date = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    const desc = getCol(cols, "description", "transaction description", "details", "reference", "merchant");
    const paidOut = parseFloat(getCol(cols, "paid out", "debit", "withdrawal", "amount out").replace(/,/g, "") || "0");
    const paidIn = parseFloat(getCol(cols, "paid in", "credit", "deposit", "amount in").replace(/,/g, "") || "0");
    let amount = 0;
    let type = "debit";

    if (paidIn > 0) { amount = paidIn; type = "credit"; }
    else if (paidOut > 0) { amount = paidOut; type = "debit"; }
    else {
      const amtStr = getCol(cols, "amount", "net amount");
      const amt = parseFloat(amtStr.replace(/,/g, "") || "0");
      if (amt > 0) { amount = amt; type = "credit"; }
      else if (amt < 0) { amount = Math.abs(amt); type = "debit"; }
      else continue;
    }

    const merchant = desc || "Unknown";
    results.push({ date, description: merchant, merchant, amount, type, category: categorize(merchant) });
  }
  return results;
}

function parsePDFText(text: string): ParsedTx[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: ParsedTx[] = [];

  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const dateRe = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})/i;
  const amountRe = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;

  let lastBalance: number | null = null;
  let pendingDate: string | null = null;
  let pendingMerchant: string | null = null;

  for (const line of lines) {
    if (/balance brought forward|balance carried forward|opening balance|closing balance|payments in|payments out|interest rate|information about/i.test(line)) {
      const bfAmts = [...line.matchAll(amountRe)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      if (bfAmts.length > 0 && /balance brought forward/i.test(line)) {
        lastBalance = bfAmts[bfAmts.length - 1];
      }
      continue;
    }

    const dateMatch = line.match(dateRe);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const month = MONTHS[dateMatch[2].toLowerCase()];
      const yearRaw = dateMatch[3];
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      pendingDate = `${year}-${month}-${day}`;

      const rest = line.substring(dateMatch[0].length).trim();
      const cleaned = rest.replace(/^(BP|VIS|CR|DD|SO|ATM|CHQ|\)\)\)|CC)\s+/i, "");
      pendingMerchant = cleaned.trim() || "Transaction";
    }

    const amounts = [...line.matchAll(amountRe)].map((m) => parseFloat(m[1].replace(/,/g, "")));
    if (amounts.length > 0 && pendingDate && pendingMerchant) {
      const balance = amounts[amounts.length - 1];

      if (lastBalance !== null) {
        const diff = balance - lastBalance;
        const absAmt = Math.abs(diff);
        if (absAmt > 0.005 && absAmt < 100000) {
          const merchant = pendingMerchant;
          results.push({
            date: pendingDate,
            description: merchant,
            merchant,
            amount: parseFloat(absAmt.toFixed(2)),
            type: diff > 0 ? "credit" : "debit",
            category: categorize(merchant),
          });
        }
      }

      lastBalance = balance;
      pendingDate = null;
      pendingMerchant = null;
    }
  }

  return results;
}

export default function AccountsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewTxs, setPreviewTxs] = useState<ParsedTx[]>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [totals, setTotals] = useState({ totalCredits: 0, totalDebits: 0, balance: 0 });
  const [filter, setFilter] = useState<"all" | "credit" | "debit">("all");

  const currentMonth = new Date().toISOString().substring(0, 7);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set([currentMonth]));
  const [recatTx, setRecatTx] = useState<Transaction | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDay, setReminderDay] = useState(1);
  const [showDayPicker, setShowDayPicker] = useState(false);

  const load = useCallback(async () => {
    const [txs, tot, reminder] = await Promise.all([
      getTransactions(500),
      getTotals(),
      getReminderSettings(),
    ]);
    setTransactions(txs);
    setTotals(tot);
    setReminderEnabled(reminder.enabled);
    setReminderDay(reminder.day);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleReminder() {
    if (Platform.OS === "web") {
      Alert.alert("Not available", "Push notifications require the mobile app.");
      return;
    }
    if (!reminderEnabled) {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert("Permission denied", "Enable notifications in your device settings to use this feature.");
        return;
      }
      await scheduleMonthlyReminder(reminderDay);
      setReminderEnabled(true);
      Alert.alert("Reminder set", `You'll be reminded on the ${reminderDay}${ordinal(reminderDay)} of each month to upload your statement.`);
    } else {
      await cancelReminder();
      setReminderEnabled(false);
    }
  }

  async function applyReminderDay(day: number) {
    setReminderDay(day);
    setShowDayPicker(false);
    if (reminderEnabled) {
      await scheduleMonthlyReminder(day);
    }
  }

  function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  async function handleUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/csv", "text/comma-separated-values", "application/vnd.ms-excel"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setUploading(true);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const ext = asset.name.toLowerCase().split(".").pop();

      if (ext === "csv") {
        const text = await readFileAsText(asset.uri);
        const parsed = parseCSV(text);
        setPreviewTxs(parsed);
        setPreviewVisible(true);
      } else if (ext === "pdf") {
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        const base64 = await readFileAsBase64(asset.uri);
        const response = await fetch(`https://${domain}/api/parse-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, filename: asset.name }),
        });
        if (!response.ok) throw new Error("PDF parsing failed");
        const data = await response.json() as { transactions: ParsedTx[] };
        setPreviewTxs(data.transactions);
        setPreviewVisible(true);
      } else {
        Alert.alert("Unsupported format", "Please upload a PDF or CSV file.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      Alert.alert("Upload failed", msg);
    } finally {
      setUploading(false);
    }
  }

  async function confirmImport() {
    const beforeTxs = await getTransactions(2000);
    const beforeSubs = new Set(detectSubscriptions(beforeTxs).map((s) => s.normalizedKey));

    await insertTransactions(previewTxs);

    const afterTxs = await getTransactions(2000);
    const afterSubs = detectSubscriptions(afterTxs);
    const newSubs = afterSubs.filter((s) => !beforeSubs.has(s.normalizedKey));

    setPreviewVisible(false);
    setPreviewTxs([]);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await load();

    for (const sub of newSubs) {
      notifyNewSubscription(sub.merchant, sub.monthlyEquiv).catch(() => {});
    }

    if (newSubs.length > 0) {
      const names = newSubs.slice(0, 3).map((s) => `• ${s.merchant} (${s.frequencyLabel}, £${s.monthlyEquiv.toFixed(2)}/mo)`).join("\n");
      const extra = newSubs.length > 3 ? `\n+${newSubs.length - 3} more` : "";
      Alert.alert(
        `${newSubs.length} new recurring charge${newSubs.length > 1 ? "s" : ""} detected`,
        names + extra,
        [{ text: "OK" }]
      );
    }
  }

  async function clearAll() {
    Alert.alert("Clear all transactions", "This will delete all imported transactions. Continue?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteAllTransactions();
          await load();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  }

  async function handleRecat(category: string) {
    if (!recatTx) return;
    await updateTransactionCategory(recatTx.id, category);
    setRecatTx(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await load();
  }

  const filtered = filter === "all" ? transactions : transactions.filter((t) => t.type === filter);

  const monthGroups = useMemo(() => {
    const byMonth: Record<string, Transaction[]> = {};
    for (const tx of filtered) {
      const m = tx.date.substring(0, 7);
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(tx);
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, txs]) => {
        const [y, mo] = month.split("-");
        const label = new Date(parseInt(y), parseInt(mo) - 1, 1)
          .toLocaleString("en-GB", { month: "long", year: "numeric" });
        const credits = txs.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
        const debits  = txs.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
        return { month, label, txs, credits, debits };
      });
  }, [filtered]);

  function toggleMonth(month: string) {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  }

  function deleteMonth(month: string, label: string, count: number) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      `Delete ${label}?`,
      `This will permanently delete all ${count} transaction${count !== 1 ? "s" : ""} from ${label}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteTransactionsByMonth(month);
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await load();
          },
        },
      ]
    );
  }

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
            <Text style={[styles.screenTitle, { color: colors.foreground }]}>Accounts</Text>
            <Text style={[styles.screenSub, { color: colors.mutedForeground }]}>
              {transactions.length} transactions
            </Text>
          </View>
          {transactions.length > 0 && (
            <TouchableOpacity onPress={clearAll} style={styles.clearBtn}>
              <Feather name="trash-2" size={16} color={colors.debit} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.uploadBtn, { backgroundColor: colors.primary, opacity: uploading ? 0.7 : 1 }]}
          onPress={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <>
              <Feather name="upload" size={18} color={colors.background} />
              <Text style={[styles.uploadBtnText, { color: colors.background }]}>Upload Statement</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
          Tap any transaction to change its category
        </Text>

        {transactions.length > 0 && (
          <View style={styles.filterRow}>
            {(["all", "credit", "debit"] as const).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, filter === f && { backgroundColor: colors.primary }]}
                onPress={() => setFilter(f)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: filter === f ? colors.background : colors.mutedForeground },
                  ]}
                >
                  {f === "all" ? "All" : f === "credit" ? "Credits" : "Debits"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {filtered.length === 0 ? (
          <GlassCard padding={0} style={{ marginBottom: 16 }}>
            <View style={styles.emptyBox}>
              <Feather name="file-text" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {transactions.length === 0
                  ? "Upload a PDF or CSV bank statement"
                  : "No transactions match filter"}
              </Text>
            </View>
          </GlassCard>
        ) : (
          monthGroups.map(({ month, label, txs, credits, debits }) => {
            const expanded = expandedMonths.has(month);
            return (
              <GlassCard key={month} padding={0} style={{ marginBottom: 10 }}>
                <TouchableOpacity
                  style={styles.monthHeader}
                  onPress={() => toggleMonth(month)}
                  onLongPress={() => deleteMonth(month, label, txs.length)}
                  delayLongPress={500}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.monthLabel, { color: colors.foreground }]}>{label}</Text>
                    <View style={styles.monthMeta}>
                      <Text style={[styles.monthMetaText, { color: colors.credit }]}>
                        +£{credits.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </Text>
                      <Text style={[styles.monthMetaText, { color: colors.mutedForeground }]}> · </Text>
                      <Text style={[styles.monthMetaText, { color: colors.debit }]}>
                        -£{debits.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </Text>
                      <Text style={[styles.monthMetaText, { color: colors.mutedForeground }]}>
                        {" · "}{txs.length} transaction{txs.length !== 1 ? "s" : ""}
                      </Text>
                    </View>
                  </View>
                  <Feather
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>
                {expanded && (
                  <>
                    <View style={[styles.divider, { backgroundColor: colors.border, marginLeft: 0, marginRight: 0 }]} />
                    {txs.map((tx, i) => (
                      <View key={tx.id}>
                        <View style={{ paddingHorizontal: 16 }}>
                          <TransactionItem tx={tx} onPress={setRecatTx} />
                        </View>
                        {i < txs.length - 1 && (
                          <View style={[styles.divider, { backgroundColor: colors.border }]} />
                        )}
                      </View>
                    ))}
                  </>
                )}
              </GlassCard>
            );
          })
        )}

        {/* ── Monthly reminder card ── */}
        <GlassCard padding={16} style={{ marginBottom: 16 }}>
          <View style={styles.reminderHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Feather name="bell" size={16} color={colors.primary} />
              <Text style={[styles.reminderTitle, { color: colors.foreground }]}>Monthly Reminder</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.togglePill,
                { backgroundColor: reminderEnabled ? colors.primary : "rgba(255,255,255,0.08)" },
              ]}
              onPress={toggleReminder}
              activeOpacity={0.8}
            >
              <Text style={[styles.toggleText, { color: reminderEnabled ? colors.background : colors.mutedForeground }]}>
                {reminderEnabled ? "ON" : "OFF"}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.reminderSub, { color: colors.mutedForeground }]}>
            Get notified each month to upload your latest bank statement
          </Text>
          {reminderEnabled && (
            <TouchableOpacity
              style={[styles.dayRow, { borderColor: colors.border }]}
              onPress={() => setShowDayPicker(true)}
            >
              <Feather name="calendar" size={14} color={colors.mutedForeground} />
              <Text style={[styles.dayText, { color: colors.foreground }]}>
                Remind me on the{" "}
                <Text style={{ color: colors.primary }}>
                  {reminderDay}{ordinal(reminderDay)}
                </Text>{" "}
                of each month
              </Text>
              <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </GlassCard>
      </ScrollView>

      {/* ── Day picker modal ── */}
      <Modal visible={showDayPicker} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}>
        <View style={[styles.modal, { backgroundColor: "#0D1121" }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Choose Reminder Day</Text>
          <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
            Pick the day of the month you'd like to be reminded
          </Text>
          <ScrollView contentContainerStyle={styles.dayGrid}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <TouchableOpacity
                key={d}
                style={[
                  styles.dayChip,
                  d === reminderDay && { backgroundColor: colors.primary },
                  { borderColor: colors.border },
                ]}
                onPress={() => applyReminderDay(d)}
              >
                <Text style={[styles.dayChipText, { color: d === reminderDay ? colors.background : colors.foreground }]}>
                  {d}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[styles.cancelFullBtn, { borderColor: colors.border, marginBottom: 32 }]}
            onPress={() => setShowDayPicker(false)}
          >
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Import preview modal ── */}
      <Modal visible={previewVisible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}>
        <View style={[styles.modal, { backgroundColor: "#0D1121" }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            Import {previewTxs.length} Transactions
          </Text>
          <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
            Review parsed transactions before saving
          </Text>
          <FlatList
            data={previewTxs.slice(0, 50)}
            keyExtractor={(_, i) => i.toString()}
            style={{ flex: 1 }}
            renderItem={({ item, index }) => (
              <View>
                <View style={{ paddingHorizontal: 20 }}>
                  <TransactionItem
                    tx={{
                      id: index.toString(),
                      account_id: null,
                      description: item.description,
                      merchant: item.merchant,
                      amount: item.amount,
                      type: item.type as "credit" | "debit",
                      category: item.category,
                      date: item.date,
                      source_type: "Statement",
                      created_at: 0,
                    }}
                  />
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              </View>
            )}
          />
          {previewTxs.length > 50 && (
            <Text style={[styles.moreText, { color: colors.mutedForeground }]}>
              +{previewTxs.length - 50} more
            </Text>
          )}
          <View style={[styles.modalActions, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => { setPreviewVisible(false); setPreviewTxs([]); }}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.confirmBtn, { backgroundColor: colors.primary }]}
              onPress={confirmImport}
            >
              <Text style={{ color: colors.background, fontFamily: "Inter_600SemiBold" }}>
                Save All
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Re-categorize modal ── */}
      <Modal visible={!!recatTx} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}>
        <View style={[styles.modal, { backgroundColor: "#0D1121" }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Change Category</Text>
          {recatTx && (
            <Text style={[styles.modalSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              {recatTx.merchant || recatTx.description}
            </Text>
          )}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 }}>
            {ALL_CATEGORIES.map((cat) => {
              const isSelected = recatTx?.category === cat;
              const color = CATEGORY_COLORS[cat] ?? "#636E72";
              return (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.catRow,
                    {
                      backgroundColor: isSelected ? `${color}22` : "rgba(255,255,255,0.04)",
                      borderColor: isSelected ? color : "rgba(255,255,255,0.08)",
                    },
                  ]}
                  onPress={() => handleRecat(cat)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.catDot, { backgroundColor: color }]} />
                  <Text style={styles.catIcon}>{CATEGORY_ICONS[cat] ?? "•"}</Text>
                  <Text style={[styles.catLabel, { color: isSelected ? color : colors.foreground }]}>
                    {cat}
                  </Text>
                  {isSelected && (
                    <Feather name="check" size={16} color={color} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={[styles.modalActions, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setRecatTx(null)}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
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
  clearBtn: {
    padding: 8,
    marginTop: 4,
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
    marginBottom: 8,
  },
  uploadBtnText: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  uploadHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 20,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  monthLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  monthMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  monthMetaText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
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
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
    marginRight: 16,
  },
  modal: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: 60,
    paddingTop: 12,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 20,
  },
  modalSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 12,
  },
  moreText: {
    textAlign: "center",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingVertical: 8,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtn: {
    borderWidth: 1,
  },
  confirmBtn: {},
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  catDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  catIcon: {
    fontSize: 18,
    width: 24,
    textAlign: "center",
  },
  catLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  reminderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  reminderTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  reminderSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  togglePill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  toggleText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dayText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  dayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    gap: 10,
    paddingBottom: 20,
  },
  dayChip: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dayChipText: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
  },
  cancelFullBtn: {
    marginHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
  },
});
