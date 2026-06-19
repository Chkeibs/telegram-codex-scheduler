import { describe, expect, it } from "vitest";
import { assertJobTransition, canTransitionJob, isTerminalJobStatus } from "../src/index.js";

describe("job state machine", () => {
  it("allows the normal execution path", () => {
    expect(canTransitionJob("scheduled", "pending_wake")).toBe(true);
    expect(canTransitionJob("pending_wake", "pending")).toBe(true);
    expect(canTransitionJob("pending", "running")).toBe(true);
    expect(canTransitionJob("running", "completed")).toBe(true);
  });

  it("rejects duplicate or backwards execution", () => {
    expect(() => assertJobTransition("running", "pending")).toThrow("Invalid job transition");
    expect(() => assertJobTransition("completed", "running")).toThrow("Invalid job transition");
  });

  it("identifies terminal states", () => {
    expect(isTerminalJobStatus("completed")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
    expect(isTerminalJobStatus("cancelled")).toBe(true);
    expect(isTerminalJobStatus("running")).toBe(false);
  });
});
