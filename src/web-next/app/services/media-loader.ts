interface PendingLoad {
  key: string;
  priority: number;
  order: number;
  start: () => Promise<boolean>;
  lane: "foreground" | "background";
  cancel?: () => void;
}

interface ActiveLoad {
  task: PendingLoad;
  preempted: boolean;
}

export class MediaLoadScheduler {
  readonly #maximum: number;
  readonly #maximumBackground: number;
  #order = 0;
  readonly #pending = new Map<string, PendingLoad>();
  readonly #completed = new Set<string>();
  readonly #activeLoads = new Map<string, ActiveLoad>();

  constructor(maximum = 4, maximumBackground = Math.max(1, Math.floor(maximum / 2))) {
    this.#maximum = maximum;
    this.#maximumBackground = Math.min(maximum, maximumBackground);
  }

  get active(): number { return this.#activeLoads.size; }
  get pending(): number { return this.#pending.size; }
  hasStarted(key: string): boolean { return this.#activeLoads.has(key) || this.#completed.has(key); }

  enqueue(
    key: string,
    priority: number,
    start: () => Promise<boolean>,
    options: { lane?: "foreground" | "background"; cancel?: () => void } = {},
  ): void {
    if (this.#completed.has(key)) return;
    const existing = this.#pending.get(key);
    if (!existing || priority < existing.priority) {
      this.#pending.set(key, {
        key,
        priority,
        order: existing?.order ?? this.#order++,
        start,
        lane: options.lane ?? "foreground",
        ...(options.cancel ? { cancel: options.cancel } : {}),
      });
    }
    if ((options.lane ?? "foreground") === "foreground") this.#preemptBackgroundForForeground();
    this.#drain();
  }

  reprioritize(key: string, priority: number): void {
    const existing = this.#pending.get(key);
    if (!existing) return;
    existing.priority = priority;
    this.#drain();
  }

  cancel(key: string): void {
    this.#pending.delete(key);
  }

  reset(): void {
    this.#pending.clear();
    this.#completed.clear();
    for (const active of this.#activeLoads.values()) active.task.cancel?.();
  }

  #preemptBackgroundForForeground(): void {
    const foregroundWaiting = [...this.#pending.values()].filter((task) => task.lane === "foreground").length;
    let slotsNeeded = Math.max(0, foregroundWaiting - (this.#maximum - this.#activeLoads.size));
    if (slotsNeeded === 0) return;

    for (const active of this.#activeLoads.values()) {
      if (slotsNeeded === 0) break;
      if (active.task.lane !== "background" || active.preempted || !active.task.cancel) continue;
      active.preempted = true;
      active.task.cancel();
      slotsNeeded -= 1;
    }
  }

  #drain(): void {
    while (this.#activeLoads.size < this.#maximum && this.#pending.size > 0) {
      const activeBackground = [...this.#activeLoads.values()].filter((active) => active.task.lane === "background").length;
      const next = [...this.#pending.values()]
        .filter((task) => task.lane === "foreground" || activeBackground < this.#maximumBackground)
        .sort((left, right) => left.priority - right.priority || left.order - right.order)[0];
      if (!next) return;
      this.#pending.delete(next.key);
      const active: ActiveLoad = { task: next, preempted: false };
      this.#activeLoads.set(next.key, active);
      void Promise.resolve().then(next.start).then((completed) => {
        if (completed) {
          this.#completed.add(next.key);
          this.#pending.delete(next.key);
        }
      }).finally(() => {
        this.#activeLoads.delete(next.key);
        if (active.preempted && !this.#completed.has(next.key) && !this.#pending.has(next.key)) {
          this.#pending.set(next.key, { ...next, order: this.#order++ });
        }
        this.#drain();
      });
    }
  }
}
