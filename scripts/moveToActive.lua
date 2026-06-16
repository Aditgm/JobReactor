-- KEYS[1]: waiting sorted set   (queue:name:waiting)
-- KEYS[2]: active sorted set    (queue:name:active)
-- KEYS[3]: job hash prefix      (queue:name:job:)
-- ARGV[1]: current timestamp (ms)
-- ARGV[2]: lock TTL in ms       (e.g. 30000)
-- ARGV[3]: worker ID            (e.g. "worker-0-pid-1234")

-- Step 1: Waiting list se highest priority job atomically pop karo
local result = redis.call('ZPOPMIN', KEYS[1], 1)
if #result == 0 then
  return nil  -- Queue khali hai
end

local jobId = result[1]
local lockExpiry = tonumber(ARGV[1]) + tonumber(ARGV[2])

-- Step 2: Active sorted set mein job ID add karo lock expiry score ke sath
redis.call('ZADD', KEYS[2], lockExpiry, jobId)

-- Step 3: Distributed lock lagao - PX key checking
local lockKey = KEYS[3] .. 'lock:' .. jobId
redis.call('SET', lockKey, ARGV[3], 'PX', ARGV[2])

-- Step 4: Job state metadata update karke 'active' status set karo
local jobKey = KEYS[3] .. jobId
redis.call('HSET', jobKey,
  'status',      'active',
  'processedAt', ARGV[1],
  'workerId',    ARGV[3]
)

return jobId
