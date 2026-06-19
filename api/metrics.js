const express = require('express');
const router = express.Router();

// Used memory string se parse karo human readable value
const parseRedisInfoMemory = (info) => {
  const match = info.match(/used_memory_human:([^\r\n]+)/);
  return match ? match[1] : 'Unknown';
};

// Queue status aur metrics endpoint
router.get('/metrics', async (req, res) => {
  const queue = req.queue;
  const { name } = queue;
  const keys = queue.keys;

  try {
    // Ek pipeline batch mein multiple metrics count call karo
    const [[, waitingDepth], [, activeCount], [, dlqSize], [, completedToday], [, redisInfo]] =
      await queue.redis.pipeline()
        .zcard(keys.waiting)
        .zcard(keys.active)
        .llen(keys.dlq)
        .zcount(keys.completed, Date.now() - 86400000, '+inf')
        .info('memory')
        .exec();

    // 5 minutes ki range mein completed jobs se throughput nikalo
    const fiveMinAgo = Date.now() - 300000;
    const completedRecently = await queue.redis.zcount(keys.completed, fiveMinAgo, '+inf');
    const throughputPerMin = Math.round(completedRecently / 5);

    // Dynamic worker status dashboard stats
    const workerHealth = { active: activeCount, idle: 0, total: activeCount }; 

    res.json({
      queueName:       name,
      waitingDepth,
      activeCount,
      dlqSize,
      completedToday,
      throughputPerMin,
      workerHealth,
      redisMemoryMB:   parseRedisInfoMemory(redisInfo),
      timestamp:       Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
