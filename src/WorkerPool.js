const { Worker } = require('worker_threads');
const EventEmitter = require('events');
const os = require('os');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class WorkerPool extends EventEmitter {
  constructor(workerScript, { concurrency = os.cpus().length, queue } = {}) {
    super();
    this.workerScript = workerScript;
    this.concurrency = concurrency;
    this.queue = queue;
    this.workers = new Map(); // Har active worker thread ka tracking state map
    this.shuttingDown = false;
    this.pollInterval = null;
  }

  // Workers spin up logic aur poll loops initializations
  async start() {
    for (let i = 0; i < this.concurrency; i++) {
      await this._spawnWorker(`worker-${i}`);
    }
    this.pollInterval = setInterval(() => this._poll(), 50);
    console.log(`[WorkerPool] Started ${this.concurrency} workers`);
  }

  // New Node.js worker thread spawn control
  async _spawnWorker(workerId) {
    const thread = new Worker(this.workerScript, {
      workerData: { workerId, queueName: this.queue.name }
    });

    thread.on('message', (msg) => this._onWorkerMessage(workerId, msg));

    // Error recovery: crashed workers ko respawn karo
    thread.on('error', async (err) => {
      console.error(`[WorkerPool] Worker ${workerId} crashed: ${err.message}`);
      const state = this.workers.get(workerId);
      if (state?.jobId) {
        console.warn(`[WorkerPool] Job ${state.jobId} may re-process via lock expiry`);
      }
      if (!this.shuttingDown) {
        await sleep(1000); 
        await this._spawnWorker(workerId);
      }
    });

    thread.on('exit', (code) => {
      this.workers.delete(workerId);
      if (code !== 0 && !this.shuttingDown) {
        this._spawnWorker(workerId);
      }
    });

    this.workers.set(workerId, { thread, jobId: null, startedAt: null });
  }

  // Polling loop: waiting jobs ko consume karne ke liye check run karo
  async _poll() {
    if (this.shuttingDown) return;

    for (const [workerId, state] of this.workers) {
      if (state.jobId !== null) continue;

      const now = Date.now();
      let jobId;
      try {
        // Atomic Lua script execute karke active lock lagao
        jobId = await this.queue.redis.moveToActive(
          this.queue.keys.waiting,
          this.queue.keys.active,
          `queue:${this.queue.name}:`,
          now, 30000, workerId
        );
      } catch (err) {
        continue;
      }

      if (!jobId || typeof jobId !== 'string') continue;

      const jobMeta = await this.queue.redis.hgetall(this.queue.keys.job(jobId));
      state.jobId = jobId;
      state.startedAt = now;

      state.thread.postMessage({ type: 'JOB', job: jobMeta });
    }
  }

  // Worker thread message handler checks
  async _onWorkerMessage(workerId, msg) {
    const state = this.workers.get(workerId);
    if (!state) return;

    if (msg.type === 'JOB_COMPLETE') {
      await this.queue._markComplete(msg.jobId, workerId, msg.result);
      state.jobId = null;
    } else if (msg.type === 'JOB_FAILED') {
      await this.queue._handleFailure(msg.jobId, workerId, msg.error);
      state.jobId = null;
    } else if (msg.type === 'HEARTBEAT') {
      // Lock expiration TTL ko extend karo
      await this.queue.redis.pexpire(
        this.queue.keys.lock(msg.jobId), 30000
      );
    }
  }

  // Graceful shutdown logic: run queue tasks finish hone ka wait karo
  async shutdown(timeoutMs = 30000) {
    console.log('[WorkerPool] Graceful shutdown initiated...');
    this.shuttingDown = true;
    clearInterval(this.pollInterval);

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const busyWorkers = [...this.workers.values()].filter(w => w.jobId);
      if (busyWorkers.length === 0) break;
      console.log(`[WorkerPool] Waiting for ${busyWorkers.length} in-flight jobs...`);
      await sleep(500);
    }

    for (const { thread } of this.workers.values()) {
      await thread.terminate();
    }
    console.log('[WorkerPool] Shutdown complete.');
  }

  // Thread metrics read check
  async getWorkerStats() {
    const stats = { active: 0, idle: 0, total: this.workers.size };
    for (const state of this.workers.values()) {
      if (state.jobId) stats.active++;
      else stats.idle++;
    }
    return stats;
  }
}

module.exports = WorkerPool;
