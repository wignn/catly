import { isTauri } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export async function enableNotifications(): Promise<boolean> {
  if (isTauri()) return await isPermissionGranted() || await requestPermission() === "granted";
  if (typeof Notification === "undefined") throw new Error("This platform does not support desktop notifications.");
  return await Notification.requestPermission() === "granted";
}

export async function notifyAlert(title: string, body: string, tag: string): Promise<void> {
  if (isTauri()) {
    if (!await isPermissionGranted()) throw new Error("Notification permission has not been granted.");
    sendNotification({ title, body });
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") throw new Error("Notification permission has not been granted.");
  new Notification(title, { body, tag });
}
