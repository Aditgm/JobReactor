const Queue = require('./src/Queue');
const WorkerPool = require('./src/WorkerPool');
const Scheduler = require('./src/Scheduler');
const path = require('path');

// Global queue initialization connect check
const queue = new Queue(process.env.QUEUE_NAME || 'default', {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

const workerScript = path.join(__dirname, 'src', 'worker-thread.js');
const concurrency = parseInt(process.env.CONCURRENCY || '8', 10);

const pool = new WorkerPool(workerScript, { concurrency, queue });
const scheduler = new Scheduler(queue);

async function start() {
  await pool.start();
  scheduler.start(500);

  // Terminals exit handlers setup (SIGINT/SIGTERM check)
  process.on('SIGINT', async () => {
    scheduler.stop();
    await pool.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    scheduler.stop();
    await pool.shutdown();
    process.exit(0);
  });
}

start().catch(err => {
  console.error("Worker process start fail:", err);
  process.exit(1);
});
