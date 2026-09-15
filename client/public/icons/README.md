# Technology icons

Fetched from [svgl.app](https://svgl.app) by `server/src/db/fetch-skill-icons.js`
and committed, not hot-linked. A profile that renders thirty skill chips would
otherwise make thirty cross-origin requests per page load, and the board would
go blank whenever svgl is down or rate-limits us.

```bash
node server/src/db/fetch-skill-icons.js           # refresh
node server/src/db/fetch-skill-icons.js --check   # report only, write nothing
```

`index.json` is the manifest of available slugs. `TechIcon` loads it once and
uses it to decide whether an icon exists, rather than rendering an <img> and
waiting for a 404 — which is why a skill with no icon (System Design, Problem
Solving) shows its label cleanly instead of a broken image.

## Trademarks

These are third-party marks, used to label the technology they belong to. That
is nominative use and is what every developer tool does; each mark remains the
property of its owner. Remove any file here if a rights holder asks — the UI
degrades to a plain label on its own.

## Why company logos are NOT done this way

svgl covers developer tools and startups, not employers. Matching it against the
companies actually on our job board gave **30% coverage by job row** — no
Databricks, Zscaler, Meesho, Swiggy, PhonePe, TCS or Infosys, which are most of
what matters for a KL placement. A board where seven cards in ten fall back and
three show artwork looks unfinished in a way that consistent treatment does not,
so companies get a deterministic monogram instead. See `CompanyMark.jsx`.
