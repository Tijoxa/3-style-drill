// Thin wrapper around smartcube-web-bluetooth (Web Bluetooth). Client-side only.
// Vendored (compiled) into src/vendor/smartcube so the app builds anywhere
// (incl. GitHub Pages / GitHub Actions) without the unbuildable git dependency.
import { connectSmartCube } from "../vendor/smartcube/index.js";

let conn = null;
let sub = null;

export function isBluetoothSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

function macKey(device) {
  return "cube_mac_" + (device?.id || device?.name || "default");
}

// handlers: { onMove, onFacelets, onBattery, onDisconnect, onStatus, requestMac }
// options: { presetMac }
export async function connect(handlers, options = {}) {
  const presetMac = (options.presetMac || "").trim();

  const provider = async (device, isRetry) => {
    const key = macKey(device);
    let mac = presetMac || localStorage.getItem(key);
    if (mac) return mac.trim().toUpperCase();
    // let the library try advertisement / manufacturer data first
    if (!isRetry) return null;
    if (handlers.requestMac) mac = await handlers.requestMac(device?.name || "");
    if (mac) {
      mac = mac.trim().toUpperCase();
      localStorage.setItem(key, mac);
      return mac;
    }
    return null;
  };

  conn = await connectSmartCube({
    enableAddressSearch: true,
    onStatus: (s) => handlers.onStatus?.(s),
    macAddressProvider: provider,
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

export async function requestFacelets() {
  try {
    if (conn?.capabilities?.facelets) await conn.sendCommand?.({ type: "REQUEST_FACELETS" });
  } catch (e) { /* ignore */ }
}
