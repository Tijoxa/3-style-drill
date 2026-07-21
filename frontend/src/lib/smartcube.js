// Thin wrapper around smartcube-web-bluetooth (Web Bluetooth). Client-side only.
// NOTE: statically imported so requestDevice() runs inside the click gesture.
import { connectSmartCube } from "smartcube-web-bluetooth";

let conn = null;
let sub = null;

export function isBluetoothSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

function macKey(device) {
  return "cube_mac_" + (device?.id || device?.name || "default");
}

// GAN / MoYu / QiYi cubes need a MAC for decryption. If the browser can't read it
// from advertisement data, fall back to a cached / user-provided MAC.
async function macAddressProvider(device, isRetry) {
  const key = macKey(device);
  let mac = localStorage.getItem(key);
  if (!mac && isRetry) {
    mac = window.prompt(
      "Could not read your cube's Bluetooth MAC automatically.\n\n" +
      "Enter the MAC address of your smart cube (format AA:BB:CC:DD:EE:FF).\n" +
      "You can find it in your cube's official app (e.g. GAN / Cube Station).\n" +
      "Leave empty to cancel."
    );
    if (mac) {
      mac = mac.trim().toUpperCase();
      localStorage.setItem(key, mac);
    }
  }
  return mac || null;
}

// handlers: { onMove, onFacelets, onBattery, onDisconnect, onStatus }
export async function connect(handlers) {
  conn = await connectSmartCube({
    enableAddressSearch: true,
    onStatus: (s) => handlers.onStatus?.(s),
    macAddressProvider,
  });

  sub = conn.events$.subscribe((event) => {
    switch (event.type) {
      case "MOVE": {
        const move = normalizeMove(event);
        if (move) handlers.onMove?.(move);
        break;
      }
      case "FACELETS":
        handlers.onFacelets?.(event.facelets);
        break;
      case "BATTERY":
        handlers.onBattery?.(event.batteryLevel);
        break;
      case "DISCONNECT":
        handlers.onDisconnect?.();
        break;
      default:
        break;
    }
  });

  const caps = conn.capabilities || {};
  try {
    if (caps.facelets) await conn.sendCommand?.({ type: "REQUEST_FACELETS" });
    if (caps.battery) await conn.sendCommand?.({ type: "REQUEST_BATTERY" });
  } catch (e) { /* ignore */ }

  return { name: conn.deviceName || conn.name || "Smart Cube", capabilities: caps };
}

function normalizeMove(event) {
  if (event.move && typeof event.move === "string") return event.move;
  const face = event.face;
  if (!face) return null;
  const dir = event.direction;
  const faceChar = typeof face === "string" ? face[0].toUpperCase() : face;
  if (dir === -1 || dir === 2 || dir === false) return faceChar + "'";
  return faceChar;
}

export async function disconnect() {
  try { sub?.unsubscribe?.(); } catch (e) {}
  try { await conn?.disconnect?.(); } catch (e) {}
  conn = null; sub = null;
}
