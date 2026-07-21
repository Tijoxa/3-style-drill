import { now } from '../utils';
function toUuid128(uuid) {
    if (/^[0-9A-Fa-f]{4}$/.exec(uuid)) {
        uuid = "0000" + uuid + "-0000-1000-8000-00805F9B34FB";
    }
    return uuid.toUpperCase();
}
function findCharacteristic(characteristics, uuid) {
    const targetUuid = toUuid128(uuid);
    for (const chrct of characteristics) {
        if (toUuid128(chrct.uuid) === targetUuid) {
            return chrct;
        }
    }
    return null;
}
async function waitForAdvertisements(device, timeoutMs = 5000) {
    if (typeof device.watchAdvertisements !== 'function') {
        return null;
    }
    return new Promise((resolve) => {
        const abortController = new AbortController();
        const onAdvEvent = (evt) => {
            device.removeEventListener('advertisementreceived', onAdvEvent);
            abortController.abort();
            resolve(evt.manufacturerData);
        };
        const onAbort = () => {
            device.removeEventListener('advertisementreceived', onAdvEvent);
            abortController.abort();
            resolve(null);
        };
        device.addEventListener('advertisementreceived', onAdvEvent);
        device.watchAdvertisements({ signal: abortController.signal }).catch(onAbort);
        setTimeout(onAbort, timeoutMs);
    });
}
function extractMacFromManufacturerData(mfData, cicList, reversedByteOrder = true) {
    if (!mfData)
        return null;
    let dataView;
    if (mfData instanceof DataView) {
        dataView = new DataView(mfData.buffer.slice(2));
    }
    else {
        for (const id of cicList) {
            if (mfData.has(id)) {
                dataView = mfData.get(id);
                break;
            }
        }
    }
    if (!dataView || dataView.byteLength < 6)
        return null;
    const mac = [];
    if (reversedByteOrder) {
        for (let i = 5; i >= 0; i--) {
            mac.push((dataView.getUint8(i) + 0x100).toString(16).slice(1));
        }
    }
    else {
        for (let i = dataView.byteLength - 1; i >= dataView.byteLength - 6; i--) {
            mac.push((dataView.getUint8(i) + 0x100).toString(16).slice(1));
        }
    }
    return mac.join(':');
}
export { now, findCharacteristic, waitForAdvertisements, extractMacFromManufacturerData };
