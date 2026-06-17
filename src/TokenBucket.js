const { setTimeout } = require('timers/promises');

class TokenBucket {
  constructor(ratePerSec, capacity) {
    this.rate      = ratePerSec;       // Ek second mein kitne tokens add honge
    this.capacity  = capacity;         // Maximum queue capacity burst support
    this.tokens    = capacity;         
    this.lastRefill = Date.now();
  }

  // Token refill calculation logic
  _refill() {
    const now     = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens    = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
  }

  // Ingestion limit control block
  async consume(n = 1) {
    this._refill();
    if (this.tokens < n) {
      // Agar tokens kam pad rahe hain toh waiting time calculate karo
      const waitMs = ((n - this.tokens) / this.rate) * 1000;
      await setTimeout(waitMs);
      this._refill();
    }
    this.tokens -= n;
  }
}

module.exports = TokenBucket;
