// Pre-flight budget guard. check() runs BEFORE the transport fires, so a call
// that would breach a ceiling never reaches the provider. record() folds the
// actual cost into the running total after a successful call.
import type { BudgetConfig, BudgetStore } from "../types.js";

/** Default rolling-total store: in-memory, per BudgetGuard instance. */
class InMemoryBudgetStore implements BudgetStore {
  private spentUsd = 0;
  getSpent(): number {
    return this.spentUsd;
  }
  addSpent(usd: number): void {
    this.spentUsd += usd;
  }
}

export class BudgetExceededError extends Error {
  readonly kind: "per-call" | "rolling";
  readonly limit: number;
  readonly spent: number;
  readonly requested: number;

  constructor(
    kind: "per-call" | "rolling",
    limit: number,
    spent: number,
    requested: number,
  ) {
    super(
      `Budget exceeded (${kind}): this call's estimated $${requested.toFixed(6)} ` +
        (kind === "rolling"
          ? `+ $${spent.toFixed(6)} already spent exceeds the $${limit.toFixed(6)} rolling ceiling`
          : `exceeds the $${limit.toFixed(6)} per-call ceiling`),
    );
    this.name = "BudgetExceededError";
    this.kind = kind;
    this.limit = limit;
    this.spent = spent;
    this.requested = requested;
  }
}

export class BudgetGuard {
  private readonly store: BudgetStore;

  constructor(private readonly config: BudgetConfig) {
    this.store = config.store ?? new InMemoryBudgetStore();
  }

  /** Throws BudgetExceededError if `requested` would breach the per-call ceiling
   *  or push the rolling total past its ceiling. Call before firing the request.
   *  Async because a persistent store may be I/O-backed. */
  async check(requested: number): Promise<void> {
    const { perCallUsd, rollingUsd } = this.config;
    if (perCallUsd !== undefined && requested > perCallUsd) {
      throw new BudgetExceededError("per-call", perCallUsd, await this.store.getSpent(), requested);
    }
    if (rollingUsd !== undefined) {
      const spent = await this.store.getSpent();
      if (spent + requested > rollingUsd) {
        throw new BudgetExceededError("rolling", rollingUsd, spent, requested);
      }
    }
  }

  /** Add an actual cost to the running total (after a successful call). */
  async record(actual: number): Promise<void> {
    await this.store.addSpent(actual);
  }

  async totalSpent(): Promise<number> {
    return this.store.getSpent();
  }
}
