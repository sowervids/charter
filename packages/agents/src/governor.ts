export interface QueueEntry {
  runId: string;
  agentId: string;
  priority: "p0" | "p1" | "p2";
  enqueuedAt: number;
}

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2 } as const;
const BACKOFF_START_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 2 * 60 * 60_000;

/**
 * Governor v1: the ONLY admission path to the runtime. Single queue,
 * bounded concurrency, exponential backoff on rate limits. Jobs are queued,
 * never dropped — "window exhausted, resumes ~HH:MM" is a first-class state.
 */
export class Governor {
  private readonly queue: QueueEntry[] = [];
  private running = 0;
  private backoffUntilMs = 0;
  private backoffMs = 0;

  constructor(
    private readonly options: {
      concurrency: number;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  enqueue(entry: QueueEntry): void {
    this.queue.push(entry);
    this.queue.sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        a.enqueuedAt - b.enqueuedAt,
    );
  }

  /** Pop the next admissible entry, or null (slot busy / backoff open). */
  next(): QueueEntry | null {
    if (this.running >= this.options.concurrency) return null;
    if (this.now() < this.backoffUntilMs) return null;
    const entry = this.queue.shift() ?? null;
    if (entry) this.running += 1;
    return entry;
  }

  finished(outcome: { rateLimited: boolean }): void {
    this.running = Math.max(0, this.running - 1);
    if (outcome.rateLimited) {
      this.backoffMs =
        this.backoffMs === 0
          ? BACKOFF_START_MS
          : Math.min(this.backoffMs * 2, BACKOFF_CAP_MS);
      this.backoffUntilMs = this.now() + this.backoffMs;
    } else {
      this.backoffMs = 0;
      this.backoffUntilMs = 0;
    }
  }

  status(): {
    queued: number;
    running: number;
    backoffUntil: number | null;
  } {
    return {
      queued: this.queue.length,
      running: this.running,
      backoffUntil: this.backoffUntilMs > this.now() ? this.backoffUntilMs : null,
    };
  }
}
