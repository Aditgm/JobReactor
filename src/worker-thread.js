const { parentPort, workerData } = require('worker_threads');
const { workerId } = workerData || {};

const handlers = new Map();

// Mock tasks handlers for testing and demonstration
handlers.set('email:send', async (data) => {
  // Network latency simulation
  await new Promise(r => setTimeout(r, 100));
  return { messageId: `msg-${Date.now()}` };
});

handlers.set('image:resize', async (data) => {
  await new Promise(r => setTimeout(r, 500));
  return { outputPath: `/tmp/resized-${Date.now()}.png` };
});

handlers.set('heavy:task', async (data) => {
  // Long running task simulation lock checking heartbeats test ke liye
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
  }
  return { done: true };
});

handlers.set('failing:task', async (data) => {
  throw new Error("This job always fails");
});

if (parentPort) {
  parentPort.on('message', async (msg) => {
    if (msg.type !== 'JOB') return;

    const { job } = msg;
    const data = JSON.parse(job.data);

    // Heartbeat: Har 10s pe lock extensions send karo main thread ko
    const heartbeat = setInterval(() => {
      parentPort.postMessage({ type: 'HEARTBEAT', jobId: job.id, workerId });
    }, 10000);

    try {
      const handler = handlers.get(job.name);
      if (!handler) throw new Error(`No handler for job type: ${job.name}`);

      const result = await handler(data);

      clearInterval(heartbeat);
      parentPort.postMessage({ type: 'JOB_COMPLETE', jobId: job.id, result });
    } catch (err) {
      clearInterval(heartbeat);
      parentPort.postMessage({
        type:    'JOB_FAILED',
        jobId:   job.id,
        error:   { message: err.message, stack: err.stack }
      });
    }
  });
}
