import { writeGattCharacteristicValue } from '../../gatt-characteristic-write';
/**
 * MoYu BLE API v1: fragmented request/response on 0x1001 / 0x1002 and cube-state payload parsing.
 */
const MOYU_V1_CMD_TIME = 1;
const MOYU_V1_CMD_HW = 2;
const MOYU_V1_CMD_BATTERY = 3;
const MOYU_V1_CMD_CUBE_STATE = 10;
const MOYU_V1_CMD_SLEEP = 6;
/** Sticker id 0–5 → center color letter (MoYu face order D,L,B,R,F,U). */
const STICKER_ID_TO_COLOR = 'DLBRFU';
/**
 * Map MoYu face index × cell (0–8) to URFDLB linear facelet index (U 0–8, R 9–17, …)
 */
const MOYU_CELL_TO_STD = [
    [27, 28, 29, 30, 31, 32, 33, 34, 35],
    [44, 43, 42, 41, 40, 39, 38, 37, 36],
    [53, 52, 51, 50, 49, 48, 47, 46, 45],
    [17, 16, 26, 14, 13, 12, 11, 10, 9],
    [29, 25, 24, 23, 22, 21, 20, 19, 18],
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
];
const MOYU_V1_SOLVED_STICKERS = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [2, 2, 2, 2, 2, 2, 2, 2, 2],
    [3, 3, 3, 3, 3, 3, 3, 3, 3],
    [4, 4, 4, 4, 4, 4, 4, 4, 4],
    [5, 5, 5, 5, 5, 5, 5, 5, 5],
];
function parseIncomingPart(dv) {
    const index = dv.getUint8(1) & 15;
    const total = dv.getUint8(1) >> 4;
    const payload = new Uint8Array(dv.buffer, dv.byteOffset + 2, Math.max(0, dv.byteLength - 2));
    return { index, total, payload };
}
function mergeParts(parts) {
    const sorted = [...parts].sort((a, b) => a.index - b.index);
    const len = sorted.reduce((n, p) => n + p.payload.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of sorted) {
        out.set(p.payload, o);
        o += p.payload.length;
    }
    return new DataView(out.buffer);
}
function parseResponse(merged, timestamp) {
    const header = merged.getUint8(0);
    const command = header & 15;
    const success = ((header >> 4) & 1) === 1;
    const id = (header >> 5) & 7;
    const payload = new DataView(merged.buffer, merged.byteOffset + 1, merged.byteLength - 1);
    return { command, success, id, timestamp, payload };
}
function concatU8(a, b) {
    const o = new Uint8Array(a.length + b.length);
    o.set(a);
    o.set(b, a.length);
    return o;
}
class IdGenerator {
    constructor() {
        this.lastId = 0;
    }
    next() {
        this.lastId = (this.lastId + 1) % 8;
        return this.lastId;
    }
}
class SendCountGenerator {
    constructor() {
        this.lastCount = -1;
    }
    next() {
        this.lastCount = (this.lastCount + 1) % 256;
        return this.lastCount;
    }
}
export function moyuV1ParseCubeStatePayload(t) {
    const stickers = [];
    for (let s = 0; s < 6; s++) {
        const r = [];
        for (let a = 0; a < 9; a++) {
            const o = t.getUint8(Math.floor((9 * s + a) / 2));
            r.push((o >> ((9 * s + a) % 2 === 0 ? 0 : 4)) & 15);
        }
        stickers.push(r);
    }
    const angles = [];
    for (let s = 0; s < 6; s++) {
        const row = 27 + Math.floor(s / 2);
        const a = t.getUint8(row);
        angles.push((a >> (s % 2 === 0 ? 0 : 4)) & 15);
    }
    return { stickers, angles };
}
export function moyuV1EncodeCubeStatePayload(stickers, angles) {
    const e = new Uint8Array(30);
    const i = new DataView(e.buffer);
    for (let s = 0; s < 6; s++) {
        for (let r = 0; r < 9; r++) {
            const lo = (9 * s + r) % 2 === 0;
            const o = Math.floor((9 * s + r) / 2);
            i.setUint8(o, i.getUint8(o) | ((15 & stickers[s][r]) << (lo ? 0 : 4)));
        }
    }
    for (let s = 0; s < 6; s++) {
        const lo = s % 2 === 0;
        const row = 27 + Math.floor(s / 2);
        i.setUint8(row, i.getUint8(row) | ((15 & angles[s]) << (lo ? 0 : 4)));
    }
    return e;
}
/** Build 54-char URFDLB facelet string for CubieCube.fromFacelet. */
export function moyuStickersToFaceletString(stickers) {
    const chars = new Array(54).fill('?');
    for (let face = 0; face < 6; face++) {
        const row = MOYU_CELL_TO_STD[face];
        const stickerRow = stickers[face];
        for (let p = 0; p < 9; p++) {
            const id = stickerRow[p] & 15;
            const c = id < 6 ? STICKER_ID_TO_COLOR[id] : '?';
            chars[row[p]] = c;
        }
    }
    return chars.join('');
}
export class MoyuV1Client {
    constructor(writeCharacteristic) {
        this.writeCharacteristic = writeCharacteristic;
        this.idGen = new IdGenerator();
        this.sendCountGen = new SendCountGenerator();
        this.incomplete = [];
        this.waiters = [];
    }
    /** Call from 0x1002 notification handler. */
    onReadNotification(dv) {
        const part = parseIncomingPart(dv);
        this.incomplete.push(part);
        if (part.total <= 0 || part.index !== part.total - 1) {
            return;
        }
        const merged = mergeParts(this.incomplete);
        this.incomplete = [];
        const receivedAt = Date.now();
        const r = parseResponse(merged, receivedAt);
        const idx = this.waiters.findIndex((w) => w.command === r.command && w.id === r.id);
        if (idx < 0) {
            return;
        }
        const w = this.waiters.splice(idx, 1)[0];
        clearTimeout(w.timeout);
        if (!r.success) {
            w.reject(new Error(`MoYu v1 command ${r.command} failed`));
            return;
        }
        w.resolve({ sentAt: w.sentAt, receivedAt, value: r.payload });
    }
    headerByte(command, hasPayload, id) {
        return command | ((hasPayload ? 1 : 0) << 4) | (id << 5);
    }
    async sendRawRequest(body) {
        const nParts = Math.ceil(body.length / 18);
        if (nParts > 16)
            throw new Error('Too many parts');
        for (let i = 0; i < nParts; i++) {
            const frame = new Uint8Array(20);
            const v = new DataView(frame.buffer);
            v.setUint8(0, this.sendCountGen.next());
            v.setUint8(1, i | (nParts << 4));
            const slice = body.subarray(18 * i, 18 * (i + 1));
            frame.set(slice, 2);
            await writeGattCharacteristicValue(this.writeCharacteristic, frame);
        }
        return Date.now();
    }
    async send(command, payload) {
        const id = this.idGen.next();
        const hasPayload = payload !== undefined;
        const h = this.headerByte(command, hasPayload, id);
        const first = new Uint8Array(1);
        new DataView(first.buffer).setUint8(0, h);
        const body = hasPayload && payload !== undefined ? concatU8(first, payload) : first;
        let waiter;
        const result = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const i = this.waiters.findIndex((w) => w.command === command && w.id === id);
                if (i >= 0)
                    this.waiters.splice(i, 1);
                reject(new Error(`MoYu v1 command ${command} timeout`));
            }, 5000);
            waiter = { command, id, sentAt: 0, resolve, reject, timeout };
            this.waiters.push(waiter);
        });
        waiter.sentAt = await this.sendRawRequest(body);
        return result;
    }
    async getCubeState() {
        const r = await this.send(MOYU_V1_CMD_CUBE_STATE);
        return moyuV1ParseCubeStatePayload(r.value);
    }
    async setCubeState(stickers = MOYU_V1_SOLVED_STICKERS, angles = [0, 0, 0, 0, 0, 0]) {
        const pl = moyuV1EncodeCubeStatePayload(stickers, angles);
        await this.send(MOYU_V1_CMD_CUBE_STATE, pl);
    }
    async getBatteryInfo() {
        const r = await this.send(MOYU_V1_CMD_BATTERY);
        const t = r.value;
        return {
            sentAt: r.sentAt,
            receivedAt: r.receivedAt,
            value: {
                charging: !!t.getUint8(0),
                full: !!t.getUint8(1),
                percentage: t.getUint16(2, true),
                voltage: t.getInt32(4, true) / 1000,
            },
        };
    }
    async getHardwareInfo() {
        const r = await this.send(MOYU_V1_CMD_HW);
        const t = r.value;
        return {
            bootCount: t.getUint32(16, true),
            major: t.getUint8(20),
            minor: t.getUint8(21),
            patch: t.getUint16(22, true),
        };
    }
    async getTime() {
        const r = await this.send(MOYU_V1_CMD_TIME);
        const v = r.value;
        return {
            sentAt: r.sentAt,
            receivedAt: r.receivedAt,
            value: { seconds: v.getUint16(0, true), counter: v.getUint16(2, true) },
        };
    }
    async setSleepState(state) {
        const e = new Uint8Array(1);
        new DataView(e.buffer).setUint8(0, state);
        await this.send(MOYU_V1_CMD_SLEEP, e);
    }
}
export { MOYU_V1_SOLVED_STICKERS };
