import { now, toKociembaFacelets } from './utils';
import { GattWriteQueue } from './gan-write-queue';
import { writeGattCharacteristicValue } from './gatt-characteristic-write';
import { Subject } from 'rxjs';
;
/** Calculate sum of all numbers in array */
const sum = arr => arr.reduce((a, v) => a + v, 0);
/**
 * Implementation of classic command/response connection with GAN Smart Cube device
 */
class GanCubeClassicConnection {
    constructor(device, commandCharacteristic, stateCharacteristic, encrypter, driver, validateDecrypted) {
        this.writeQueue = new GattWriteQueue();
        this.disconnectOnce = false;
        this.onStateUpdate = async (evt) => {
            try {
                var characteristic = evt.target;
                var eventMessage = characteristic.value;
                if (!eventMessage || eventMessage.byteLength < 16)
                    return;
                var raw = new Uint8Array(eventMessage.buffer, eventMessage.byteOffset, eventMessage.byteLength);
                var decryptedMessage = this.encrypter.decrypt(raw);
                if (this.validateDecrypted && !this.validateDecrypted(decryptedMessage))
                    return;
                var cubeEvents = await this.driver.handleStateEvent(this, decryptedMessage);
                cubeEvents.forEach(e => this.events$.next(e));
            }
            catch {
                /* ignore corrupt frame */
            }
        };
        this.onDisconnect = async () => {
            if (this.disconnectOnce)
                return;
            this.disconnectOnce = true;
            this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
            this.stateCharacteristic.removeEventListener('characteristicvaluechanged', this.onStateUpdate);
            await this.stateCharacteristic.stopNotifications().catch(() => { });
            if (!this.events$.closed) {
                this.events$.next({ timestamp: now(), type: "DISCONNECT" });
                this.events$.complete();
            }
        };
        this.device = device;
        this.commandCharacteristic = commandCharacteristic;
        this.stateCharacteristic = stateCharacteristic;
        this.encrypter = encrypter;
        this.driver = driver;
        this.validateDecrypted = validateDecrypted;
        this.events$ = new Subject();
    }
    static async create(device, commandCharacteristic, stateCharacteristic, encrypter, driver, options) {
        var conn = new GanCubeClassicConnection(device, commandCharacteristic, stateCharacteristic, encrypter, driver, options?.validateDecrypted);
        conn.device.addEventListener('gattserverdisconnected', conn.onDisconnect);
        conn.stateCharacteristic.addEventListener('characteristicvaluechanged', conn.onStateUpdate);
        await conn.stateCharacteristic.startNotifications();
        return conn;
    }
    get deviceName() {
        return this.device.name || "GAN-XXXX";
    }
    get deviceMAC() {
        return this.device.mac || "00:00:00:00:00:00";
    }
    async sendCommandMessage(message) {
        var encryptedMessage = this.encrypter.encrypt(message);
        return this.writeQueue.enqueue(() => writeGattCharacteristicValue(this.commandCharacteristic, encryptedMessage));
    }
    async sendCubeCommand(command) {
        var commandMessage = this.driver.createCommandMessage(command);
        if (commandMessage) {
            return this.sendCommandMessage(commandMessage);
        }
    }
    async disconnect() {
        await this.onDisconnect();
        if (this.device.gatt?.connected) {
            this.device.gatt?.disconnect();
        }
    }
}
/**
 * View for binary protocol messages allowing to retrieve from message arbitrary length bit words
 */
class GanProtocolMessageView {
    constructor(message) {
        this.bits = Array.from(message).map(byte => (byte + 0x100).toString(2).slice(1)).join('');
    }
    getBitWord(startBit, bitLength, littleEndian = false) {
        if (bitLength <= 8) {
            return parseInt(this.bits.slice(startBit, startBit + bitLength), 2);
        }
        else if (bitLength == 16 || bitLength == 32) {
            let buf = new Uint8Array(bitLength / 8);
            for (let i = 0; i < buf.length; i++) {
                buf[i] = parseInt(this.bits.slice(8 * i + startBit, 8 * i + startBit + 8), 2);
            }
            let dv = new DataView(buf.buffer);
            return bitLength == 16 ? dv.getUint16(0, littleEndian) : dv.getUint32(0, littleEndian);
        }
        else {
            throw new Error('Unsupproted bit word length');
        }
    }
}
/**
 * Driver implementation for GAN Gen2 protocol, supported cubes:
 *  - GAN Mini ui FreePlay
 *  - GAN12 ui FreePlay
 *  - GAN12 ui
 *  - GAN356 i Carry S
 *  - GAN356 i Carry
 *  - GAN356 i 3
 *  - Monster Go 3Ai
 */
