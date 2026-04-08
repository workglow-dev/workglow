<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Composite Rate Limiting: How Workglow Tames the Chaos of Job Scheduling

Rate limiting sounds simple until you actually have to do it.

You start with a reasonable idea: "I'll just cap the number of requests per minute." You write a counter, slap a timer on it, and ship. Then reality arrives. Your GPU can only run one inference at a time. Your API provider starts returning 429s at 80 requests per minute even though their docs say 100. Your batch job hammers the endpoint so hard that every request lands in the same millisecond and the server drops half of them. Oh, and now you need exponential backoff, but only for the rate-limited dimension, not the concurrency one.

Congratulations: you have just discovered that rate limiting is not one problem. It is at least four problems wearing a trench coat.

This post is about how Workglow's job queue solves all four -- not with a single omniscient limiter, but with a set of small, composable ones that snap together like building blocks.

---

## The Four Dimensions of "Slow Down"

When you are orchestrating AI workloads -- inference calls, embedding generation, document chunking, vector upserts -- you quickly encounter multiple, independent reasons to throttle:

1. **Concurrency.** Your GPU has finite VRAM. A local LLM can serve one request at a time (maybe two if you are feeling reckless). You need a hard cap on parallel jobs.

2. **Throughput.** The Anthropic API allows N requests per minute. OpenAI gives you a token budget per window. You need a sliding-window counter that knows when you have used up your quota.

3. **Spacing.** Even within your throughput budget, firing 100 requests in the first 50 milliseconds of a minute is a great way to trigger server-side protections. You want requests spread *evenly* across the window.

4. **Backoff.** When you do hit a limit, you need to wait -- and the wait should grow exponentially with jitter, not just retry in a tight loop until the provider blocks you entirely.

Most rate-limiting libraries pick one of these and call it a day. The brave ones try to handle all four in a single class, accumulating configuration options until the constructor signature reads like a tax form. Workglow takes a different path.

---

## The ILimiter Interface: Six Methods, Infinite Possibilities

At the foundation is `ILimiter`, an interface so small it fits on a napkin:

```typescript
export interface ILimiter {
  canProceed(): Promise<boolean>;
  recordJobStart(): Promise<void>;
  recordJobCompletion(): Promise<void>;
  getNextAvailableTime(): Promise<Date>;
  setNextAvailableTime(date: Date): Promise<void>;
  clear(): Promise<void>;
}
```

Six methods. No generics. No configuration types baked in. Every limiter in the system -- from the trivial to the sophisticated -- implements exactly this contract.

The protocol is straightforward. Before dispatching a job, the worker asks `canProceed()`. If the answer is yes, it calls `recordJobStart()`, runs the job, then calls `recordJobCompletion()`. If the answer is no, it checks `getNextAvailableTime()` to figure out how long to sleep. And `setNextAvailableTime()` lets external systems (like an API returning a `Retry-After` header) push the schedule forward.

This uniformity is the key insight. Because every limiter speaks the same language, you can swap them, stack them, and combine them without the worker caring at all. The worker code in `JobQueueWorker` is blissfully ignorant of what kind of limiting is happening:

```typescript
const canProceed = await this.limiter.canProceed();
if (canProceed) {
  const job = await this.next();
  if (job) {
    this.processSingleJob(job);
    continue;
  }
}
```

That is the entire decision point. One boolean. The complexity lives behind the interface, not in the scheduling loop.

---

## ConcurrencyLimiter: The Bouncer at the Door

The simplest real limiter is `ConcurrencyLimiter`. It does one thing: counts how many jobs are currently running and says "no" when the count hits the maximum.

```typescript
export class ConcurrencyLimiter implements ILimiter {
  private currentRunningJobs: number = 0;
  private readonly maxConcurrentJobs: number;

  async canProceed(): Promise<boolean> {
    return this.currentRunningJobs < this.maxConcurrentJobs
      && Date.now() >= this.nextAllowedStartTime.getTime();
  }

  async recordJobStart(): Promise<void> {
    this.currentRunningJobs++;
  }

  async recordJobCompletion(): Promise<void> {
    this.currentRunningJobs = Math.max(0, this.currentRunningJobs - 1);
  }
}
```

This is your GPU serializer. Set `maxConcurrentJobs` to 1 and you have a strict sequential queue. Set it to 4 and you can saturate a multi-GPU rig. The `Math.max(0, ...)` guard in `recordJobCompletion` is a nice defensive touch -- if something goes wrong and completion fires twice, the counter never goes negative.

It also respects `setNextAvailableTime`, so external signals (like a provider saying "try again in 30 seconds") can pause the entire concurrency pool. Simple, focused, correct.

---

## RateLimiter: Sliding Windows and Exponential Backoff

