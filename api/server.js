const express = require('express');
const cors = require('cors');
const Queue = require('../src/Queue');
const metricsRouter = require('./metrics');

const app = express();
app.use(cors());
app.use(express.json());

// Redis setup aur queue initialization
const queue = new Queue(process.env.QUEUE_NAME || 'default', {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

// Middleware: Express request objects mein queue attach karo
app.use((req, res, next) => {
  req.queue = queue;
  next();
});

app.use('/api', metricsRouter);

// Job enqueue karne ke liye post router endpoint
app.post('/api/enqueue', async (req, res) => {
  try {
    const { name, data, opts } = req.body;
    const jobId = await queue.add(name, data, opts);
    res.json({ success: true, jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[API] Server listening on port ${PORT}`);
});
