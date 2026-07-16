export type TaskPriority = "high" | "normal";

export type ScheduledTask<T> = {
  promise: Promise<T>;
  promote: () => boolean;
};

type QueueEntry<T> = {
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  priority: TaskPriority;
  state: "queued" | "running" | "settled";
};

/**
 * Small priority-aware concurrency scheduler. A queued normal task can be
 * promoted in place when the same resource becomes user-visible/selected.
 */
export class PriorityTaskScheduler {
  private activeTasks = 0;
  private readonly highPriorityQueue: Array<QueueEntry<unknown>> = [];
  private readonly normalPriorityQueue: Array<QueueEntry<unknown>> = [];

  constructor(private readonly maxConcurrency: number) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new RangeError("maxConcurrency must be a positive integer");
    }
  }

  schedule<T>(task: () => Promise<T>, priority: TaskPriority = "normal"): ScheduledTask<T> {
    let entry!: QueueEntry<T>;
    const promise = new Promise<T>((resolve, reject) => {
      entry = { task, resolve, reject, priority, state: "queued" };
    });

    if (this.activeTasks < this.maxConcurrency) {
      this.run(entry);
    } else {
      this.enqueue(entry);
    }

    return {
      promise,
      promote: () => this.promote(entry),
    };
  }

  private enqueue<T>(entry: QueueEntry<T>) {
    const queue = entry.priority === "high" ? this.highPriorityQueue : this.normalPriorityQueue;
    queue.push(entry as QueueEntry<unknown>);
  }

  private promote<T>(entry: QueueEntry<T>): boolean {
    if (entry.state !== "queued" || entry.priority === "high") return false;
    const index = this.normalPriorityQueue.indexOf(entry as QueueEntry<unknown>);
    if (index < 0) return false;
    this.normalPriorityQueue.splice(index, 1);
    entry.priority = "high";
    this.highPriorityQueue.push(entry as QueueEntry<unknown>);
    return true;
  }

  private run<T>(entry: QueueEntry<T>) {
    entry.state = "running";
    this.activeTasks += 1;

    let result: Promise<T>;
    try {
      result = entry.task();
    } catch (error) {
      entry.reject(error);
      this.finish(entry);
      return;
    }

    result.then(entry.resolve, entry.reject).finally(() => this.finish(entry));
  }

  private finish<T>(entry: QueueEntry<T>) {
    if (entry.state === "settled") return;
    entry.state = "settled";
    this.activeTasks -= 1;
    this.runNext();
  }

  private runNext() {
    const next = this.highPriorityQueue.shift() ?? this.normalPriorityQueue.shift();
    if (next) this.run(next);
  }
}
