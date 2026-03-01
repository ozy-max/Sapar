/**
 * Sliding-window counter implemented as a single Redis hash.
 *
 * Advantages over token bucket for high-load edge:
 * - O(1) per request (no sorted-set trimming)
 * - Single key = cluster-safe (no multi-key transactions)
 * - Smooth rate enforcement across window boundaries
 *
 * KEYS[1] = rate-limit key  (e.g. "rl:identity:1.2.3.4")
 * ARGV[1] = window size in seconds
 * ARGV[2] = max requests per window
 * ARGV[3] = current epoch timestamp (seconds, fractional OK)
 *
 * Returns array: [allowed (0|1), remaining, resetAtEpochSec]
 */
export const SLIDING_WINDOW_SCRIPT = `
local key      = KEYS[1]
local window   = tonumber(ARGV[1])
local limit    = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])

local curWin   = math.floor(now / window)
local prevWin  = curWin - 1

local data      = redis.call('HMGET', key, 'w:' .. curWin, 'w:' .. prevWin)
local curCount  = tonumber(data[1]) or 0
local prevCount = tonumber(data[2]) or 0

local elapsed = now - (curWin * window)
local weight  = math.max(0, 1 - elapsed / window)

local estimated = math.floor(prevCount * weight) + curCount

if estimated >= limit then
  return { 0, 0, (curWin + 1) * window }
end

redis.call('HINCRBY', key, 'w:' .. curWin, 1)
redis.call('HDEL',    key, 'w:' .. (prevWin - 1))
redis.call('EXPIRE',  key, window * 2 + 1)

return { 1, limit - estimated - 1, (curWin + 1) * window }
`;

export interface LuaRateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAtEpochSec: number;
}

export function parseLuaResult(raw: [number, number, number]): LuaRateLimitResult {
  return {
    allowed: raw[0] === 1,
    remaining: raw[1],
    resetAtEpochSec: raw[2],
  };
}
