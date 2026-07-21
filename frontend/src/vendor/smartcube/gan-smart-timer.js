import { Subject } from 'rxjs';
// GAN Smart Timer bluetooth service and characteristic UUIDs
const GAN_TIMER_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
const GAN_TIMER_TIME_CHARACTERISTIC = '0000fff2-0000-1000-8000-00805f9b34fb';
const GAN_TIMER_STATE_CHARACTERISTIC = '0000fff5-0000-1000-8000-00805f9b34fb';
/**
 * GAN Smart Timer events/states
 */
var GanTimerState;
(function (GanTimerState) {
    /** Fired when timer is disconnected from bluetooth */
    GanTimerState[GanTimerState["DISCONNECT"] = 0] = "DISCONNECT";
    /** Grace delay is expired and timer is ready to start */
    GanTimerState[GanTimerState["GET_SET"] = 1] = "GET_SET";
    /** Hands removed from the timer before grace delay expired */
    GanTimerState[GanTimerState["HANDS_OFF"] = 2] = "HANDS_OFF";
    /** Timer is running */
    GanTimerState[GanTimerState["RUNNING"] = 3] = "RUNNING";
    /** Timer is stopped, this event includes recorded time */
    GanTimerState[GanTimerState["STOPPED"] = 4] = "STOPPED";
    /** Timer is reset and idle */
    GanTimerState[GanTimerState["IDLE"] = 5] = "IDLE";
    /** Hands are placed on the timer */
    GanTimerState[GanTimerState["HANDS_ON"] = 6] = "HANDS_ON";
    /** Timer moves to this state immediately after STOPPED */
    GanTimerState[GanTimerState["FINISHED"] = 7] = "FINISHED";
})(GanTimerState || (GanTimerState = {}));
/**
 * Construct time object
 */
function makeTime(min, sec, msec) {
    return {
        minutes: min,
        seconds: sec,
        milliseconds: msec,
        asTimestamp: 60000 * min + 1000 * sec + msec,
        toString: () => `${min.toString(10)}:${sec.toString(10).padStart(2, '0')}.${msec.toString(10).padStart(3, '0')}`
    };
}
/**
 * Construct time object from raw event data
 */
function makeTimeFromRaw(data, offset) {
    var min = data.getUint8(offset);
    var sec = data.getUint8(offset + 1);
    var msec = data.getUint16(offset + 2, true);
    return makeTime(min, sec, msec);
}
/**
 * Construct time object from milliseconds timestamp
 */
function makeTimeFromTimestamp(timestamp) {
    var min = Math.trunc(timestamp / 60000);
    var sec = Math.trunc(timestamp % 60000 / 1000);
    var msec = Math.trunc(timestamp % 1000);
    return makeTime(min, sec, msec);
}
/**
 * Calculate ArrayBuffer checksum using CRC-16/CCIT-FALSE algorithm variation
 */
function crc16ccit(buff) {
    var dataView = new DataView(buff);
    var crc = 0xFFFF;
    for (let i = 0; i < dataView.byteLength; ++i) {
        crc ^= dataView.getUint8(i) << 8;
        for (let j = 0; j < 8; ++j) {
            crc = (crc & 0x8000) > 0 ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    return crc & 0xFFFF;
}
/**
 * Ensure received timer event has valid data: check data magic and CRC
 */
function validateEventData(data) {
    try {
        if (data?.byteLength == 0 || data.getUint8(0) != 0xFE) {
            return false;
        }
        var eventCRC = data.getUint16(data.byteLength - 2, true);
        var calculatedCRC = crc16ccit(data.buffer.slice(2, data.byteLength - 2));
        return eventCRC == calculatedCRC;
    }
    catch (err) {
        return false;
    }
}
/**
 * Construct event object from raw data
 */
function buildTimerEvent(data) {
    var evt = {
        state: data.getUint8(3)
    };
    if (evt.state == GanTimerState.STOPPED) {
        evt.recordedTime = makeTimeFromRaw(data, 4);
    }
    return evt;
}
/**
 * Initiate new connection with the GAN Smart Timer device
 * @returns Connection connection object representing connection API and state
 */
async function connectGanTimer() {
    // Request user for the bluetooth device (popup selection dialog)
    var device = await navigator.bluetooth.requestDevice({
        filters: [
            { namePrefix: "GAN" },
            { namePrefix: "gan" },
            { namePrefix: "Gan" }
        ],
        optionalServices: [GAN_TIMER_SERVICE]
    });
    // Connect to GATT server
    var server = await device.gatt.connect();
    // Connect to main timer service and characteristics
    var service = await server.getPrimaryService(GAN_TIMER_SERVICE);
    var timeCharacteristic = await service.getCharacteristic(GAN_TIMER_TIME_CHARACTERISTIC);
    var stateCharacteristic = await service.getCharacteristic(GAN_TIMER_STATE_CHARACTERISTIC);
    // Subscribe to value updates of the timer state characteristic
    var eventSubject = new Subject();
    var onStateChanged = async (evt) => {
        var chr = evt.target;
        var data = chr.value;
        if (validateEventData(data)) {
            eventSubject.next(buildTimerEvent(data));
        }
        else {
            eventSubject.error("Invalid event data received from Timer");
        }
    };
    stateCharacteristic.addEventListener('characteristicvaluechanged', onStateChanged);
    stateCharacteristic.startNotifications();
    // This action retrieves latest recorded times from timer
    var getRecordedTimesAction = async () => {
        var data = await timeCharacteristic.readValue();
        return data?.byteLength >= 16 ?
            Promise.resolve({
                displayTime: makeTimeFromRaw(data, 0),
                previousTimes: [makeTimeFromRaw(data, 4), makeTimeFromRaw(data, 8), makeTimeFromRaw(data, 12)]
            }) : Promise.reject("Invalid time characteristic value received from Timer");
    };
    // Manual disconnect action
    var disconnectAction = async () => {
        device.removeEventListener('gattserverdisconnected', disconnectAction);
        stateCharacteristic.removeEventListener('characteristicvaluechanged', onStateChanged);
        await stateCharacteristic.stopNotifications().catch(() => { });
        eventSubject.next({ state: GanTimerState.DISCONNECT });
        eventSubject.complete();
        if (server.connected) {
            server.disconnect();
        }
    };
    device.addEventListener('gattserverdisconnected', disconnectAction);
    return {
        events$: eventSubject,
        getRecordedTimes: getRecordedTimesAction,
        disconnect: disconnectAction,
    };
}
export { connectGanTimer, makeTime, makeTimeFromTimestamp, GanTimerState };