class GanGen2ProtocolDriver {
    constructor() {
        this.lastSerial = -1;
        this.lastMoveTimestamp = 0;
        this.cubeTimestamp = 0;
    }
    createCommandMessage(command) {
        var msg = new Uint8Array(20).fill(0);
        switch (command.type) {
            case 'REQUEST_FACELETS':
                msg[0] = 0x04;
                break;
            case 'REQUEST_HARDWARE':
                msg[0] = 0x05;
                break;
            case 'REQUEST_BATTERY':
                msg[0] = 0x09;
                break;
            case 'REQUEST_RESET':
                msg.set([0x0A, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                break;
            default:
                msg = undefined;
        }
        return msg;
    }
    async handleStateEvent(conn, eventMessage) {
        var timestamp = now();
        var cubeEvents = [];
        var msg = new GanProtocolMessageView(eventMessage);
        var eventType = msg.getBitWord(0, 4);
        if (eventType == 0x01) { // GYRO
            // Orientation Quaternion
            let qw = msg.getBitWord(4, 16);
            let qx = msg.getBitWord(20, 16);
            let qy = msg.getBitWord(36, 16);
            let qz = msg.getBitWord(52, 16);
            // Angular Velocity
            let vx = msg.getBitWord(68, 4);
            let vy = msg.getBitWord(72, 4);
            let vz = msg.getBitWord(76, 4);
            cubeEvents.push({
                type: "GYRO",
                timestamp: timestamp,
                quaternion: {
                    x: (1 - (qx >> 15) * 2) * (qx & 0x7FFF) / 0x7FFF,
                    y: (1 - (qy >> 15) * 2) * (qy & 0x7FFF) / 0x7FFF,
                    z: (1 - (qz >> 15) * 2) * (qz & 0x7FFF) / 0x7FFF,
                    w: (1 - (qw >> 15) * 2) * (qw & 0x7FFF) / 0x7FFF
                },
                velocity: {
                    x: (1 - (vx >> 3) * 2) * (vx & 0x7),
                    y: (1 - (vy >> 3) * 2) * (vy & 0x7),
                    z: (1 - (vz >> 3) * 2) * (vz & 0x7)
                }
            });
        }
        else if (eventType == 0x02) { // MOVE
            if (this.lastSerial != -1) { // Accept move events only after first facelets state event received
                let serial = msg.getBitWord(4, 8);
                let diff = Math.min((serial - this.lastSerial) & 0xFF, 7);
                this.lastSerial = serial;
                if (diff > 0) {
                    for (let i = diff - 1; i >= 0; i--) {
                        let face = msg.getBitWord(12 + 5 * i, 4);
                        let direction = msg.getBitWord(16 + 5 * i, 1);
                        let move = "URFDLB".charAt(face) + " '".charAt(direction);
                        let elapsed = msg.getBitWord(47 + 16 * i, 16);
                        if (elapsed == 0) { // In case of 16-bit cube timestamp register overflow
                            elapsed = timestamp - this.lastMoveTimestamp;
                        }
                        this.cubeTimestamp += elapsed;
                        cubeEvents.push({
                            type: "MOVE",
                            serial: (serial - i) & 0xFF,
                            timestamp: timestamp,
                            localTimestamp: i == 0 ? timestamp : null, // Missed and recovered events has no meaningfull local timestamps
                            cubeTimestamp: this.cubeTimestamp,
                            face: face,
                            direction: direction,
                            move: move.trim()
                        });
                    }
                    this.lastMoveTimestamp = timestamp;
                }
            }
        }
        else if (eventType == 0x04) { // FACELETS
            let serial = msg.getBitWord(4, 8);
            if (this.lastSerial == -1)
                this.lastSerial = serial;
            // Corner/Edge Permutation/Orientation
            let cp = [];
            let co = [];
            let ep = [];
            let eo = [];
            // Corners
            for (let i = 0; i < 7; i++) {
                cp.push(msg.getBitWord(12 + i * 3, 3));
                co.push(msg.getBitWord(33 + i * 2, 2));
            }
            cp.push(28 - sum(cp));
            co.push((3 - (sum(co) % 3)) % 3);
            // Edges
            for (let i = 0; i < 11; i++) {
                ep.push(msg.getBitWord(47 + i * 4, 4));
                eo.push(msg.getBitWord(91 + i, 1));
            }
            ep.push(66 - sum(ep));
            eo.push((2 - (sum(eo) % 2)) % 2);
            cubeEvents.push({
                type: "FACELETS",
                serial: serial,
                timestamp: timestamp,
                facelets: toKociembaFacelets(cp, co, ep, eo),
                state: {
                    CP: cp,
                    CO: co,
                    EP: ep,
                    EO: eo
                },
            });
        }
        else if (eventType == 0x05) { // HARDWARE
            let hwMajor = msg.getBitWord(8, 8);
            let hwMinor = msg.getBitWord(16, 8);
            let swMajor = msg.getBitWord(24, 8);
            let swMinor = msg.getBitWord(32, 8);
            let gyroSupported = msg.getBitWord(104, 1);
            let hardwareName = '';
            for (var i = 0; i < 8; i++) {
                hardwareName += String.fromCharCode(msg.getBitWord(i * 8 + 40, 8));
            }
            cubeEvents.push({
                type: "HARDWARE",
                timestamp: timestamp,
                hardwareName: hardwareName,
                hardwareVersion: `${hwMajor}.${hwMinor}`,
                softwareVersion: `${swMajor}.${swMinor}`,
                gyroSupported: !!gyroSupported
            });
        }
        else if (eventType == 0x09) { // BATTERY
            let batteryLevel = msg.getBitWord(8, 8);
            cubeEvents.push({
                type: "BATTERY",
                timestamp: timestamp,
                batteryLevel: Math.min(batteryLevel, 100)
            });
        }
        else if (eventType == 0x0D) { // DISCONNECT
            console.warn("[smartcube] cube sent DISCONNECT event (Gen2 0x0D)");
            conn.disconnect();
        }
        return cubeEvents;
    }
}
/**
 * Driver implementation for GAN Gen3 protocol, supported cubes:
 *  - GAN356 i Carry 2
 */
class GanGen3ProtocolDriver {
    constructor() {
        this.serial = -1;
        this.lastSerial = -1;
        this.lastLocalTimestamp = null;
        this.moveBuffer = [];
    }
    createCommandMessage(command) {
        var msg = new Uint8Array(16).fill(0);
        switch (command.type) {
            case 'REQUEST_FACELETS':
                msg.set([0x68, 0x01]);
                break;
            case 'REQUEST_HARDWARE':
                msg.set([0x68, 0x04]);
                break;
            case 'REQUEST_BATTERY':
                msg.set([0x68, 0x07]);
                break;
            case 'REQUEST_RESET':
                msg.set([0x68, 0x05, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0x00, 0x00, 0x00]);
                break;
            default:
                msg = undefined;
        }
        return msg;
    }
    /** Private cube command for requesting move history */
    async requestMoveHistory(conn, serial, count) {
        var msg = new Uint8Array(16).fill(0);
        // Move history response data is byte-aligned, and moves always starting with near-ceil odd serial number, regardless of requested.
        // Adjust serial and count to get odd serial aligned history window with even number of moves inside.
        if (serial % 2 == 0)
            serial = (serial - 1) & 0xFF;
        if (count % 2 == 1)
            count++;
        // Never overflow requested history window beyond the serial number cycle edge 255 -> 0.
        // Because due to iCarry2 firmware bug the moves beyond the edge will be spoofed with 'D' (just zero bytes).
        count = Math.min(count, serial + 1);
        msg.set([0x68, 0x03, serial, 0, count, 0]);
        return conn.sendCommandMessage(msg).catch(() => {
            // We can safely suppress and ignore possible GATT write errors, requestMoveHistory command is automatically retried on next move event
        });
    }
    /**
     * Evict move events from FIFO buffer until missing move event detected
     * In case of missing move, and if connection is provided, submit request for move history to fill gap in buffer
     */
    async evictMoveBuffer(conn) {
        var evictedEvents = [];
        while (this.moveBuffer.length > 0) {
            let bufferHead = this.moveBuffer[0];
            let diff = this.lastSerial == -1 ? 1 : (bufferHead.serial - this.lastSerial) & 0xFF;
            if (diff > 1) {
                if (conn) {
                    await this.requestMoveHistory(conn, bufferHead.serial, diff);
                }
                break;
            }
            else {
                evictedEvents.push(this.moveBuffer.shift());
                this.lastSerial = bufferHead.serial;
            }
        }
        // Buffer can no longer be evicted (missing moves the cube can't replay). Instead of dropping
        // the whole BLE connection (which surfaced as "cube disconnects on a turn"), resync locally:
        // clear the stuck buffer and realign the serial. The next periodic FACELETS event re-establishes
        // the authoritative cube state, so no moves are truly lost for detection.
        if (this.moveBuffer.length > 16) {
            console.warn("[smartcube] move buffer overflow — resyncing instead of disconnecting");
            this.moveBuffer = [];
            this.lastSerial = this.serial;
        }
        return evictedEvents;
    }
    /**
     * Check if circular serial number (modulo 256) fits into (start,end) serial number range.
     * By default range is open, set closedStart / closedEnd to make it closed.
     */
    isSerialInRange(start, end, serial, closedStart = false, closedEnd = false) {
        return ((end - start) & 0xFF) >= ((serial - start) & 0xFF)
            && (closedStart || ((start - serial) & 0xFF) > 0)
            && (closedEnd || ((end - serial) & 0xFF) > 0);
    }
    /** Used to inject missed moves to FIFO buffer */
    injectMissedMoveToBuffer(move) {
        if (move.type == "MOVE") {
            if (this.moveBuffer.length > 0) {
                var bufferHead = this.moveBuffer[0];
                // Skip if move event with the same serial already in the buffer
                if (this.moveBuffer.some(e => e.type == "MOVE" && e.serial == move.serial))
                    return;
                // Skip if move serial does not fit in range between last evicted event and event on buffer head, i.e. event must be one of missed
                if (!this.isSerialInRange(this.lastSerial, bufferHead.serial, move.serial))
                    return;
                // Move history events should be injected in reverse order, so just put suitable event on buffer head
                if (move.serial == ((bufferHead.serial - 1) & 0xFF)) {
                    this.moveBuffer.unshift(move);
                }
            }
            else {
                // This case happens when lost move is recovered using periodic 
                // facelets state event, and being inserted into the empty buffer.
                if (this.isSerialInRange(this.lastSerial, this.serial, move.serial, false, true)) {
                    this.moveBuffer.unshift(move);
                }
            }
        }
    }
    /** Used in response to periodic facelets event to check if any moves missed */
    async checkIfMoveMissed(conn) {
        let diff = (this.serial - this.lastSerial) & 0xFF;
        if (diff > 0) {
            if (this.serial != 0) { // Constraint to avoid iCarry2 firmware bug with facelets state event at 255 move counter
                let bufferHead = this.moveBuffer[0];
                let startSerial = bufferHead ? bufferHead.serial : (this.serial + 1) & 0xFF;
                await this.requestMoveHistory(conn, startSerial, diff + 1);
            }
        }
    }
    async handleStateEvent(conn, eventMessage) {
        var timestamp = now();
        var cubeEvents = [];
        var msg = new GanProtocolMessageView(eventMessage);
        var magic = msg.getBitWord(0, 8);
        var eventType = msg.getBitWord(8, 8);
        var dataLength = msg.getBitWord(16, 8);
        if (magic == 0x55 && dataLength > 0) {
            if (eventType == 0x01) { // MOVE
                if (this.lastSerial != -1) { // Accept move events only after first facelets state event received
                    this.lastLocalTimestamp = timestamp;
                    let cubeTimestamp = msg.getBitWord(24, 32, true);
                    let serial = this.serial = msg.getBitWord(56, 16, true);
                    let direction = msg.getBitWord(72, 2);
                    let face = [2, 32, 8, 1, 16, 4].indexOf(msg.getBitWord(74, 6));
                    let move = "URFDLB".charAt(face) + " '".charAt(direction);
                    // put move event into FIFO buffer
                    if (face >= 0) {
                        this.moveBuffer.push({
                            type: "MOVE",
                            serial: serial,
                            timestamp: timestamp,
                            localTimestamp: timestamp,
                            cubeTimestamp: cubeTimestamp,
                            face: face,
                            direction: direction,
                            move: move.trim()
                        });
                    }
                    // evict move events from FIFO buffer
                    cubeEvents = await this.evictMoveBuffer(conn);
                }
            }
            else if (eventType == 0x06) { // MOVE_HISTORY
                let startSerial = msg.getBitWord(24, 8);
                let count = (dataLength - 1) * 2;
                // inject missed moves into FIFO buffer
                for (let i = 0; i < count; i++) {
                    let face = [1, 5, 3, 0, 4, 2].indexOf(msg.getBitWord(32 + 4 * i, 3));
                    let direction = msg.getBitWord(35 + 4 * i, 1);
                    if (face >= 0) {
                        let move = "URFDLB".charAt(face) + " '".charAt(direction);
                        this.injectMissedMoveToBuffer({
                            type: "MOVE",
                            serial: (startSerial - i) & 0xFF,
                            timestamp: timestamp,
                            localTimestamp: null, // Missed and recovered events has no meaningfull local timestamps
                            cubeTimestamp: null, // Cube hardware timestamp for missed move you should interpolate using cubeTimestampLinearFit
                            face: face,
                            direction: direction,
                            move: move.trim()
                        });
                    }
                }
                // evict move events from FIFO buffer
                cubeEvents = await this.evictMoveBuffer();
            }
            else if (eventType == 0x02) { // FACELETS
                let serial = this.serial = msg.getBitWord(24, 16, true);
                // Also check and recovery missed moves using periodic facelets event sent by cube
                if (this.lastSerial != -1) {
                    // Debounce the facelet event if there are active cube moves
                    if (this.lastLocalTimestamp != null && (timestamp - this.lastLocalTimestamp) > 500) {
                        await this.checkIfMoveMissed(conn);
                    }
                }
                if (this.lastSerial == -1)
                    this.lastSerial = serial;
                // Corner/Edge Permutation/Orientation
                let cp = [];
                let co = [];
                let ep = [];
                let eo = [];
                // Corners
                for (let i = 0; i < 7; i++) {
                    cp.push(msg.getBitWord(40 + i * 3, 3));
                    co.push(msg.getBitWord(61 + i * 2, 2));
                }
                cp.push(28 - sum(cp));
                co.push((3 - (sum(co) % 3)) % 3);
                // Edges
                for (let i = 0; i < 11; i++) {
                    ep.push(msg.getBitWord(77 + i * 4, 4));
                    eo.push(msg.getBitWord(121 + i, 1));
                }
                ep.push(66 - sum(ep));
                eo.push((2 - (sum(eo) % 2)) % 2);
                cubeEvents.push({
                    type: "FACELETS",
                    serial: serial,
                    timestamp: timestamp,
                    facelets: toKociembaFacelets(cp, co, ep, eo),
                    state: {
                        CP: cp,
                        CO: co,
                        EP: ep,
                        EO: eo
                    },
                });
            }
            else if (eventType == 0x07) { // HARDWARE
                let swMajor = msg.getBitWord(72, 4);
                let swMinor = msg.getBitWord(76, 4);
                let hwMajor = msg.getBitWord(80, 4);
                let hwMinor = msg.getBitWord(84, 4);
                let hardwareName = '';
                for (var i = 0; i < 5; i++) {
                    hardwareName += String.fromCharCode(msg.getBitWord(i * 8 + 32, 8));
                }
                cubeEvents.push({
                    type: "HARDWARE",
                    timestamp: timestamp,
                    hardwareName: hardwareName,
                    hardwareVersion: `${hwMajor}.${hwMinor}`,
                    softwareVersion: `${swMajor}.${swMinor}`,
                    gyroSupported: false
                });
            }
            else if (eventType == 0x10) { // BATTERY
                let batteryLevel = msg.getBitWord(24, 8);
                cubeEvents.push({
                    type: "BATTERY",
                    timestamp: timestamp,
                    batteryLevel: Math.min(batteryLevel, 100)
                });
            }
            else if (eventType == 0x11) { // DISCONNECT
                console.warn("[smartcube] cube sent DISCONNECT event (Gen3 0x11)");
                conn.disconnect();
            }
        }
        return cubeEvents;
    }
}
/**
 * Driver implementation for GAN Gen4 protocol, supported cubes:
 *  - GAN12 ui Maglev
 *  - GAN14 ui FreePlay
 */
class GanGen4ProtocolDriver {
    constructor() {
        this.serial = -1;
        this.lastSerial = -1;
        this.lastLocalTimestamp = null;
        this.moveBuffer = [];
        // Used to store partial result acquired from hardware info events
        this.hwInfo = {};
        /** Set when we have seen at least one 0xEC GYRO packet this connection (not cleared on REQUEST_HARDWARE). */
        this.gyroObserved = false;
        /** Set when a full HARDWARE snapshot was emitted for the current hwInfo assembly; reset when REQUEST_HARDWARE clears hwInfo. */
        this.hardwareInfoEmitted = false;
    }
    createCommandMessage(command) {
        var msg = new Uint8Array(20).fill(0);
        switch (command.type) {
            case 'REQUEST_FACELETS':
                msg.set([0xDD, 0x04, 0x00, 0xED, 0x00, 0x00]);
                break;
            case 'REQUEST_HARDWARE':
                this.hwInfo = {};
                this.hardwareInfoEmitted = false;
                msg.set([0xDF, 0x03, 0x00, 0x00, 0x00]);
                break;
            case 'REQUEST_BATTERY':
                msg.set([0xDD, 0x04, 0x00, 0xEF, 0x00, 0x00]);
                break;
            case 'REQUEST_RESET':
                msg.set([0xD2, 0x0D, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0x00, 0x00, 0x00]);
                break;
            default:
                msg = undefined;
        }
        return msg;
    }
    buildHardwareEvent(timestamp) {
        return {
            type: "HARDWARE",
            timestamp: timestamp,
            hardwareName: this.hwInfo[0xFC],
            hardwareVersion: this.hwInfo[0xFE],
            softwareVersion: this.hwInfo[0xFD],
            productDate: this.hwInfo[0xFA],
            gyroSupported: this.gyroObserved
        };
    }
    /** Private cube command for requesting move history */
    async requestMoveHistory(conn, serial, count) {
        var msg = new Uint8Array(20).fill(0);
        // Move history response data is byte-aligned, and moves always starting with near-ceil odd serial number, regardless of requested.
        // Adjust serial and count to get odd serial aligned history window with even number of moves inside.
        if (serial % 2 == 0)
            serial = (serial - 1) & 0xFF;
        if (count % 2 == 1)
            count++;
        // Never overflow requested history window beyond the serial number cycle edge 255 -> 0.
        // Because due to firmware bug the moves beyond the edge will be spoofed with 'D' (just zero bytes).
        count = Math.min(count, serial + 1);
        msg.set([0xD1, 0x04, serial, 0, count, 0]);
        return conn.sendCommandMessage(msg).catch(() => {
            // We can safely suppress and ignore possible GATT write errors, requestMoveHistory command is automatically retried on next move event
        });
    }
    /**
     * Evict move events from FIFO buffer until missing move event detected
     * In case of missing move, and if connection is provided, submit request for move history to fill gap in buffer
     */
    async evictMoveBuffer(conn) {
        var evictedEvents = [];
        while (this.moveBuffer.length > 0) {
            let bufferHead = this.moveBuffer[0];
            let diff = this.lastSerial == -1 ? 1 : (bufferHead.serial - this.lastSerial) & 0xFF;
            if (diff > 1) {
                if (conn) {
                    await this.requestMoveHistory(conn, bufferHead.serial, diff);
                }
                break;
            }
            else {
                evictedEvents.push(this.moveBuffer.shift());
                this.lastSerial = bufferHead.serial;
            }
        }
        // Buffer can no longer be evicted (missing moves the cube can't replay). Instead of dropping
        // the whole BLE connection (which surfaced as "cube disconnects on a turn"), resync locally:
        // clear the stuck buffer and realign the serial. The next periodic FACELETS event re-establishes
        // the authoritative cube state, so no moves are truly lost for detection.
        if (this.moveBuffer.length > 16) {
            console.warn("[smartcube] move buffer overflow — resyncing instead of disconnecting");
            this.moveBuffer = [];
            this.lastSerial = this.serial;
        }
        return evictedEvents;
    }
    /**
     * Check if circular serial number (modulo 256) fits into (start,end) serial number range.
     * By default range is open, set closedStart / closedEnd to make it closed.
     */
    isSerialInRange(start, end, serial, closedStart = false, closedEnd = false) {
        return ((end - start) & 0xFF) >= ((serial - start) & 0xFF)
            && (closedStart || ((start - serial) & 0xFF) > 0)
            && (closedEnd || ((end - serial) & 0xFF) > 0);
    }
    /** Used to inject missed moves to FIFO buffer */
    injectMissedMoveToBuffer(move) {
        if (move.type == "MOVE") {
            if (this.moveBuffer.length > 0) {
                var bufferHead = this.moveBuffer[0];
                // Skip if move event with the same serial already in the buffer
                if (this.moveBuffer.some(e => e.type == "MOVE" && e.serial == move.serial))
                    return;
                // Skip if move serial does not fit in range between last evicted event and event on buffer head, i.e. event must be one of missed
                if (!this.isSerialInRange(this.lastSerial, bufferHead.serial, move.serial))
                    return;
                // Move history events should be injected in reverse order, so just put suitable event on buffer head
                if (move.serial == ((bufferHead.serial - 1) & 0xFF)) {
                    this.moveBuffer.unshift(move);
                }
            }
            else {
                // This case happens when lost move is recovered using periodic 
                // facelets state event, and being inserted into the empty buffer.
                if (this.isSerialInRange(this.lastSerial, this.serial, move.serial, false, true)) {
                    this.moveBuffer.unshift(move);
                }
            }
        }
    }
    /** Used in response to periodic facelets event to check if any moves missed */
    async checkIfMoveMissed(conn) {
        let diff = (this.serial - this.lastSerial) & 0xFF;
        if (diff > 0) {
            if (this.serial != 0) { // Constraint to avoid firmware bug with facelets state event at 255 move counter
                let bufferHead = this.moveBuffer[0];
                let startSerial = bufferHead ? bufferHead.serial : (this.serial + 1) & 0xFF;
                await this.requestMoveHistory(conn, startSerial, diff + 1);
            }
        }
    }
    async handleStateEvent(conn, eventMessage) {
        var timestamp = now();
        var cubeEvents = [];
        var msg = new GanProtocolMessageView(eventMessage);
        var eventType = msg.getBitWord(0, 8);
        var dataLength = msg.getBitWord(8, 8);
        if (eventType == 0x01) { // MOVE
            if (this.lastSerial != -1) { // Accept move events only after first facelets state event received
                let cubeTimestamp = msg.getBitWord(16, 32, true);
                let serial = this.serial = msg.getBitWord(48, 16, true);
                let direction = msg.getBitWord(64, 2);
                let face = [2, 32, 8, 1, 16, 4].indexOf(msg.getBitWord(66, 6));
                let move = "URFDLB".charAt(face) + " '".charAt(direction);
                if (face >= 0) {
                    this.moveBuffer.push({
                        type: "MOVE",
                        serial: serial,
                        timestamp: timestamp,
                        localTimestamp: timestamp,
                        cubeTimestamp: cubeTimestamp,
                        face: face,
                        direction: direction,
                        move: move.trim()
                    });
                    this.lastLocalTimestamp = timestamp;
                }
                // evict move events from FIFO buffer
                cubeEvents = await this.evictMoveBuffer(conn);
            }
        }
        else if (eventType == 0xD1) { // MOVE_HISTORY
            let startSerial = msg.getBitWord(16, 8);
            let count = (dataLength - 1) * 2;
            // inject missed moves into FIFO buffer
            for (let i = 0; i < count; i++) {
                let face = [1, 5, 3, 0, 4, 2].indexOf(msg.getBitWord(24 + 4 * i, 3));
                let direction = msg.getBitWord(27 + 4 * i, 1);
                if (face >= 0) {
                    let move = "URFDLB".charAt(face) + " '".charAt(direction);
                    this.injectMissedMoveToBuffer({
                        type: "MOVE",
                        serial: (startSerial - i) & 0xFF,
                        timestamp: timestamp,
                        localTimestamp: null, // Missed and recovered events has no meaningfull local timestamps
                        cubeTimestamp: null, // Cube hardware timestamp for missed move you should interpolate using cubeTimestampLinearFit
                        face: face,
                        direction: direction,
                        move: move.trim()
                    });
                }
            }
            // evict move events from FIFO buffer
            cubeEvents = await this.evictMoveBuffer();
        }
        else if (eventType == 0xED) { // FACELETS
            let serial = this.serial = msg.getBitWord(16, 16, true);
            // Also check and recovery missed moves using periodic facelets event sent by cube
            if (this.lastSerial != -1) {
                // Debounce the facelet event if there are active cube moves
                if (this.lastLocalTimestamp != null && (timestamp - this.lastLocalTimestamp) > 500) {
                    await this.checkIfMoveMissed(conn);
                }
            }
            if (this.lastSerial == -1)
                this.lastSerial = serial;
            // Corner/Edge Permutation/Orientation
            let cp = [];
            let co = [];
            let ep = [];
            let eo = [];
            // Corners
            for (let i = 0; i < 7; i++) {
                cp.push(msg.getBitWord(32 + i * 3, 3));
                co.push(msg.getBitWord(53 + i * 2, 2));
            }
            cp.push(28 - sum(cp));
            co.push((3 - (sum(co) % 3)) % 3);
            // Edges
            for (let i = 0; i < 11; i++) {
                ep.push(msg.getBitWord(69 + i * 4, 4));
                eo.push(msg.getBitWord(113 + i, 1));
            }
            ep.push(66 - sum(ep));
            eo.push((2 - (sum(eo) % 2)) % 2);
            cubeEvents.push({
                type: "FACELETS",
                serial: serial,
                timestamp: timestamp,
                facelets: toKociembaFacelets(cp, co, ep, eo),
                state: {
                    CP: cp,
                    CO: co,
                    EP: ep,
                    EO: eo
                },
            });
        }
        else if (eventType >= 0xFA && eventType <= 0xFE) { // HARDWARE
            switch (eventType) {
                case 0xFA: // Product Date
                    let year = msg.getBitWord(24, 16, true);
                    let month = msg.getBitWord(40, 8);
                    let day = msg.getBitWord(48, 8);
                    this.hwInfo[eventType] = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                    break;
                case 0xFC: // Hardware Name
                    this.hwInfo[eventType] = '';
                    for (var i = 0; i < dataLength - 1; i++) {
                        this.hwInfo[eventType] += String.fromCharCode(msg.getBitWord(i * 8 + 24, 8));
                    }
                    break;
                case 0xFD: // Software Version
                    let swMajor = msg.getBitWord(24, 4);
                    let swMinor = msg.getBitWord(28, 4);
                    this.hwInfo[eventType] = `${swMajor}.${swMinor}`;
                    break;
                case 0xFE: // Hardware Version
                    let hwMajor = msg.getBitWord(24, 4);
                    let hwMinor = msg.getBitWord(28, 4);
                    this.hwInfo[eventType] = `${hwMajor}.${hwMinor}`;
                    break;
            }
            if (Object.keys(this.hwInfo).length == 4) { // All fields are populated
                this.hardwareInfoEmitted = true;
                cubeEvents.push(this.buildHardwareEvent(timestamp));
            }
        }
        else if (eventType == 0xEC) { // GYRO
            const firstGyroThisSession = !this.gyroObserved;
            this.gyroObserved = true;
            // Orientation Quaternion
            let qw = msg.getBitWord(16, 16);
            let qx = msg.getBitWord(32, 16);
            let qy = msg.getBitWord(48, 16);
            let qz = msg.getBitWord(64, 16);
            // Angular Velocity
            let vx = msg.getBitWord(80, 4);
            let vy = msg.getBitWord(84, 4);
            let vz = msg.getBitWord(88, 4);
            cubeEvents.push({
                type: "GYRO",
                timestamp: timestamp,
                quaternion: {
                    x: (1 - (qx >> 15) * 2) * (qx & 0x7FFF) / 0x7FFF,
                    y: (1 - (qy >> 15) * 2) * (qy & 0x7FFF) / 0x7FFF,
                    z: (1 - (qz >> 15) * 2) * (qz & 0x7FFF) / 0x7FFF,
                    w: (1 - (qw >> 15) * 2) * (qw & 0x7FFF) / 0x7FFF
                },
                velocity: {
                    x: (1 - (vx >> 3) * 2) * (vx & 0x7),
                    y: (1 - (vy >> 3) * 2) * (vy & 0x7),
                    z: (1 - (vz >> 3) * 2) * (vz & 0x7)
                }
            });
            if (firstGyroThisSession && this.hardwareInfoEmitted && Object.keys(this.hwInfo).length == 4) {
                cubeEvents.push(this.buildHardwareEvent(timestamp));
            }
        }
        else if (eventType == 0xEF) { // BATTERY
            let batteryLevel = msg.getBitWord(8 + dataLength * 8, 8);
            cubeEvents.push({
                type: "BATTERY",
                timestamp: timestamp,
                batteryLevel: Math.min(batteryLevel, 100)
            });
        }
        else if (eventType == 0xEA) { // DISCONNECT
            console.warn("[smartcube] cube sent DISCONNECT event (Gen4 0xEA)");
            conn.disconnect();
        }
        return cubeEvents;
    }
}
export { GanCubeClassicConnection, GanGen2ProtocolDriver, GanGen3ProtocolDriver, GanGen4ProtocolDriver };
