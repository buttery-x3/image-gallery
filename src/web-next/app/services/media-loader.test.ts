import { describe, expect, it } from "vitest";
import { MediaLoadScheduler } from "./media-loader";

describe("media load scheduler", () => {
  it("never starts more than four loads and drains the full queue", async () => {
    const scheduler = new MediaLoadScheduler(4);
    const releases: Array<() => void> = [];
    let active = 0;
    let maximum = 0;
    let completed = 0;
    for (let index = 0; index < 10; index += 1) {
      scheduler.enqueue(String(index), index, () => new Promise<boolean>((resolve) => {
        active += 1;
        maximum = Math.max(maximum, active);
        releases.push(() => { active -= 1; completed += 1; resolve(true); });
      }));
    }
    expect(scheduler.active).toBe(4);
    while (completed < 10) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(maximum).toBe(4);
    expect(scheduler.pending).toBe(0);
  });

  it("lets viewport work replace a queued background load", async () => {
    const scheduler = new MediaLoadScheduler(1);
    let releaseFirst!: () => void;
    const started: string[] = [];
    scheduler.enqueue("first", 0, () => new Promise<boolean>((resolve) => { releaseFirst = () => resolve(true); }));
    scheduler.enqueue("target", 1_000_000, async () => { started.push("background"); return true; });
    scheduler.enqueue("target", 1, async () => { started.push("viewport"); return true; });
    await Promise.resolve();
    releaseFirst();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["viewport"]);
  });

  it("does not duplicate active work or let background work demote viewport work", async () => {
    const scheduler = new MediaLoadScheduler(1);
    let releaseFirst!: () => void;
    const started: string[] = [];
    scheduler.enqueue("active", 0, () => new Promise<boolean>((resolve) => {
      started.push("active");
      releaseFirst = () => resolve(true);
    }));
    scheduler.enqueue("active", 1_000_000, async () => { started.push("duplicate"); return true; });
    scheduler.enqueue("visible", 10, async () => { started.push("visible"); return true; });
    scheduler.enqueue("visible", 1_000_000, async () => { started.push("background"); return true; });
    await Promise.resolve();
    releaseFirst();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["active", "visible"]);
  });
});
