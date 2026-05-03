import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getSetting, setSetting } from "./database";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function scheduleMonthlyReminder(dayOfMonth: number): Promise<void> {
  if (Platform.OS === "web") return;

  await Notifications.cancelAllScheduledNotificationsAsync();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "📄 Upload your bank statement",
      body: `It's the ${dayOfMonth}${ordinal(dayOfMonth)} — time to upload last month's statement to My Vault.`,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
      day: dayOfMonth,
      hour: 9,
      minute: 0,
    },
  });

  await setSetting("reminder_day", String(dayOfMonth));
  await setSetting("reminder_enabled", "true");
}

export async function cancelReminder(): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  await setSetting("reminder_enabled", "false");
}

export async function getReminderSettings(): Promise<{ enabled: boolean; day: number }> {
  const enabled = (await getSetting("reminder_enabled", "false")) === "true";
  const day = parseInt(await getSetting("reminder_day", "1"), 10) || 1;
  return { enabled, day };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
