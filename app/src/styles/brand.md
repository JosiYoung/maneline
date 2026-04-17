# Mane Line — Brand Tokens (PLACEHOLDERS)

> **Status:** PLACEHOLDER — Phase 0 only.
> These values are stand-ins so the portal shells render coherently during
> build-out. **Do not treat any value here as final.** Silver Lining Herbs
> will supply the canonical Mane Line brand (palette, type system, logo lockup)
> in a later phase. When that lands, update this file _and_
> `src/styles/index.css` in the same commit.

## Current placeholder palette

| Token               | Value       | Intent                                               |
|---------------------|-------------|------------------------------------------------------|
| `--color-primary`   | `#1E3A5F`   | Primary chrome (navy — placeholder for brand primary) |
| `--color-accent`    | `#C9A24C`   | Accent / CTAs (warm gold — placeholder)              |
| `--color-bg`        | `#FAF8F3`   | App background (warm cream — placeholder)            |
| `--color-sage`      | `#8BA678`   | Supporting accent (sage — placeholder)               |
| `--color-ink`       | `#1A1A1A`   | Body copy                                            |
| `--color-muted`     | `#5c6160`   | Secondary copy                                       |
| `--color-line`      | `rgba(30,58,95,.15)` | Hairlines / borders                         |
| `--color-surface`   | `#ffffff`   | Cards / elevated surfaces                            |

## Typography (placeholders)

- **Display** — `Playfair Display` (serif). Placeholder pending brand direction.
- **Sans** — `Inter`. Likely to remain; confirm during brand pass.

## Chrome rules (binding, not placeholder)

These are governance rules, not visual guesses, and they do not change with
the brand pass:

1. **Owner / Trainer / Vet** portal chrome displays **"Mane Line"** only.
   No "Silver Lining Herbs" co-branding in headers, footers, or auth emails
   for these audiences.
2. **Admin (Silver Lining)** portal chrome may display full Silver Lining
   identity — this portal is internal to the client.
3. The public marketing site (root `/`, `/login`, `/signup`) uses Mane Line
   chrome only. Silver Lining co-branding was removed per the post-2026-04-15
   call.

## When the real brand lands

Ping whoever supplies the brand for:
- Final hex values for primary / accent / neutrals (+ dark variant if applicable)
- Logo lockup (SVG, monochrome + full color)
- Typography license (Google Fonts is acceptable today — verify in brand pass)
- Shadow / radius / motion tokens

Then update:
1. This file (replace the placeholder table; change the status banner)
2. `src/styles/index.css` `@theme { ... }` block
3. Any hard-coded color literals in components (`grep -r "#1E3A5F" src/` etc.)
