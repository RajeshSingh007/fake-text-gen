# Real-World Problems This Tool Solves

**One-line:** *"I need realistic data shaped like my database — but I can't use real
production data (privacy), and I don't have time to hand-write scripts for it."*

Paste a DB schema → get realistic, reproducible, scalable fake data in seconds.

---

## The problems, and who feels them

### 1. Empty database on local development
- **Who:** every developer who clones a repo.
- **Pain:** the app is empty; you can't build or see a feature with no data. You can't
  legally/safely copy production data to your laptop.
- **We solve:** generate a realistic local dataset straight from the schema.

### 2. Tests need fresh, reproducible data
- **Who:** anyone with automated tests / CI.
- **Pain:** tests need data that is realistic AND the same every run — else tests flake.
- **We solve:** seed-based generation → same seed = identical data forever (stable tests).

### 3. Staging & sales demos without real customer data
- **Who:** QA, sales engineers, product teams.
- **Pain:** demo/staging must LOOK full and real, but showing real customer data breaks
  privacy laws (GDPR/DPDP).
- **We solve:** fake-but-realistic data that is safe to show.

### 4. Performance / load testing at scale
- **Who:** backend engineers, DBAs.
- **Pain:** "does my query/index still work at 10 million rows?" — can't test scale on
  5 sample rows.
- **We solve:** generate millions of realistic rows in a flash (pool + code multiply).

### 5. Prototyping the UI before the backend exists
- **Who:** front-end teams.
- **Pain:** need data shaped like the FUTURE database to build the UI now.
- **We solve:** generate from the planned schema before any backend is built.

### 6. Onboarding, tutorials, open-source samples
- **Who:** new hires, learners, OSS maintainers.
- **Pain:** need a realistic sample dataset to explore an app / teach with.
- **We solve:** instant realistic sample database.

### 7. Privacy-safe analytics / AI training data
- **Who:** data teams.
- **Pain:** want to analyze/train on data without touching sensitive PII.
- **We solve:** fake data that keeps realistic shape/distribution but contains no real PII.
  (This is exactly what enterprise tools like Tonic.ai sell — we do a lightweight version.)

---

## Why not just ask an AI (ChatGPT/Gemini) to make the data?
Raw AI fails on the things these problems actually need:
- **Validity** — every row must obey rules (FKs valid, totals match). AI drifts.
- **Scale** — millions of rows. AI truncates and is slow/expensive.
- **Determinism** — same data every run for tests. AI is random.
- **Structure** — must match the schema exactly. AI adds stray text / breaks JSON.

We use AI only as ONE ingredient (niche fields); faker + our code do the guarantees.

---

## How each column gets its data (the type-map utility)
For every column in the pasted schema, a utility decides the source:
1. Match by **column name**  (email→faker.internet.email, city→faker.location.city)
2. Fall back to **column type** (INT→faker.number.int, VARCHAR→text)
3. If **niche** (dish, product) → AI recipe (once)
4. If **foreign key** → pick an existing parent row's id
5. If **unique constraint** → derive from a counter / new Set() dedup

See NOTES.md for the full pipeline and library choices.
