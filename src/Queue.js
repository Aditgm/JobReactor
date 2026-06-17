const Redis = require('ioredis');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const TokenBucket = require('./TokenBucket');

class Queue {
  constructor(name, redisOpts = {}, rateLimitOpts = null) {
    this.name = name;
    this.redis = new Redis({ host: 'localhost', port: 6379, ...redisOpts });
    this.keys = {
      waiting:   `queue:${name}:waiting`,
      active:    `queue:${name}:active`,
      delayed:   `queue:${name}:delayed`,
      completed: `queue:${name}:completed`,
      failed:    `queue:${name}:failed`,
      dlq:       `queue:${name}:dlq`,
      job:       (id) => `queue:${name}:job:${id}`,
      lock:      (id) => `queue:${name}:lock:${id}`,
    };
    
    // Ingestion spike control karne ke liye limiter register karo
    if (rateLimitOpts) {
      this.limiter = new TokenBucket(rateLimitOpts.ratePerSec, rateLimitOpts.capacity);
    }

    this._registerScripts();
  }

  // Lua script read karke Redis commands define karo
  _registerScripts() {
    const scriptDir = path.join(__dirname, '../scripts');
    if (!fs.existsSync(scriptDir)) {
      return;
    }
    
    try {
      this.redis.defineCommand('moveToActive', {
        numberOfKeys: 3,
        lua: fs.readFileSync(path.join(scriptDir, 'moveToActive.lua'), 'utf8'),
      });

      this.redis.defineCommand('completeJob', {
        numberOfKeys: 3,
        lua: fs.readFileSync(path.join(scriptDir, 'completeJob.lua'), 'utf8'),
      });
    } catch (err) {
      console.warn("Could not register Lua scripts:", err.message);
    }
  }

  // Queue mein new job add karne ka logic
  async add(name, data, opts = {}) {
    if (this.limiter) {
      await this.limiter.consume(1);
    }

    const {
      priority   = 5,
      delay      = 0,
      attempts   = 3,
      backoff    = 1000,
      jobId      = randomUUID(),
    } = opts;

    const now = Date.now();
    const runAt = now + delay;

    const jobData = {
      id:          jobId,
      name,
      data:        JSON.stringify(data),
      priority,
      attempts:    0,
      maxAttempts: attempts,
      backoff,
      status:      delay > 0 ? 'delayed' : 'waiting',
      createdAt:   now,
      delay,
    };

    const pipeline = this.redis.pipeline();

    // HASH mein full job details save karo
    pipeline.hset(this.keys.job(jobId), ...Object.entries(jobData).flat());

    if (delay > 0) {
      pipeline.zadd(this.keys.delayed, runAt, jobId);
    } else {
      const score = priority * 1e15 + now;
      pipeline.zadd(this.keys.waiting, score, jobId);
    }

    await pipeline.exec();
    return jobId;
  }

  // Pipeline batching se single round-trip mein bulk jobs add karo
  async addBulk(jobs) {
    if (this.limiter) {
      await this.limiter.consume(jobs.length);
    }

    const pipeline = this.redis.pipeline();
    const now = Date.now();
    const ids = [];

    for (const { name, data, opts = {} } of jobs) {
      const jobId = randomUUID();
      ids.push(jobId);
      const priority = opts.priority ?? 5;
      
      const jobData = {
        id: jobId,
        name,
        data: JSON.stringify(data),
        priority,
        status: 'waiting',
        attempts: 0,
        maxAttempts: opts.attempts ?? 3,
        createdAt: now,
        backoff: opts.backoff ?? 1000,
        delay: 0
      };

      pipeline.hset(this.keys.job(jobId), ...Object.entries(jobData).flat());
      pipeline.zadd(this.keys.waiting, priority * 1e15 + now, jobId);
    }

    await pipeline.exec();
    return ids;
  }

  // Lock ya crash check fail hone par jobs ko DLQ list mein dalo
  async _moveToDLQ(jobId, reason) {
    const { active, dlq } = this.keys;
    const now = Date.now();

    await this.redis.pipeline()
      .zrem(active, jobId)
      .rpush(dlq, jobId)           
      .hset(this.keys.job(jobId),
        'status',       'dlq',
        'failedAt',     now,
        'dlqReason',    reason,
      )
      .exec();

    console.error(`[DLQ] Job ${jobId} moved to dead-letter: ${reason}`);
  }

  // DLQ items ko read karo range check ke hisab se
  async getDLQJobs(start = 0, stop = 99) {
    const jobIds = await this.redis.lrange(this.keys.dlq, start, stop);
    return Promise.all(
      jobIds.map(id => this.redis.hgetall(this.keys.job(id)))
    );
  }

  // Failed DLQ jobs ko re-queue karke phir se retry karo
  async replayDLQJob(jobId) {
    const job = await this.redis.hgetall(this.keys.job(jobId));
    if (!job || Object.keys(job).length === 0) throw new Error(`Job ${jobId} not found`);

    const score = (+job.priority || 5) * 1e15 + Date.now();

    await this.redis.pipeline()
      .lrem(this.keys.dlq, 1, jobId)         
      .zadd(this.keys.waiting, score, jobId)   
      .hset(this.keys.job(jobId),
        'status',   'waiting',
        'attempts', 0,                         
        'dlqReason', '',
      )
      .exec();

    return jobId;
  }
  
  // Worker side processing success response hone par run karo
  async _markComplete(jobId, workerId, result) {
    const now = Date.now();
    await this.redis.completeJob(
      this.keys.active, this.keys.completed, `queue:${this.name}:`,
      jobId, workerId, JSON.stringify(result), now
    );
  }
  
  // Lock expire check manage karo failure hone par
  async _handleFailure(jobId, workerId, error) {
    const lockKey = this.keys.lock(jobId);
    const lockOwner = await this.redis.get(lockKey);
    
    if (lockOwner !== workerId) {
       return; 
    }
    
    await this.redis.pexpire(lockKey, 1);
  }
}

module.exports = Queue;
