/**
 * Serializes GATT write operations (writeValueWithResponse / writeValueWithoutResponse) to avoid overlapping operations on some stacks.
 */
export class GattWriteQueue {
    constructor() {
        this.tail = Promise.resolve();
    }
    enqueue(fn) {
        const run = this.tail.then(() => fn());
        this.tail = run.then(() => { }, () => { });
        return run;
    }
}
