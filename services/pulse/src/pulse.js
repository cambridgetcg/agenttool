/**
 * PulseStore — In-memory agent presence store with optional Redis backing.
 * 
 * Falls back to pure in-memory if Redis is unavailable (dev mode).
 */

class PulseStore {
  constructor() {
    this.redis = null;
    this.memory = new Map(); // agent_id -> state
    this.historyMap = new Map(); // agent_id -> [events]
    this.aliveSet = new Map(); // agent_id -> last_pulse_ts
    
    this._initRedis();
  }

  async _initRedis() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log("[pulse] No REDIS_URL — using in-memory store");
      return;
    }
    try {
      const Redis = require("ioredis");
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 2000),
      });
      this.redis.on("error", (err) => {
        console.error("[pulse] Redis error:", err.message);
      });
      this.redis.on("connect", () => {
        console.log("[pulse] Redis connected");
      });
    } catch (err) {
      console.log("[pulse] Redis unavailable, using in-memory:", err.message);
      this.redis = null;
    }
  }

  async pulse(agentId, { status, context, did }) {
    const now = new Date().toISOString();
    const state = {
      agent_id: agentId,
      did: did || null,
      status,
      context,
      last_pulse: now,
      alive: true,
    };

    const event = { status, context, ts: now };

    if (this.redis) {
      const pipeline = this.redis.pipeline();
      // Current state (5min TTL)
      pipeline.set(`pulse:${agentId}`, JSON.stringify(state), "EX", 300);
      // History (push, trim to 100, 24h TTL)
      pipeline.lpush(`pulse:history:${agentId}`, JSON.stringify(event));
      pipeline.ltrim(`pulse:history:${agentId}`, 0, 99);
      pipeline.expire(`pulse:history:${agentId}`, 86400);
      // Alive set
      pipeline.zadd("pulse:alive", Date.now(), agentId);
      await pipeline.exec();
    } else {
      // In-memory fallback
      this.memory.set(agentId, state);
      
      if (!this.historyMap.has(agentId)) {
        this.historyMap.set(agentId, []);
      }
      const hist = this.historyMap.get(agentId);
      hist.unshift(event);
      if (hist.length > 100) hist.pop();
      
      this.aliveSet.set(agentId, Date.now());
    }

    return { recorded_at: now };
  }

  async get(agentId) {
    if (this.redis) {
      const raw = await this.redis.get(`pulse:${agentId}`);
      if (!raw) return null;
      const state = JSON.parse(raw);
      // Calculate uptime from first pulse (approximate)
      const lastPulse = new Date(state.last_pulse).getTime();
      const age = Date.now() - lastPulse;
      state.alive = age < 300000; // 5min timeout
      if (!state.alive) state.status = "offline";
      return state;
    }

    const state = this.memory.get(agentId);
    if (!state) return null;
    
    const lastPulse = new Date(state.last_pulse).getTime();
    const age = Date.now() - lastPulse;
    state.alive = age < 300000;
    if (!state.alive) state.status = "offline";
    return { ...state };
  }

  async history(agentId, limit = 50) {
    if (this.redis) {
      const raw = await this.redis.lrange(`pulse:history:${agentId}`, 0, limit - 1);
      return raw.map((r) => JSON.parse(r));
    }
    
    const hist = this.historyMap.get(agentId) || [];
    return hist.slice(0, limit);
  }

  async directory(limit = 50) {
    if (this.redis) {
      const cutoff = Date.now() - 300000; // 5min
      const agentIds = await this.redis.zrangebyscore("pulse:alive", cutoff, "+inf", "LIMIT", 0, limit);
      const agents = [];
      for (const id of agentIds) {
        const state = await this.get(id);
        if (state && state.alive) {
          agents.push({
            agent_id: state.agent_id,
            did: state.did,
            status: state.status,
            last_pulse: state.last_pulse,
          });
        }
      }
      const total = await this.redis.zcard("pulse:alive");
      const aliveCount = await this.redis.zcount("pulse:alive", cutoff, "+inf");
      return { agents, total, alive: aliveCount };
    }

    // In-memory
    const cutoff = Date.now() - 300000;
    const agents = [];
    let total = 0;
    for (const [id, ts] of this.aliveSet) {
      total++;
      if (ts >= cutoff && agents.length < limit) {
        const state = this.memory.get(id);
        if (state) {
          agents.push({
            agent_id: state.agent_id,
            did: state.did,
            status: state.status,
            last_pulse: state.last_pulse,
          });
        }
      }
    }
    return { agents, total, alive: agents.length };
  }

  async detectOffline(timeoutSec = 120) {
    const cutoff = Date.now() - (timeoutSec * 1000);
    const stale = [];

    if (this.redis) {
      const agentIds = await this.redis.zrangebyscore("pulse:alive", 0, cutoff);
      for (const id of agentIds) {
        stale.push(id);
        await this.redis.zrem("pulse:alive", id);
      }
    } else {
      for (const [id, ts] of this.aliveSet) {
        if (ts < cutoff) {
          stale.push(id);
          this.aliveSet.delete(id);
          this.memory.delete(id);
        }
      }
    }

    return stale;
  }
}

module.exports = { PulseStore };
