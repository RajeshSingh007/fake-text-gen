# Project Notes — Realistic Test-Data Generator (working name TBD)

## Core idea (why it beats "just ask Gemini")
Raw AI gives text that is: not schema-valid, not reproducible, not scalable to lakhs,
and hallucinates facts. We give GUARANTEES instead:
1. Validity   – every row obeys rules (total = sum, deliveryDate > orderDate)
2. Scale      – 1 lakh rows in ~15ms in-browser (see demo.js)
3. Determinism – same seed -> same data, forever
4. Real verified edge-case data – curated, not hallucinated  <-- the moat

## The 3 ingredients (kitchen analogy)
- CURATED LIBRARY = universal ingredients always in the kitchen (real names, cities,
  countries, RTL strings, emoji, "naughty strings"). Verified, bundled, no AI call.
- AI (recipe)     = specialist chef, called ONCE, only for niche/domain fields
  (e.g. "Mumbai dishes + price ranges"). Returns a small config, NOT bulk data.
- CODE ENGINE     = the machine that cooks a million plates (multiply, distributions,
  uniqueness, referential integrity, output).

## DECISION: Phase 1 uses EXISTING packages only — no hand-authored data
"Curated library" in Phase 1 = a thin module that imports + picks from existing packages
below. We do NOT hand-write data. No moat from data yet, and that's fine — validate first.
The moat (our own verified layer + community + real-bug harvesting) is deferred to LATER,
and only if the tool gets traction. Do not build a custom dataset upfront.

| Need                              | Package / source            | Notes                              |
|-----------------------------------|-----------------------------|------------------------------------|
| Base real pools (names/addr/co.)  | @faker-js/faker             | commodity base of the library      |
| Nasty edge-case strings           | Big List of Naughty Strings | GitHub, free — MOAT material       |
| Country names/codes               | i18n-iso-countries          |                                    |
| Cities / geo                      | GeoNames / all-the-cities   |                                    |
| Per-language formats, RTL, dates  | Unicode CLDR / cldr-data    | i18n stress                        |
| Phone formats per country         | libphonenumber-js           |                                    |
| Statistical distributions         | d3-random, simple-statistics, jStat | realistic spread (bell/zipf) |
| Parse pasted SQL schema           | node-sql-parser             | reads CREATE TABLE + FOREIGN KEY   |
| Big-scale dedup (later)           | bloom-filters               | for now new Set() is fine          |

## Algorithms (proper names)
- Seeded PRNG (mulberry32)          -> determinism
- Weighted sampling / alias method  -> realistic popularity (Zipf/power-law)
- Normal / log-normal distributions -> realistic spread (prices, ages)
- Topological sort (of FK DAG)      -> generate parent tables before children
- Hash set (new Set) / Bloom filter -> uniqueness
- Lazy generators (function*)       -> streaming huge output (ON HOLD for now)
- IPOG / covering arrays            -> pairwise stress-test coverage (Phase 2)
- Binary search on widths           -> exact layout breakpoint ("breaks at 24 chars") (Phase 2)

## Decisions locked so far
- Browser generates synchronously up to ~1 lakh instantly; batch + "load more" beyond.
  Lazy/streaming = ON HOLD (only needed for 10M+ / server-side export).
- Use new Set() for dedup now; Bloom filter only if we hit 10M+ scale.
- Phase 1 = data engine: (a) Schema -> realistic data, (b) Recipe -> scaled data.
- Phase 2 = UI stress-testing (browser extension / library, due to iframe cross-origin limit).
