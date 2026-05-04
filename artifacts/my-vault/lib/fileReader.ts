import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

async function blobToBase64(uri: string): Promise<string> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function blobToText(uri: string): Promise<string> {
  const res = await fetch(uri);
  return res.text();
}

export async function readFileAsBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") return blobToBase64(uri);
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export async function readFileAsText(uri: string): Promise<string> {
  if (Platform.OS === "web") return blobToText(uri);
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
}
