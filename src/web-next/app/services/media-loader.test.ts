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

  it("reserves capacity for viewport work and preempts background loads when needed", async () => {
    const scheduler = new MediaLoadScheduler(4, 2);
    const started: string[] = [];
    const cancelled: string[] = [];
    const releases = new Map<string, (completed: boolean) => void>();

    const queue = (key: string, lane: "foreground" | "background"): void => {
      scheduler.enqueue(key, lane === "foreground" ? 0 : 1_000_000, () => new Promise<boolean>((resolve) => {
        started.push(key);
        releases.set(key, resolve);
      }), {
        lane,
        ...(lane === "background" ? {
          cancel: () => {
            cancelled.push(key);
            releases.get(key)?.(false);
          },
        } : {}),
      });
    };

    for (let index = 0; index < 4; index += 1) queue(`background-${index}`, "background");
    await Promise.resolve();
    expect(started).toEqual(["background-0", "background-1"]);

    queue("visible-0", "foreground");
    queue("visible-1", "foreground");
    await Promise.resolve();
    expect(started).toContain("visible-0");
    expect(started).toContain("visible-1");

    queue("visible-2", "foreground");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toEqual(["background-0"]);
    expect(started).toContain("visible-2");
    expect(scheduler.pending).toBe(3);

    for (const release of releases.values()) release(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
});
