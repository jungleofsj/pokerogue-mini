/*
 * Generates pickup-data.json: the legendary gacha species pool extracted from
 * the pokerogue source tree, with English/Korean names from PokeAPI.
 *
 * Usage: node scripts/gen-pickup.js [path-to-pokerogue-repo]
 * Re-run after game updates that change the legendary egg pool.
 */
const fs = require("fs");
const path = require("path");

const repo = process.argv[2] || path.join(__dirname, "..", "..", "pokerogue");

// ---- parse the SpeciesId enum (auto-incrementing) ----
const enumSrc = fs.readFileSync(path.join(repo, "src/enums/species-id.ts"), "utf8");
const nameToId = {};
let counter = 0;
for (const line of enumSrc.split("\n")) {
  const m = line.match(/^\s*([A-Z][A-Z_0-9]*)(?:\s*=\s*(\d+))?\s*,/);
  if (m) {
    counter = m[2] !== undefined ? Number(m[2]) : counter + 1;
    nameToId[m[1]] = counter;
  }
}
if (!nameToId.MEWTWO || nameToId.MEWTWO !== 150) {
  throw new Error(`SpeciesId enum parse failed (MEWTWO=${nameToId.MEWTWO})`);
}

// ---- find species with eggTier LEGENDARY in the balance data ----
const genDir = path.join(repo, "src/data/balance/species");
const legendaryNames = [];
for (const file of fs.readdirSync(genDir)) {
  if (!file.endsWith(".ts")) {
    continue;
  }
  const src = fs.readFileSync(path.join(genDir, file), "utf8");
  const chunks = src.split(/\w+SpeciesData\[SpeciesId\.([A-Z_0-9]+)\]\s*=/);
  // chunks: [prefix, name1, body1, name2, body2, ...]
  for (let i = 1; i < chunks.length; i += 2) {
    if (/eggTier:\s*EggTier\.LEGENDARY/.test(chunks[i + 1])) {
      legendaryNames.push(chunks[i]);
    }
  }
}

// registry iterates Object.values keyed by numeric species id -> ascending id order
const pool = legendaryNames
  .map(n => {
    if (!nameToId[n]) {
      throw new Error(`unknown species name: ${n}`);
    }
    return { name: n, id: nameToId[n] };
  })
  .sort((a, b) => a.id - b.id)
  .filter(s => s.name !== "ETERNATUS");

console.log(`legendary pool: ${pool.length} species`);

// ---- fetch en/ko display names from PokeAPI ----
(async () => {
  const names = {};
  for (const s of pool) {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${s.id}/`);
    if (!res.ok) {
      throw new Error(`PokeAPI ${s.id}: ${res.status}`);
    }
    const data = await res.json();
    const pick = lang => data.names.find(n => n.language.name === lang)?.name;
    names[s.id] = { en: pick("en") || s.name, ko: pick("ko") || pick("en") || s.name };
    process.stdout.write(`${s.id} ${names[s.id].ko}  `);
  }
  console.log();
  const out = {
    generatedAt: new Date().toISOString(),
    pool: pool.map(s => s.id),
    names,
  };
  fs.writeFileSync(path.join(__dirname, "..", "pickup-data.json"), JSON.stringify(out, null, 1));
  console.log("wrote pickup-data.json");
})();
