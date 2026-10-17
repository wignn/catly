import { isTauri } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export async function enableNotifications(): Promise<boolean> {
  if (isTauri()) return await isPermissionGranted() || await requestPermission() === "granted";
  if (typeof Notification === "undefined") throw new Error("Platform ini tidak mendukung notifikasi desktop.");
  return await Notification.requestPermission() === "granted";
}

export async function notifyAlert(title: string, body: string, tag: string): Promise<void> {
  if (isTauri()) {
    if (!await isPermissionGranted()) throw new Error("Izin notifikasi belum diberikan.");
    sendNotification({ title, body });
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") throw new Error("Izin notifikasi belum diberikan.");
  new Notification(title, { body, tag });
}
