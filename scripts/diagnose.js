// Standalone diagnostic: prints exactly why profile scans are failing.
//   node --env-file-if-exists=.env scripts/diagnose.js [username-or-uuid]
import { config } from '../src/config.js';

const target = process.argv[2] || 'Technoblade';
const line = (s) => console.log(s);

line('=== SkyBlock Item Tracker — diagnostics ===\n');

// 1. Keys loaded?
line(`API keys loaded: ${config.hypixelApiKeys.length}`);
if (config.hypixelApiKeys.length === 0) {
  line('\n❌ NO API KEY LOADED. This is the problem.');
  line('   Your .env has no HYPIXEL_API_KEY / HYPIXEL_API_KEYS, or you ran');
  line('   `node` without --env-file. Fix: put a key in .env and start with');
  line('   `npm start` (which loads .env automatically).');
  process.exit(1);
}
config.hypixelApiKeys.forEach((k, i) => line(`  key ${i}: ${k.slice(0, 8)}… (len ${k.length})`));

// 2. Resolve the target to a UUID (tests Mojang/Ashcon reachability).
const undash = (s) => s.replace(/-/g, '').toLowerCase();
const isUuid = (s) => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s);
let uuid = isUuid(target) ? undash(target) : null;
if (!uuid) {
  line(`\nResolving "${target}" via Mojang…`);
  try {
    const r = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(target)}`);
    line(`  Mojang HTTP ${r.status}`);
    if (r.ok) { uuid = undash((await r.json()).id); line(`  → uuid ${uuid}`); }
    else { line('  ⚠ Mojang did not return a uuid; pass a UUID directly as the argument.'); }
  } catch (e) { line(`  ❌ Mojang unreachable: ${e.message}`); }
}

// 3. The actual test: hit /v2/skyblock/profiles with the key + header.
if (uuid) {
  const url = `${config.hypixelBase}/v2/skyblock/profiles?uuid=${uuid}`;
  for (let i = 0; i < config.hypixelApiKeys.length; i++) {
    const key = config.hypixelApiKeys[i];
    line(`\nTesting key ${i} (${key.slice(0, 8)}…) against /v2/skyblock/profiles…`);
    try {
      const res = await fetch(url, { headers: { 'API-Key': key } });
      line(`  HTTP ${res.status} ${res.statusText}`);
      line(`  RateLimit-Remaining: ${res.headers.get('ratelimit-remaining') ?? 'n/a'} / ${res.headers.get('ratelimit-limit') ?? 'n/a'}`);
      const body = await res.text();
      let j; try { j = JSON.parse(body); } catch { j = null; }
      if (res.ok && j && j.success) {
        line(`  ✅ SUCCESS — ${(j.profiles || []).length} profile(s) returned. This key works.`);
      } else {
        line(`  ❌ FAILED — cause: ${(j && j.cause) || body.slice(0, 200)}`);
        if (res.status === 403) line('     → 403 usually means the KEY IS INVALID. Regenerate it at https://developer.hypixel.net');
        if (res.status === 429) line('     → 429 means THROTTLED. Wait a few minutes; the app backs off automatically.');
      }
    } catch (e) {
      line(`  ❌ Request error: ${e.message}`);
      line('     → If this says fetch failed / ENOTFOUND, your network/firewall is blocking api.hypixel.net.');
    }
  }
}

line('\n=== done ===');
