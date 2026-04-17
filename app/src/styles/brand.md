# Mane Line — Brand Tokens (Cream / Green / Black)

> **Status:** Working palette pulled from the Silver Lining Herbs reference
> storefront (logo leaf + "Take the Quiz" action button + packaging cream).
> Published to `src/styles/index.css` 2026-04-17. Will be re-confirmed or
> replaced once Silver Lining supplies a formal brand guide.

## Palette

| Token              | Value                        | Intent                                      |
|--------------------|------------------------------|---------------------------------------------|
| `--primary`        | `#3D7A3D`                    | Herb green — brand chrome, headings, links  |
| `--accent`         | `#67B04A`                    | Action green — CTAs, highlights, success    |
| `--secondary`      | `#E4EAD5`                    | Soft sage-cream — pill backgrounds, chips   |
| `--color-sage`     | `#A8C49A`                    | Supporting sage — badges, illustrations     |
| `--background`     | `#F5EFE0`                    | Cream — app background                      |
| `--card`           | `#FFFDF5`                    | Warm white — cards, elevated surfaces       |
| `--foreground`     | `#1A1A1A`                    | Near-black — body copy                      |
| `--muted`          | `#ECE4D0`                    | Muted cream surface (shadcn)                |
| `--muted-foreground` | `#5A5F5A`                  | Secondary text                              |
| `--border`         | `rgba(61,122,61,.22)`        | Hairlines derived from `--primary`          |
| `--destructive`    | `#C13A3A`                    | Warn / revoke / errors                      |

## How tokens are wired

Two token families live in `src/styles/index.css`:

1. **Legacy literal tokens** — `--color-primary`, `--color-bg`,
   `--color-ink`, `--color-surface`, `--text-muted`, `--color-line`,
   `--color-sage`. Phase 0 pages (Home, Login, portal shells, signup)
   use these directly via inline `style={{...}}`. Keep until Phase 1
   migrates each page to shadcn + Tailwind utilities.
2. **shadcn/ui semantic tokens** — `--background`, `--foreground`,
   `--primary`, `--card`, `--border`, etc. New components (Phase 1+)
   reach these through Tailwind utilities: `bg-background`,
   `text-primary`, `border-border`. The `@theme inline` block in
   `index.css` publishes each as a Tailwind v4 color utility.

## Typography

- **Display** — `Playfair Display` (serif). Used on `h1–h3`.
- **Sans** — `Inter`. Used for body + forms.

Both are load-on-demand Google Fonts; wire the `<link>` in `index.html`
when the design polish pass lands in Phase 1.

## Chrome rules (binding — do not change with palette)

1. **Owner / Trainer / Vet** portal chrome displays **"Mane Line"** only.
   No "Silver Lining Herbs" co-branding in headers, footers, or auth
   emails for these audiences.
2. **Admin (Silver Lining)** portal chrome may display full Silver
   Lining identity — this portal is internal to the client.
3. The public marketing site (`/`, `/login`, `/signup`) uses Mane Line
   chrome only.

## When the brand guide arrives

Update in this order:
1. This file (palette table + provenance note).
2. The `:root` + `@theme inline` blocks in `src/styles/index.css`.
3. `grep -rn "#3D7A3D\|#67B04A\|#F5EFE0\|#FFFDF5\|#1A1A1A" app/src`
   and replace any hard-coded literals that sneaked in.
