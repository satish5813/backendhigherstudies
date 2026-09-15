# Brand assets

**Installed.** `kl-lockup.png` and `kl-seal.png` are the official KL artwork,
trimmed and knocked transparent so they sit on any surface. Replace them with
SVG (`kl-lockup.svg` / `kl-seal.svg`) whenever the vector files are to hand —
those are tried first and stay sharp at favicon size.

Drop the two official KL marks in this folder, with these exact filenames. The
app looks for them by name and falls back to a typographic monogram until they
are here, so nothing breaks in the meantime — it just is not the real logo yet.

| File | What it is | Used for |
| --- | --- | --- |
| `kl-lockup.png` | The horizontal lockup: seal + **KL** wordmark + `(DEEMED TO BE UNIVERSITY)` | Landing header, login, emails, PDF footers |
| `kl-seal.png` | The circular gear seal on its own | App sidebar, favicon, small spaces, watermark |

SVG is better than PNG if you have it — `kl-lockup.svg` and `kl-seal.svg` are
picked up first and stay sharp at any size, which matters for the seal's fine
line work. PNG should be at least 1200px wide on the long edge, with a
transparent background.

## Colours taken from the mark

```
crimson   #a41c24   sampled from the seal    → brand-600
deep      #8a1820   one step darker          → brand-700
seal      #141414   the gear ring            → ink-900 / seal
```

These are already in `tailwind.config.js`. If the official brand guide gives
exact values that differ, change them there and the whole product follows.
