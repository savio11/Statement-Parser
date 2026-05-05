import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import React, { useEffect } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

function LockScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authenticate, isAuthAvailable } = useAuth();
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") {
      handleAuth();
    }
  }, []);

  async function handleAuth() {
    setLoading(true);
    await authenticate();
    setLoading(false);
  }

  return (
    <View
      style={[
        styles.lockContainer,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0),
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0),
        },
      ]}
    >
      <View style={styles.lockInner}>
        <View style={[styles.vaultIcon, { borderColor: colors.primary }]}>
          <Feather name="lock" size={36} color={colors.primary} />
        </View>
        <Text style={[styles.lockTitle, { color: colors.foreground }]}>My Vault</Text>
        <Text style={[styles.lockSub, { color: colors.mutedForeground }]}>
          {isAuthAvailable ? "Use biometrics to unlock" : "Tap to unlock"}
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : (
          <TouchableOpacity
            style={[styles.unlockBtn, { backgroundColor: colors.primary }]}
            onPress={handleAuth}
          >
            <Feather name="unlock" size={18} color={colors.background} />
            <Text style={[styles.unlockBtnText, { color: colors.background }]}>
              Unlock
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} />
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="accounts">
        <Icon sf={{ default: "building.columns", selected: "building.columns.fill" }} />
        <Label>Accounts</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="portfolio">
        <Icon sf={{ default: "chart.line.uptrend.xyaxis", selected: "chart.line.uptrend.xyaxis" }} />
        <Label>Portfolio</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="growth">
        <Icon sf={{ default: "flask.fill", selected: "flask.fill" }} />
        <Label>Growth Lab</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : "#0D1121",
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 84 : 60,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : null,
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
          marginBottom: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="chart.bar.fill" tintColor={color} size={22} />
            ) : (
              <Feather name="bar-chart-2" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          title: "Accounts",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="building.columns.fill" tintColor={color} size={22} />
            ) : (
              <Feather name="credit-card" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: "Portfolio",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="chart.line.uptrend.xyaxis" tintColor={color} size={22} />
            ) : (
              <Feather name="trending-up" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="growth"
        options={{
          title: "Growth Lab",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="flask.fill" tintColor={color} size={22} />
            ) : (
              <Feather name="activity" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LockScreen />;
  }

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({
  lockContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  lockInner: {
    alignItems: "center",
    gap: 12,
  },
  vaultIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 212, 255, 0.08)",
    marginBottom: 8,
  },
  lockTitle: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  lockSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  unlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
    marginTop: 24,
  },
  unlockBtnText: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
