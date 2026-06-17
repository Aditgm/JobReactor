class Scheduler {
  constructor(queue) {
    this.queue = queue;
    this.interval = null;
  }

  // Scheduler ka run loop start karne ke liye
  start(intervalMs = 500) {
    this.interval = setInterval(() => this._tick(), intervalMs);
    console.log(`[Scheduler] Started, tick every ${intervalMs}ms`);
  }

  // Interval loop stop karo
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  // Har tick pe delay jobs promotion aur dead locks clear checking
  async _tick() {
    const now = Date.now();
    try {
      await Promise.all([
        this._promoteDelayedJobs(now),
        this._recoverExpiredLocks(now),
      ]);
    } catch (err) {
      console.error("[Scheduler] Error during tick:", err.message);
    }
  }

  // Delayed list ke ready jobs ko waiting list mein transfer karo
  async _promoteDelayedJobs(now) {
    const { delayed, waiting } = this.queue.keys;

    const readyJobIds = await this.queue.redis.zrangebyscore(delayed, 0, now);
    if (!readyJobIds.length) return;

    const pipeline = this.queue.redis.pipeline();
    for (const jobId of readyJobIds) {
      const job = await this.queue.redis.hgetall(this.queue.keys.job(jobId));
      if (!job || Object.keys(job).length === 0) {
        pipeline.zrem(delayed, jobId);
        continue;
      }
      
      const score = (+job.priority || 5) * 1e15 + now;

      pipeline.zrem(delayed, jobId);
      pipeline.zadd(waiting, score, jobId);
      pipeline.hset(this.queue.keys.job(jobId), 'status', 'waiting');
    }

    await pipeline.exec();
    console.log(`[Scheduler] Promoted ${readyJobIds.length} delayed jobs`);
  }

  // Crashed worker locks ko check karke identify aur release karo
  async _recoverExpiredLocks(now) {
    const { active, waiting } = this.queue.keys;

    const expiredJobIds = await this.queue.redis.zrangebyscore(active, 0, now - 1);

    if (!expiredJobIds.length) return;

    for (const jobId of expiredJobIds) {
      const job = await this.queue.redis.hgetall(this.queue.keys.job(jobId));
      if (!job || Object.keys(job).length === 0) {
         await this.queue.redis.zrem(active, jobId);
         continue;
      }
      
      const attempts = +job.attempts + 1;

      if (attempts >= +job.maxAttempts) {
        await this.queue._moveToDLQ(jobId, 'LOCK_EXPIRED_MAX_ATTEMPTS');
      } else {
        const backoffDelay = this._computeBackoff(+job.backoff, attempts);
        const retryAt = now + backoffDelay;

        await this.queue.redis.pipeline()
          .zrem(active, jobId)
          .zadd(this.queue.keys.delayed, retryAt, jobId)
          .hset(this.queue.keys.job(jobId),
            'attempts', attempts,
            'status', 'retrying',
            'lastError', 'LOCK_EXPIRED'
          )
          .exec();

        console.warn(`[Scheduler] Re-queued ${jobId} (attempt ${attempts}), retry in ${backoffDelay}ms`);
      }
    }
  }

  // Exponential backoff and jitter runtime calculation function
  _computeBackoff(baseMs, attempt) {
    const base = baseMs * (2 ** (attempt - 1));
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    return Math.min(Math.round(base + jitter), 3600000); 
  }
}

module.exports = Scheduler;
