/*
 * Computes the featured legendary of the daily gacha rotation locally,
 * replicating pokerogue's getLegendaryGachaSpeciesForTimestamp():
 * a Phaser RandomDataGenerator seeded with shiftCharCodes(EGG_SEED, cycle)
 * shuffles the legendary pool; the day index within the cycle picks one.
 *
 * Pool/name data comes from pickup-data.json (regenerate with
 * scripts/gen-pickup.js after game updates that change the egg pool).
 */
const data = require("./pickup-data.json");

const EGG_SEED = "1073741824";
const DAY_MS = 86400000;

// ---- faithful port of Phaser.Math.RandomDataGenerator (sow/hash/rnd/frac/shuffle) ----
function makeRng(seedStr) {
  let n = 0xefc8249d;
  let s0;
  let s1;
  let s2;
  let c = 1;
  const hash = str => {
    let h;
    str = str.toString();
    for (let i = 0; i < str.length; i++) {
      n += str.charCodeAt(i);
      h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000; // 2^32
    }
    return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
  };
  s0 = hash(" ");
  s1 = hash(" ");
  s2 = hash(" ");
  s0 -= hash(seedStr);
  s0 += ~~(s0 < 0);
  s1 -= hash(seedStr);
  s1 += ~~(s1 < 0);
  s2 -= hash(seedStr);
  s2 += ~~(s2 < 0);
  const rnd = () => {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10;
    c = t | 0;
    s0 = s1;
    s1 = s2;
    s2 = t - c;
    return s2;
  };
  const frac = () => rnd() + ((rnd() * 0x200000) | 0) * 1.1102230246251565e-16; // 2^-53
  return { frac };
}

function shiftCharCodes(str, shiftCount) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) + (shiftCount || 0));
  }
  return out;
}

function speciesForEpochDay(epochDay) {
  const pool = data.pool;
  const cycle = Math.floor(epochDay / pool.length);
  const index = epochDay % pool.length;
  const rng = makeRng(shiftCharCodes(EGG_SEED, cycle));
  const arr = pool.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.frac() * (i + 1));
    const tmp = arr[j];
    arr[j] = arr[i];
    arr[i] = tmp;
  }
  return arr[index];
}

/** Upcoming `count`-day pickup list starting today (UTC day boundary, as the game uses). */
function getUpcoming(count = 7) {
  const todayEpochDay = Math.floor(Date.now() / DAY_MS);
  const out = [];
  for (let d = 0; d < count; d++) {
    const epochDay = todayEpochDay + d;
    const id = speciesForEpochDay(epochDay);
    const names = data.names[id] || { en: String(id), ko: String(id) };
    const date = new Date(epochDay * DAY_MS);
    out.push({
      id,
      en: names.en,
      ko: names.ko,
      // the rotation flips at 00:00 UTC = 09:00 KST; label by the UTC date
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      today: d === 0,
    });
  }
  return out;
}

module.exports = { getUpcoming, speciesForEpochDay };
