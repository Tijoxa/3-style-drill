// Thin wrapper around smartcube-web-bluetooth (Web Bluetooth). Client-side only.
let conn = null;
let sub = null;

export function isBluetoothSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

// handlers: { onMove(moveStr), onFacelets(facelets), onBattery(level), onDisconnect() }
export async function connect(handlers) {
  const mod = await import("smartcube-web-bluetooth");
  const connectSmartCube = mod.connectSmartCube || mod.default?.connectSmartCube;
  if (!connectSmartCube) throw new Error("connectSmartCube not available");

  conn = await connectSmartCube();

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

  return {
    name: conn.deviceName || conn.name || "Smart Cube",
    capabilities: caps,
  };
}

function normalizeMove(event) {
  if (event.move && typeof event.move === "string") return event.move;
  const face = event.face;
  if (!face) return null;
  // direction: 1 = clockwise, -1/0 varies by lib; treat truthy negative as prime
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