`RateLimiter` is where things get more interesting. It implements a classic sliding-window algorithm backed by pluggable storage -- in-memory, SQLite, PostgreSQL, IndexedDB, even Supabase. The storage tracks individual execution timestamps, so the limiter can count how many jobs ran in the last N seconds:

```typescript
const windowStartTime = new Date(Date.now() - this.windowSizeInMilliseconds).toISOString();
const attemptCount = await this.storage.getExecutionCount(this.queueName, windowStartTime);
const canProceedNow = attemptCount < this.maxExecutions;
```

When the window fills up, the limiter does not just say "no" and leave you hanging. It engages exponential backoff with *full jitter*:

```typescript
protected addJitter(base: number): number {
  return base + Math.random() * base;  // full jitter in [base, 2*base)
}

protected increaseBackoff(): void {
  this.currentBackoffDelay = Math.min(
    this.currentBackoffDelay * this.backoffMultiplier,
    this.maxBackoffDelay
  );
}
```

The jitter is critical. Without it, when multiple workers hit the limit simultaneously, they all back off to the exact same retry time -- and then stampede the endpoint again. Full jitter spreads the retries across a window that is the same size as the backoff delay itself, breaking the synchronization. The defaults are sensible: start at 1 second, double each time, cap at 10 minutes.

What makes this particularly well-designed is the automatic backoff *reset*. When `canProceed` detects that the sliding window has room again, it clears any outstanding backoff delay and resets to the initial value. The system recovers gracefully instead of staying in a prolonged cooldown after a transient burst.

The persistent storage layer means rate limit state survives process restarts. If your server crashes and restarts, it does not immediately fire 100 requests because it "forgot" about the 95 it sent before crashing. The execution records are still in SQLite (or Postgres, or whatever backend you chose), and the sliding window picks up right where it left off.

---

## EvenlySpacedRateLimiter: Smooth Operator

Here is a subtle problem: a standard rate limiter with a window of 60 seconds and a max of 60 requests technically allows all 60 requests in the first second. Technically compliant, practically rude.

`EvenlySpacedRateLimiter` takes a different approach. Given a budget of N requests per window, it calculates the *ideal interval* between requests and enforces it:

```typescript
this.idealInterval = this.windowSizeMs / this.maxExecutions;
```

Sixty requests per minute becomes one request per second. But it goes further -- it tracks actual job durations and adjusts the spacing dynamically:

```typescript
const avgDuration = sum / this.durations.length;
const waitMs = Math.max(0, this.idealInterval - avgDuration);
this.nextAvailableTime = now + waitMs;
```

If your jobs take 800ms on average and the ideal interval is 1000ms, the limiter only adds 200ms of padding. If jobs take 1200ms, the padding drops to zero -- the job itself is already slower than the ideal rate. This adaptive behavior means you get maximum throughput without exceeding the budget, regardless of how long individual jobs take.

The limiter maintains a rolling window of durations (capped at `maxExecutions` entries), so it adapts as workload characteristics change over time. Early in a batch when you have no timing data, it defaults to the full ideal interval -- conservative and safe.

---

## DelayLimiter: The Minimum Gap

Sometimes you do not need windows or budgets. You just need a mandatory pause between requests. `DelayLimiter` is the simplest timing-based limiter: after each job starts, the next one cannot start for at least N milliseconds.

```typescript
export class DelayLimiter implements ILimiter {
  async canProceed(): Promise<boolean> {
    return Date.now() >= this.nextAvailableTime.getTime();
  }

  async recordJobStart(): Promise<void> {
    this.nextAvailableTime = new Date(Date.now() + this.delayInMilliseconds);
  }
}
```

Default: 50ms. Just enough to keep you from accidentally DDoS-ing yourself when processing a queue of thousands of items against a fast local service. Think of it as a minimum courtesy interval.

---

## CompositeLimiter: The Key Insight

Now for the payoff. Each of the limiters above solves one dimension of rate limiting cleanly. But real workloads need multiple dimensions simultaneously. You might need concurrency=1 (GPU) *and* rate=100/min (API quota) *and* even spacing (politeness). How do you combine them?

You could build a `GpuAwareRateLimitedEvenlySpacedLimiter` with twelve constructor parameters. Or -- and this is the Workglow way -- you compose:

```typescript
export class CompositeLimiter implements ILimiter {
  private limiters: ILimiter[] = [];

  async canProceed(): Promise<boolean> {
    for (const limiter of this.limiters) {
      if (!(await limiter.canProceed())) {
        return false;  // If any limiter says "no", proceed no further
      }
    }
    return true;  // All limiters agree
  }

  async getNextAvailableTime(): Promise<Date> {
    let maxDate = new Date();
    for (const limiter of this.limiters) {
      const limiterNextTime = await limiter.getNextAvailableTime();
      if (limiterNextTime > maxDate) {
        maxDate = limiterNextTime;
      }
    }
    return maxDate;
  }
}
```

