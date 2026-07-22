interface PendingLoad {
  key: string;
  priority: number;
  order: number;
  start: () => Promise<boolean>;
}

export class MediaLoadScheduler {
  readonly #maximum: number;
  #active = 0;
  #order = 0;
  readonly #pending = new Map<string, PendingLoad>();
  readonly #completed = new Set<string>();
  readonly #activeKeys = new Set<string>();

  constructor(maximum = 4) {
    this.#maximum = maximum;
  }

  get active(): number { return this.#active; }
  get pending(): number { return this.#pending.size; }
  hasStarted(key: string): boolean { return this.#activeKeys.has(key) || this.#completed.has(key); }

  enqueue(key: string, priority: number, start: () => Promise<boolean>): void {
    if (this.#completed.has(key)) return;
    const existing = this.#pending.get(key);
    this.#pending.set(key, { key, priority, order: existing?.order ?? this.#order++, start });
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
  }

  #drain(): void {
    while (this.#active < this.#maximum && this.#pending.size > 0) {
      const next = [...this.#pending.values()].sort((left, right) =>
        left.priority - right.priority || left.order - right.order
      )[0]!;
      this.#pending.delete(next.key);
      this.#active += 1;
      this.#activeKeys.add(next.key);
      void Promise.resolve().then(next.start).then((completed) => {
        if (completed) this.#completed.add(next.key);
      }).finally(() => {
        this.#active -= 1;
        this.#activeKeys.delete(next.key);
        this.#drain();
      });
    }
  }
}
