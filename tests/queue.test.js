const test = require('node:test');
const assert = require('node:assert');
const Redis = require('ioredis');
const Queue = require('../src/Queue');

// Redis connection availability check karo
async function checkRedisOnline() {
  const tempRedis = new Redis({
    host: 'localhost',
    port: 6379,
    connectTimeout: 500,
    maxRetriesPerRequest: 0,
  });

  try {
    await tempRedis.ping();
    await tempRedis.quit();
    return true;
  } catch (err) {
    try {
      tempRedis.disconnect();
    } catch (_) {}
    return false;
  }
}

async function runTests() {
  const isOnline = await checkRedisOnline();
  if (!isOnline) {
    console.warn("⚠️ Local Redis server online nahi hai. Skipping unit tests.");
    return;
  }

  test('Queue Class Tests', async (t) => {
    // Test run ke liye Redis connect karo
    const redis = new Redis({ host: 'localhost', port: 6379 });
    
    const testQueueName = 'test-queue';
    const queue = new Queue(testQueueName, { host: 'localhost', port: 6379 });

    t.after(async () => {
      // Connections terminate karo
      await queue.redis.quit();
      await redis.quit();
    });

    await t.test('should connect and define commands', () => {
      assert.ok(queue.redis);
      assert.strictEqual(typeof queue.redis.moveToActive, 'function');
      assert.strictEqual(typeof queue.redis.completeJob, 'function');
    });

    await t.test('should successfully add a job to the queue', async () => {
      // Test database clean karo runs se pehle
      await redis.del(queue.keys.waiting, queue.keys.delayed);

      const jobId = await queue.add('test-job', { payload: 'hello' }, { priority: 2 });
      assert.ok(jobId);

      // Verify metadata properties save check
      const jobKey = queue.keys.job(jobId);
      const jobData = await redis.hgetall(jobKey);
      
      assert.strictEqual(jobData.id, jobId);
      assert.strictEqual(jobData.name, 'test-job');
      assert.strictEqual(JSON.parse(jobData.data).payload, 'hello');
      assert.strictEqual(jobData.priority, '2');
      assert.strictEqual(jobData.status, 'waiting');

      await redis.del(jobKey, queue.keys.waiting);
    });

    await t.test('should successfully add delayed jobs', async () => {
      await redis.del(queue.keys.delayed);

      const jobId = await queue.add('test-delayed-job', { payload: 'delayed' }, { delay: 1000 });
      assert.ok(jobId);

      // Verify job delayed set mein save ho gaya hai
      const inDelayed = await redis.zscore(queue.keys.delayed, jobId);
      assert.ok(inDelayed);
      assert.ok(parseFloat(inDelayed) > Date.now());

      await redis.del(queue.keys.job(jobId), queue.keys.delayed);
    });
  });
}

runTests();
