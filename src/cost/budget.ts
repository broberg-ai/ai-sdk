// Pre-flight budget guard. check() runs BEFORE the transport fires, so a call
// that would breach a ceiling never reaches the provider. record() folds the
// actual cost into the running total after a successful call.
import type { BudgetConfig } from "../types.js";

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
  private spentUsd = 0;

  constructor(private readonly config: BudgetConfig) {}

  /** Throws BudgetExceededError if `requested` would breach the per-call ceiling
   *  or push the rolling total past its ceiling. Call before firing the request. */
  check(requested: number): void {
    const { perCallUsd, rollingUsd } = this.config;
    if (perCallUsd !== undefined && requested > perCallUsd) {
      throw new BudgetExceededError("per-call", perCallUsd, this.spentUsd, requested);
    }
    if (rollingUsd !== undefined && this.spentUsd + requested > rollingUsd) {
      throw new BudgetExceededError("rolling", rollingUsd, this.spentUsd, requested);
    }
  }

  /** Add an actual cost to the running total (after a successful call). */
  record(actual: number): void {
    this.spentUsd += actual;
  }

  get totalSpent(): number {
    return this.spentUsd;
  }
}