The logic is beautiful in its simplicity. `canProceed` returns true only if *every* limiter agrees. `getNextAvailableTime` returns the *latest* time among all limiters -- because you cannot proceed until every constraint is satisfied. `recordJobStart` and `recordJobCompletion` fan out to all children. And `setNextAvailableTime` pushes forward every limiter, so an external `Retry-After` signal pauses the entire composite.

This is conjunction logic: AND across all dimensions. A job runs if and only if it has a concurrency slot available AND is within the rate window AND has waited the minimum spacing AND backoff has expired.

---

## Real-World Scenarios

Let us put this together with some realistic configurations.

### Local GPU Queue

Running Llama inference on a single GPU. One job at a time, no external API limits:

```typescript
const limiter = new ConcurrencyLimiter(1);
```

That is it. One limiter, one constraint.

### Cloud API with Rate Limits

Calling Claude at 100 requests per minute with even spacing and backoff:

```typescript
const limiter = new CompositeLimiter([
  new EvenlySpacedRateLimiter({
    maxExecutions: 100,
    windowSizeInSeconds: 60,
  }),
  new RateLimiter(storage, "anthropic", {
    maxExecutions: 100,
    windowSizeInSeconds: 60,
    initialBackoffDelay: 2_000,
    maxBackoffDelay: 120_000,
  }),
]);
```

The `EvenlySpacedRateLimiter` prevents bursting. The `RateLimiter` tracks the persistent sliding window and kicks in exponential backoff if you somehow hit the wall anyway (e.g., because another process is sharing the same API key).

### Hybrid: Local Model + Remote Embedding API

Running a local LLM for generation (GPU-bound) and calling OpenAI for embeddings (rate-limited):

```typescript
// Generation queue
const genLimiter = new ConcurrencyLimiter(1);

// Embedding queue
const embedLimiter = new CompositeLimiter([
  new ConcurrencyLimiter(5),
  new RateLimiter(storage, "openai-embed", {
    maxExecutions: 3000,
    windowSizeInSeconds: 60,
  }),
  new DelayLimiter(20),
]);
```

The embedding queue allows 5 concurrent requests (the API can handle parallelism), stays within 3000/minute, and keeps a 20ms minimum gap to avoid micro-bursts. Three limiters, each trivially simple, combining into sophisticated behavior.

---

## Why Composition Beats Configuration

The traditional approach to multi-dimensional rate limiting is the God Object: one class with every possible knob. You have seen the pattern -- `maxConcurrent`, `maxPerSecond`, `maxPerMinute`, `minDelay`, `backoffEnabled`, `backoffMultiplier`, `jitterEnabled`, `jitterMode`... and if the library does not have the exact combination you need, you are out of luck or writing a pull request.

Composition inverts the problem. Each limiter is:

- **Small.** `DelayLimiter` is 37 lines including the license header. `ConcurrencyLimiter` is 53. You can read them, understand them, and trust them.
- **Testable in isolation.** You do not need to test the interaction of concurrency and backoff in a single class. Each limiter has its own test suite.
- **Independently evolvable.** Need a new kind of limiting? Write a class that implements `ILimiter`, drop it into a `CompositeLimiter`, done. No existing code changes.
- **Combinable without limits.** Two limiters, five limiters, a `CompositeLimiter` inside another `CompositeLimiter` -- the interface does not care.

And there is the `NullLimiter`: a limiter that always says yes, does nothing, and serves as the default. When you do not configure rate limiting, the system is not branching on a null check or a boolean flag. It is running the same code path with a no-op implementation. Same interface, fewer bugs.

The `JobQueueServer` passes a single `ILimiter` to each worker. The worker never knows -- or needs to know -- whether it is dealing with a concurrency guard, a sliding-window tracker, a spacing enforcer, a composite of all three, or a null that lets everything through:

```typescript
this.limiter = options.limiter ?? new NullLimiter();
```

One line. Polymorphism handles the rest.

---

## The Bigger Picture

Workglow's composite rate limiting is a small example of a design philosophy that runs through the entire library: *prefer composition of simple, interface-driven components over configuration of complex, monolithic ones*. The same pattern shows up in storage backends (swap SQLite for Postgres without changing task code), in AI providers (swap Anthropic for Ollama behind the same task interface), and in the task graph itself (compose tasks into workflows, workflows into larger workflows).

Rate limiting is where this philosophy shines brightest, because the alternative is so viscerally painful. Anyone who has debugged a rate limiter that was "mostly working" -- where the concurrency logic interfered with the backoff timing, or the spacing heuristic double-counted completions -- knows the particular misery of tangled concerns.

Six methods. A handful of small classes. One composite that ties them together with AND logic. No tangled concerns, no configuration explosions, no "mostly working."

Just the right amount of slow.
