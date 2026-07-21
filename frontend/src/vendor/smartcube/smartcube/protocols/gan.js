import { Subject } from 'rxjs';
import { normalizeUuid } from '../attachment/normalize-uuid';
import { getCachedMacForDevice, macFromGanManufacturerData, waitForManufacturerData } from '../attachment/address-hints';
import { registerProtocol } from '../protocol';
import * as def from '../../gan-cube-definitions';
import { GanGen2CubeEncrypter, GanGen3CubeEncrypter, GanGen4CubeEncrypter } from '../../gan-cube-encrypter';
import { GanGen1CubeConnection } from '../../gan-gen1';
import { macStringToSaltOrThrow } from '../../gan-mac-salt';
import { isValidGanGen2Packet, isValidGanGen3Packet, isValidGanGen4Packet, } from '../../gan-gen234-packet-validate';
import { GanCubeClassicConnection, GanGen2ProtocolDriver, GanGen3ProtocolDriver, GanGen4ProtocolDriver } from '../../gan-cube-protocol';
const DEFAULT_GAN_CAPABILITIES = {
    gyroscope: true,
    battery: true,
    facelets: true,
    hardware: true,
    reset: true,
};
const GAN_GEN1_CAPABILITIES = {
    gyroscope: true,
    battery: true,
    facelets: true,
    hardware: false,
    reset: false,
};
const GAN_GEN1_PROTOCOL = { id: 'gan-gen1', name: 'GAN Gen1' };
const GAN_GEN2_PROTOCOL = { id: 'gan-gen2', name: 'GAN Gen2' };
const GAN_GEN3_PROTOCOL = { id: 'gan-gen3', name: 'GAN Gen3' };
const GAN_GEN4_PROTOCOL = { id: 'gan-gen4', name: 'GAN Gen4' };
function ganEventToSmartEvent(event) {
    switch (event.type) {
        case "MOVE":
            return {
                timestamp: event.timestamp,
                type: "MOVE",
                face: event.face,
                direction: event.direction,
                move: event.move,
                localTimestamp: event.localTimestamp,
                cubeTimestamp: event.cubeTimestamp
            };
        case "FACELETS":
            return {
                timestamp: event.timestamp,
                type: "FACELETS",
                facelets: event.facelets
            };
        case "GYRO":
            return {
                timestamp: event.timestamp,
                type: "GYRO",
                quaternion: event.quaternion,
                velocity: event.velocity
            };
        case "BATTERY":
            return {
                timestamp: event.timestamp,
                type: "BATTERY",
                batteryLevel: event.batteryLevel
            };
        case "HARDWARE":
            return {
                timestamp: event.timestamp,
                type: "HARDWARE",
                hardwareName: event.hardwareName,
                softwareVersion: event.softwareVersion,
                hardwareVersion: event.hardwareVersion,
                productDate: event.productDate,
                gyroSupported: event.gyroSupported
            };
        case "DISCONNECT":
            return {
                timestamp: event.timestamp,
                type: "DISCONNECT"
            };
    }
}
function hasGanGen1Profile(serviceUuids) {
    const primary = normalizeUuid(def.GAN_GEN1_PRIMARY_SERVICE);
    const deviceInfo = normalizeUuid(def.GAN_GEN1_DEVICE_INFO_SERVICE);
    return serviceUuids.has(primary) && serviceUuids.has(deviceInfo);
}
class GanSmartCubeConnection {
    constructor(ganConn, mac, protocol, capabilities) {
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.ganConn = ganConn;
        this.deviceMac = mac;
        this.protocol = protocol;
        const base = capabilities ? { ...capabilities } : { ...DEFAULT_GAN_CAPABILITIES };
        if (!capabilities && ganConn.deviceName?.startsWith('AiCube')) {
            base.gyroscope = false;
        }
        this.capabilities = base;
        this.events$ = new Subject();
        ganConn.events$.subscribe({
            next: (event) => {
                if (event.type === 'HARDWARE' &&
                    this.protocol.id === 'gan-gen2' &&
                    typeof event.gyroSupported === 'boolean') {
                    this.capabilities.gyroscope = event.gyroSupported;
                }
                if (event.type === 'BATTERY') {
                    const batteryLevel = Math.min(100, Math.max(0, Math.round(event.batteryLevel)));
                    const forceEmission = this.forceNextBatteryEmission;
                    this.forceNextBatteryEmission = false;
                    if (!forceEmission && this.lastBatteryLevel === batteryLevel) {
                        return;
                    }
                    this.lastBatteryLevel = batteryLevel;
                    this.events$.next({
                        timestamp: event.timestamp,
                        type: 'BATTERY',
                        batteryLevel,
                    });
                    return;
                }
                this.events$.next(ganEventToSmartEvent(event));
            },
            complete: () => this.events$.complete(),
        });
    }
    get deviceName() {
        return this.ganConn.deviceName;
    }
    get deviceMAC() {
        return this.deviceMac;
    }
    async sendCommand(command) {
        if (command.type === 'REQUEST_BATTERY') {
            this.forceNextBatteryEmission = true;
        }
        return this.ganConn.sendCubeCommand(command);
    }
    async disconnect() {
        this.forceNextBatteryEmission = false;
        return this.ganConn.disconnect();
    }
}
async function connectGanDevice(device, macProvider, context) {
    const bleDevice = device;
    const gatt = device.gatt;
    if (!gatt.connected) {
        await gatt.connect();
    }
    const services = await gatt.getPrimaryServices();
    const serviceUuidSet = new Set(services.map((s) => normalizeUuid(s.uuid)));
    if (hasGanGen1Profile(serviceUuidSet)) {
        const gen1Conn = await GanGen1CubeConnection.create(device);
        return new GanSmartCubeConnection(gen1Conn, '', GAN_GEN1_PROTOCOL, GAN_GEN1_CAPABILITIES);
    }
    let mac = null;
    if (context?.advertisementManufacturerData) {
        mac = macFromGanManufacturerData(context.advertisementManufacturerData);
    }
    mac = mac || getCachedMacForDevice(device);
    if (!mac && macProvider) {
        const r = await macProvider(device, false);
        if (r) {
            mac = r;
        }
    }
    if (!mac) {
        const mf = await waitForManufacturerData(device, 5000);
        if (mf) {
            mac = macFromGanManufacturerData(mf);
        }
    }
    if (!mac && macProvider) {
        const r = await macProvider(device, true);
        if (r) {
            mac = r;
        }
    }
    if (!mac) {
        throw new Error('Unable to determine cube MAC address, connection is not possible!');
    }
    bleDevice.mac = mac;
    const salt = macStringToSaltOrThrow(mac);
    const g2 = normalizeUuid(def.GAN_GEN2_SERVICE);
    const g3 = normalizeUuid(def.GAN_GEN3_SERVICE);
    const g4 = normalizeUuid(def.GAN_GEN4_SERVICE);
    let pick = null;
    if (serviceUuidSet.has(g2))
        pick = 'g2';
    else if (serviceUuidSet.has(g3))
        pick = 'g3';
    else if (serviceUuidSet.has(g4))
        pick = 'g4';
    let ganConn = null;
    if (pick === 'g2') {
        const service = await gatt.getPrimaryService(def.GAN_GEN2_SERVICE);
        const commandCharacteristic = await service.getCharacteristic(def.GAN_GEN2_COMMAND_CHARACTERISTIC);
        const stateCharacteristic = await service.getCharacteristic(def.GAN_GEN2_STATE_CHARACTERISTIC);
        const key = device.name?.startsWith('AiCube') ? def.GAN_ENCRYPTION_KEYS[1] : def.GAN_ENCRYPTION_KEYS[0];
        const encrypter = new GanGen2CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        const driver = new GanGen2ProtocolDriver();
        ganConn = await GanCubeClassicConnection.create(bleDevice, commandCharacteristic, stateCharacteristic, encrypter, driver, { validateDecrypted: isValidGanGen2Packet });
    }
    else if (pick === 'g3') {
        const service = await gatt.getPrimaryService(def.GAN_GEN3_SERVICE);
        const commandCharacteristic = await service.getCharacteristic(def.GAN_GEN3_COMMAND_CHARACTERISTIC);
        const stateCharacteristic = await service.getCharacteristic(def.GAN_GEN3_STATE_CHARACTERISTIC);
        const key = def.GAN_ENCRYPTION_KEYS[0];
        const encrypter = new GanGen3CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        const driver = new GanGen3ProtocolDriver();
        ganConn = await GanCubeClassicConnection.create(bleDevice, commandCharacteristic, stateCharacteristic, encrypter, driver, { validateDecrypted: isValidGanGen3Packet });
    }
    else if (pick === 'g4') {
        const service = await gatt.getPrimaryService(def.GAN_GEN4_SERVICE);
        const commandCharacteristic = await service.getCharacteristic(def.GAN_GEN4_COMMAND_CHARACTERISTIC);
        const stateCharacteristic = await service.getCharacteristic(def.GAN_GEN4_STATE_CHARACTERISTIC);
        const key = def.GAN_ENCRYPTION_KEYS[0];
        const encrypter = new GanGen4CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        const driver = new GanGen4ProtocolDriver();
        ganConn = await GanCubeClassicConnection.create(bleDevice, commandCharacteristic, stateCharacteristic, encrypter, driver, { validateDecrypted: isValidGanGen4Packet });
    }
    if (!ganConn) {
        throw new Error("Can't find target BLE services - wrong or unsupported cube device model");
    }
    return new GanSmartCubeConnection(ganConn, mac, pick === 'g2' ? GAN_GEN2_PROTOCOL : pick === 'g3' ? GAN_GEN3_PROTOCOL : GAN_GEN4_PROTOCOL);
}
const ganProtocol = {
    nameFilters: [{ namePrefix: 'GAN' }, { namePrefix: 'MG' }, { namePrefix: 'AiCube' }],
    optionalServices: [
        def.GAN_GEN1_PRIMARY_SERVICE,
        def.GAN_GEN1_DEVICE_INFO_SERVICE,
        def.GAN_GEN2_SERVICE,
        def.GAN_GEN3_SERVICE,
        def.GAN_GEN4_SERVICE,
    ],
    optionalManufacturerData: def.GAN_CIC_LIST,
    matchesDevice(device) {
        const name = device.name || '';
        return name.startsWith('GAN') || name.startsWith('MG') || name.startsWith('AiCube');
    },
    gattAffinity(serviceUuids, _device) {
        const g2 = normalizeUuid(def.GAN_GEN2_SERVICE);
        const g3 = normalizeUuid(def.GAN_GEN3_SERVICE);
        const g4 = normalizeUuid(def.GAN_GEN4_SERVICE);
        const g1Primary = normalizeUuid(def.GAN_GEN1_PRIMARY_SERVICE);
        const deviceInfo = normalizeUuid(def.GAN_GEN1_DEVICE_INFO_SERVICE);
        const bonus = serviceUuids.has(deviceInfo) ? 5 : 0;
        if (serviceUuids.has(g1Primary) && serviceUuids.has(deviceInfo)) {
            return 125 + bonus;
        }
        if (serviceUuids.has(g4)) {
            return 120 + bonus;
        }
        if (serviceUuids.has(g3)) {
            return 120 + bonus;
        }
        if (serviceUuids.has(g2)) {
            return 120 + bonus;
        }
        return 0;
    },
    connect: connectGanDevice
};
registerProtocol(ganProtocol);
export { ganProtocol };
