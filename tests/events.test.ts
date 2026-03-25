import { describe, expect, it } from "vitest";
import { TxEvent, TypedEventEmitter } from "../src/events.js";

describe("TypedEventEmitter", () => {
  it("once() fires the listener only once", () => {
    const emitter = new TypedEventEmitter();
    const calls: number[] = [];

    emitter.once(TxEvent.SENT, (data) => {
      calls.push(data.attempt);
    });

    emitter.emit(TxEvent.SENT, { signature: "sig1", attempt: 1 });
    emitter.emit(TxEvent.SENT, { signature: "sig2", attempt: 2 });

    expect(calls).toEqual([1]);
  });

  it("maxListeners defaults to 50", () => {
    const emitter = new TypedEventEmitter();
    expect(emitter.getMaxListeners()).toBe(50);
  });
});
