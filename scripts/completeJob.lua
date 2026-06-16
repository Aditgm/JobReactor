-- KEYS[1]: active sorted set
-- KEYS[2]: completed sorted set
-- KEYS[3]: job key prefix
-- ARGV[1]: job ID
-- ARGV[2]: worker ID (ownership check ke liye)
-- ARGV[3]: serialized job processing result
-- ARGV[4]: current timestamp

local jobId    = ARGV[1]
local lockKey  = KEYS[3] .. 'lock:' .. jobId
local jobKey   = KEYS[3] .. jobId

-- CRITICAL: Completing status set karne se pehle lock verify karo
local lockOwner = redis.call('GET', lockKey)
if lockOwner ~= ARGV[2] then
  return 0  -- Lock lost ho gaya hai, complete nahi kar sakte
end

-- Active se remove karo, Completed list mein set karo aur lock delete karo
redis.call('ZREM',  KEYS[1], jobId)
redis.call('ZADD',  KEYS[2], ARGV[4], jobId)
redis.call('DEL',   lockKey)
redis.call('HSET',  jobKey,
  'status',      'completed',
  'completedAt', ARGV[4],
  'result',      ARGV[3]
)

return 1
