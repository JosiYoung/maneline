# MANE LINE — Frontend UI Guide
**For Claude Code Reference | OAG / Obsidian Axis Group**
Version 1.0 | 16 April 2026 | Prepared by Cedric / OAG

---

## 0. How to Use This Document

This is the single source of truth for how UI is built in Mane Line. Before writing any component, page, or layout, read the relevant section here first. Every decision in this guide exists to eliminate a specific waste from the development process.

**The three rules that override everything else:**
1. shadcn/ui is the default for all UI. Do not reach for anything else first.
2. HeroUI is used only for the Owner Portal mobile card layer. Not globally.
3. No component ships without a Tailwind design token. No hardcoded hex values ever.

---

## 1. Stack Overview

| Layer | Tool | Purpose | Scope |
|---|---|---|---|
| **Primary UI** | shadcn/ui | All forms, tables, modals, nav, admin | All 3 portals |
| **Mobile UI** | HeroUI | Animal card stack, mobile touch targets | Owner Portal only |
| **Charts** | Recharts | KPI dashboard, P&L views, analytics | Silver Lining + Trainer |
| **Icons** | Lucide React | All iconography | All 3 portals |
| **Animation** | Framer Motion | Page transitions, card entrance, swipe | Owner Portal primarily |
| **Forms** | React Hook Form + Zod | All form state + validation | All 3 portals |
| **Tables** | TanStack Table v8 | Headless table engine inside shadcn DataTable | Silver Lining + Trainer |
| **PDF export** | React PDF Renderer | Vet records export, white-label invoices | Owner + Trainer |
| **Payments UI** | Stripe Elements (React) | All payment surfaces — never build custom card inputs | All 3 portals |
| **Toasts** | Sonner | Supplement reminders, session flags, errors | All 3 portals |
| **Styling** | Tailwind CSS v4 | All styling — no other CSS approaches | All 3 portals |

---

## 2. Project Setup

### 2.1 Repository Structure

```
maneline/
├── src/
│   ├── components/
│   │   ├── ui/                  ← shadcn/ui components live here (copy-paste)
│   │   ├── owner/               ← Owner Portal components
│   │   ├── trainer/             ← Trainer Portal components
│   │   ├── admin/               ← Silver Lining Portal components
│   │   └── shared/              ← Components used across portals
│   ├── pages/
│   │   ├── app/                 ← Owner Portal routes (/app/*)
│   │   ├── trainer/             ← Trainer Portal routes (/trainer/*)
│   │   └── admin/               ← Silver Lining Portal routes (/admin/*)
│   ├── lib/
│   │   ├── utils.ts             ← cn() helper and shared utilities
│   │   ├── supabase.ts          ← Supabase client
│   │   └── stripe.ts            ← Stripe client init
│   ├── hooks/                   ← Custom React hooks
│   ├── styles/
│   │   └── globals.css          ← Tailwind base + CSS variables
│   └── types/                   ← Shared TypeScript types
├── components.json              ← shadcn/ui config
├── tailwind.config.ts           ← Design tokens live here
└── vite.config.ts
```

### 2.2 Initial Install Commands

Run these once when setting up the project. Order matters.

```bash
# 1. Initialize shadcn/ui in the existing Vite + React project
npx shadcn@latest init

# When prompted, choose:
# ✔ Which style would you like to use? › Default
# ✔ Which color would you like to use as the base color? › Slate
# ✔ Would you like to use CSS variables for theming? › Yes

# 2. Install HeroUI (Owner Portal mobile layer only)
npm install @heroui/react framer-motion

# 3. Install supporting libraries
npm install lucide-react
npm install react-hook-form @hookform/resolvers zod
npm install @tanstack/react-table
npm install recharts
npm install sonner
npm install @react-pdf/renderer

# 4. Install Stripe Elements
npm install @stripe/react-stripe-js @stripe/stripe-js

# 5. Verify Tailwind v4 is installed
npm install tailwindcss@latest @tailwindcss/vite
```

### 2.3 components.json (shadcn/ui config)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/styles/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

### 2.4 Tailwind Config (Design Tokens)

**CRITICAL:** All brand colors go here as CSS variables. Never hardcode a hex value in a component. When Silver Lining's brand guide arrives, update only this file and every component updates automatically.

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand tokens (update these when brand guide arrives) ──
        brand: {
          navy:    "hsl(var(--brand-navy))",
          gold:    "hsl(var(--brand-gold))",
          sage:    "hsl(var(--brand-sage))",
          cream:   "hsl(var(--brand-cream))",
        },
        // ── shadcn/ui semantic tokens (do not change) ──
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        card: {
          DEFAULT:     "hsl(var(--card))",
          foreground:  "hsl(var(--card-foreground))",
        },
        primary: {
          DEFAULT:     "hsl(var(--primary))",
          foreground:  "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:     "hsl(var(--secondary))",
          foreground:  "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:     "hsl(var(--muted))",
          foreground:  "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:     "hsl(var(--accent))",
          foreground:  "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT:     "hsl(var(--destructive))",
          foreground:  "hsl(var(--destructive-foreground))",
        },
        border:   "hsl(var(--border))",
        input:    "hsl(var(--input))",
        ring:     "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

### 2.5 globals.css (CSS Variables)

```css
/* src/styles/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* ── Brand palette (PLACEHOLDER — update after Silver Lining brand guide) ── */
    --brand-navy:    220 47% 19%;    /* #1B2B4B — primary */
    --brand-gold:    43 49% 55%;     /* #C9A84C — accent */
    --brand-sage:    128 15% 55%;    /* #7A9E7E — secondary */
    --brand-cream:   40 30% 96%;     /* #F8F5EF — background warm */

    /* ── shadcn/ui base tokens ── */
    --background:   0 0% 100%;
    --foreground:   222 47% 11%;

    --card:         0 0% 100%;
    --card-foreground: 222 47% 11%;

    --primary:      220 47% 19%;     /* maps to brand-navy */
    --primary-foreground: 43 49% 85%;

    --secondary:    128 15% 93%;
    --secondary-foreground: 128 15% 20%;

    --muted:        210 40% 96%;
    --muted-foreground: 215 16% 47%;

    --accent:       43 49% 55%;      /* maps to brand-gold */
    --accent-foreground: 43 49% 15%;

    --destructive:  0 84% 60%;
    --destructive-foreground: 0 0% 98%;

    --border:       214 32% 91%;
    --input:        214 32% 91%;
    --ring:         220 47% 19%;

    --radius: 0.5rem;
  }

  .dark {
    --background:   222 47% 7%;
    --foreground:   210 40% 98%;
    --card:         222 47% 10%;
    --card-foreground: 210 40% 98%;
    --primary:      43 49% 65%;      /* gold as primary in dark mode */
    --primary-foreground: 220 47% 10%;
    --secondary:    217 33% 17%;
    --secondary-foreground: 210 40% 98%;
    --muted:        217 33% 17%;
    --muted-foreground: 215 20% 65%;
    --accent:       128 15% 30%;
    --accent-foreground: 128 15% 90%;
    --destructive:  0 63% 31%;
    --destructive-foreground: 210 40% 98%;
    --border:       217 33% 17%;
    --input:        217 33% 17%;
    --ring:         43 49% 65%;
  }
}

@layer base {
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}
```

---

## 3. shadcn/ui — Rules and Patterns

### 3.1 How shadcn/ui Works (Read This First)

shadcn/ui is NOT an npm package you import from. It is a code generator. When you run `npx shadcn add button`, it copies the component source code into `src/components/ui/button.tsx`. You own that file. You can edit it. There is no version to update — the component is yours.

**This is intentional and is a feature, not a bug.** It means:
- No library updates breaking your UI
- Full TypeScript types you can inspect
- Brand customization without fighting override specificity
- Zero bundle bloat from unused components

### 3.2 Installing Components

Always install only what you need. Do not bulk-install all shadcn components.

```bash
# Install individual components as you need them
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add card
npx shadcn@latest add table
npx shadcn@latest add dialog
npx shadcn@latest add form
npx shadcn@latest add select
npx shadcn@latest add badge
npx shadcn@latest add avatar
npx shadcn@latest add separator
npx shadcn@latest add toast
npx shadcn@latest add sheet        # mobile sidebar
npx shadcn@latest add dropdown-menu
npx shadcn@latest add command      # command palette / search
npx shadcn@latest add data-table   # includes TanStack Table integration
```

### 3.3 The cn() Utility

Every component uses `cn()` to merge Tailwind classes. Always use it when combining classes conditionally.

```typescript
// src/lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Usage:
```tsx
// ✅ Correct — conditional classes merged cleanly
<button className={cn(
  "px-4 py-2 rounded-md font-medium",
  isActive && "bg-primary text-primary-foreground",
  isDisabled && "opacity-50 cursor-not-allowed"
)}>
  Click me
</button>
```

### 3.4 Core Component Patterns

#### Button

```tsx
import { Button } from "@/components/ui/button";

// Variants available: default | destructive | outline | secondary | ghost | link
// Sizes: default | sm | lg | icon

// Primary action (navy background)
<Button>Save protocol</Button>

// Secondary / cancel
<Button variant="outline">Cancel</Button>

// Danger (revoke access, delete record)
<Button variant="destructive">Revoke access</Button>

// Icon-only button — always add aria-label
<Button variant="ghost" size="icon" aria-label="Open menu">
  <MoreHorizontal className="h-4 w-4" />
</Button>
```

#### Form (React Hook Form + Zod + shadcn/ui)

This is the standard pattern for every form in Mane Line. Do not deviate from it.

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// 1. Define schema
const horseProfileSchema = z.object({
  name: z.string().min(1, "Horse name is required"),
  breed: z.string().optional(),
  dateOfBirth: z.string().optional(),
});

type HorseProfileValues = z.infer<typeof horseProfileSchema>;

// 2. Build form component
export function HorseProfileForm() {
  const form = useForm<HorseProfileValues>({
    resolver: zodResolver(horseProfileSchema),
    defaultValues: { name: "", breed: "", dateOfBirth: "" },
  });

  function onSubmit(values: HorseProfileValues) {
    // Call Supabase / Cloudflare Worker here
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Horse name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Duchess" {...field} />
              </FormControl>
              <FormMessage /> {/* Shows Zod error automatically */}
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full">
          Save horse profile
        </Button>
      </form>
    </Form>
  );
}
```

#### Card

```tsx
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

// Standard card layout
<Card>
  <CardHeader>
    <CardTitle>Duchess</CardTitle>
    <CardDescription>Quarter Horse · 8 years old</CardDescription>
  </CardHeader>
  <CardContent>
    {/* main content */}
  </CardContent>
  <CardFooter className="flex justify-between">
    <Button variant="outline">View history</Button>
    <Button>Log dose</Button>
  </CardFooter>
</Card>
```

#### Data Table (Silver Lining + Trainer Portal)

shadcn/ui's DataTable wraps TanStack Table. Install with `npx shadcn@latest add data-table`.

```tsx
// Column definition example for user directory
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";

type User = {
  id: string;
  name: string;
  role: "owner" | "trainer" | "silver_lining";
  animalCount: number;
  createdAt: string;
};

export const columns: ColumnDef<User>[] = [
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => {
      const role = row.getValue("role") as string;
      return (
        <Badge variant={role === "trainer" ? "default" : "secondary"}>
          {role}
        </Badge>
      );
    },
  },
  {
    accessorKey: "animalCount",
    header: "Animals",
  },
];
```

#### Dialog / Modal

```tsx
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// Access grant confirmation — this is a trust-critical action
<Dialog>
  <DialogTrigger asChild>
    <Button>Grant trainer access</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Grant access to Sarah Mitchell?</DialogTitle>
      <DialogDescription>
        Sarah will be able to view and log sessions for Duchess. You can revoke this at any time.
      </DialogDescription>
    </DialogHeader>
    {/* Scope selection form goes here */}
    <Button className="w-full">Confirm access grant</Button>
  </DialogContent>
</Dialog>
```

#### Badge

Used throughout for role tags, protocol status, invoice status, priority indicators.

```tsx
import { Badge } from "@/components/ui/badge";

// Variants: default | secondary | destructive | outline
<Badge>Active</Badge>                           // primary color (navy)
<Badge variant="secondary">Pending</Badge>      // muted
<Badge variant="destructive">Overdue</Badge>    // red
<Badge variant="outline">P0</Badge>             // outlined
```

### 3.5 Portal Navigation Patterns

#### Owner Portal — Bottom nav (mobile-first)

```tsx
// src/components/owner/BottomNav.tsx
import { Home, PawPrint, ShoppingBag, User } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/app",            icon: Home,       label: "Today" },
  { to: "/app/animals",   icon: PawPrint,   label: "Animals" },
  { to: "/app/shop",      icon: ShoppingBag,label: "Shop" },
  { to: "/app/account",   icon: User,        label: "Account" },
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border pb-safe">
      <div className="flex items-center justify-around h-16">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-1 px-4 py-2 text-xs transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )
            }
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
```

#### Trainer Portal — Sidebar (desktop-first, Sheet on mobile)

```tsx
// Use shadcn/ui Sheet for mobile sidebar
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

// Mobile trigger
<Sheet>
  <SheetTrigger asChild>
    <Button variant="ghost" size="icon" className="md:hidden">
      <Menu className="h-5 w-5" />
    </Button>
  </SheetTrigger>
  <SheetContent side="left" className="w-64">
    <TrainerSidebarContent />
  </SheetContent>
</Sheet>
```

---

## 4. HeroUI — Rules and Patterns

### 4.1 Where HeroUI Is Used

**HeroUI is scoped to the Owner Portal only.** Specifically:
- The "Today" multi-animal card stack on `/app`
- The animal profile carousel
- Mobile-optimized tab navigation within animal profiles

Do NOT use HeroUI components in the Trainer Portal or Silver Lining Portal. Those portals use shadcn/ui exclusively.

### 4.2 HeroUI Provider Setup

HeroUI requires a provider wrapper. Add it to the Owner Portal layout only, not the app root.

```tsx
// src/pages/app/OwnerLayout.tsx
import { HeroUIProvider } from "@heroui/react";

export function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <HeroUIProvider>
      <div className="min-h-screen bg-background">
        {children}
        <BottomNav />
      </div>
    </HeroUIProvider>
  );
}
```

### 4.3 The Animal Card (Core Component)

This is the most important component in the Owner Portal. The "Today" view is a vertical stack of these cards — one per animal. Build this first and get it right.

```tsx
// src/components/owner/AnimalCard.tsx
import { Card, CardBody, CardFooter, Chip, Avatar } from "@heroui/react";
import { CheckCircle, AlertCircle } from "lucide-react";

type Protocol = {
  name: string;
  confirmed: boolean;
  timeSlot: string;
};

type AnimalCardProps = {
  id: string;
  name: string;
  species: "horse" | "dog";
  breed: string;
  photoUrl?: string;
  todaysProtocols: Protocol[];
  hasFlag: boolean;
  onCardPress: (id: string) => void;
};

export function AnimalCard({
  id,
  name,
  species,
  breed,
  photoUrl,
  todaysProtocols,
  hasFlag,
  onCardPress,
}: AnimalCardProps) {
  const confirmedCount = todaysProtocols.filter((p) => p.confirmed).length;
  const totalCount = todaysProtocols.length;
  const allDone = confirmedCount === totalCount;

  return (
    <Card
      isPressable
      onPress={() => onCardPress(id)}
      className="w-full"
      shadow="sm"
    >
      <CardBody className="p-4">
        <div className="flex items-center gap-3">
          <Avatar
            src={photoUrl}
            name={name}
            size="lg"
            className="flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-foreground truncate">{name}</h3>
              {hasFlag && (
                <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">{breed}</p>
          </div>
        </div>

        {/* Protocol progress */}
        {totalCount > 0 && (
          <div className="mt-3 space-y-2">
            {todaysProtocols.map((protocol) => (
              <div key={protocol.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {protocol.confirmed ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />
                  )}
                  <span className="text-sm">{protocol.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {protocol.timeSlot}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>

      <CardFooter className="px-4 py-3 border-t border-border">
        <div className="flex items-center justify-between w-full">
          <Chip
            size="sm"
            color={allDone ? "success" : "warning"}
            variant="flat"
          >
            {allDone ? "All done" : `${confirmedCount}/${totalCount} confirmed`}
          </Chip>
          <span className="text-xs text-muted-foreground">Tap for details →</span>
        </div>
      </CardFooter>
    </Card>
  );
}
```

### 4.4 Today View (Card Stack)

```tsx
// src/pages/app/TodayView.tsx
import { AnimalCard } from "@/components/owner/AnimalCard";
import { useNavigate } from "react-router-dom";

export function TodayView() {
  const navigate = useNavigate();
  // animals loaded from Supabase via react-query or similar

  return (
    <div className="px-4 py-6 space-y-3 pb-24"> {/* pb-24 for bottom nav clearance */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Today</h1>
        <span className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </span>
      </div>

      {animals.map((animal) => (
        <AnimalCard
          key={animal.id}
          {...animal}
          onCardPress={(id) => navigate(`/app/animal/${id}`)}
        />
      ))}
    </div>
  );
}
```

### 4.5 HeroUI Component Reference (Owner Portal Use Cases)

| Component | Use Case | Import |
|---|---|---|
| `Card` | Animal card, quick-action cards | `@heroui/react` |
| `Avatar` | Animal photo, user avatar | `@heroui/react` |
| `Chip` | Protocol status, species tag | `@heroui/react` |
| `Progress` | Protocol completion bar | `@heroui/react` |
| `Tabs` | Animal profile tabs (Overview, Health, Records) | `@heroui/react` |
| `Modal` | Mobile-optimized dose confirm | `@heroui/react` |
| `Spinner` | Loading state on card stack | `@heroui/react` |

**Do not use HeroUI for:** forms, tables, navigation beyond the tab component, data-dense views.

---

## 5. Portal-Specific Guidelines

### 5.1 Owner Portal (`/app/*`)

**Primary persona:** Horse owner in a barn. Phone in one hand, possibly gloves on, intermittent LTE.

**Rules:**
- Every interactive element minimum 44×44px tap target
- Critical actions (dose confirm) must be reachable in ≤ 2 taps from `/app`
- All text ≥ 16px — no small print on mobile forms
- Offline-tolerant: UI must degrade gracefully when fetch fails. Show cached state, not a blank screen
- Images load lazily — barn internet is slow
- Bottom nav is always visible (position: fixed)

**Palette:** Use `brand-navy` as primary, `brand-gold` for completed/success states, `brand-sage` for supplementary UI

### 5.2 Trainer Portal (`/trainer/*`)

**Primary persona:** Professional trainer running a business across multiple ranches.

**Rules:**
- Desktop-first layout with responsive mobile fallback
- Left sidebar navigation (Sheet on mobile)
- White-label invoice rendering must accept trainer's brand color — use a CSS variable `--trainer-brand` injected from their profile record in Supabase. Never hardcode a color in the invoice template.
- P&L and business views use Recharts — see Section 6
- Session logger is the highest-traffic page — optimize it for speed

**White-label injection pattern:**
```tsx
// src/components/trainer/TrainerBrandProvider.tsx
import { useTrainerProfile } from "@/hooks/useTrainerProfile";

export function TrainerBrandProvider({ children }: { children: React.ReactNode }) {
  const { data: profile } = useTrainerProfile();

  return (
    <div
      style={{
        // Inject trainer's brand color as a CSS variable
        // Falls back to brand-navy if trainer hasn't set one
        "--trainer-brand": profile?.brandColor ?? "hsl(220, 47%, 19%)",
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

// Then in invoice template:
// className="bg-[var(--trainer-brand)] text-white" — trainer's color, zero hardcoding
```

### 5.3 Silver Lining Portal (`/admin/*`)

**Primary persona:** SLH leadership viewing aggregate KPIs, managing content, running support.

**Rules:**
- All data tables use shadcn DataTable + TanStack Table v8
- KPI dashboard uses Recharts (see Section 6)
- Audit log must be read-only — no action buttons on audit rows
- Impersonation view must show a persistent "Viewing as [name] — view only" banner at the top, styled with `bg-destructive/10 text-destructive border-destructive`
- User directory: role filters, search via shadcn `Command` component

---

## 6. Recharts Patterns (Silver Lining + Trainer)

### 6.1 KPI Line Chart

```tsx
// src/components/admin/KpiLineChart.tsx
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type DataPoint = { date: string; value: number };

export function KpiLineChart({
  data,
  label,
  color = "hsl(220, 47%, 19%)",
}: {
  data: DataPoint[];
  label: string;
  color?: string;
}) {
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
          />
          <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            name={label}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### 6.2 Revenue Bar Chart (Trainer P&L)

```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// Usage: monthly revenue per horse
<ResponsiveContainer width="100%" height={240}>
  <BarChart data={monthlyRevenue}>
    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
    <Tooltip formatter={(value: number) => [`$${value}`, "Revenue"]} />
    <Bar dataKey="revenue" fill="hsl(220, 47%, 19%)" radius={[4, 4, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

---

## 7. Stripe Elements Pattern

Never build a custom card input. Always use Stripe Elements. This is non-negotiable — it is a PCI compliance and trust requirement.

```tsx
// src/components/shared/PaymentForm.tsx
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

// Inner form — must be inside <Elements>
function CheckoutForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.origin + "/app/payment-complete" },
    });

    if (error) {
      // Show error via Sonner toast
    } else {
      onSuccess();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <Button type="submit" className="w-full" disabled={!stripe}>
        Pay invoice
      </Button>
    </form>
  );
}

// Wrapper — clientSecret comes from Cloudflare Worker → Stripe API
export function PaymentForm({
  clientSecret,
  onSuccess,
}: {
  clientSecret: string;
  onSuccess: () => void;
}) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CheckoutForm onSuccess={onSuccess} />
    </Elements>
  );
}
```

---

## 8. Toast Notifications (Sonner)

```tsx
// src/main.tsx — add Toaster once at app root
import { Toaster } from "sonner";

<Toaster position="top-center" richColors />

// src/lib/toast.ts — wrapper for consistent messaging
import { toast } from "sonner";

export const notify = {
  success: (msg: string) => toast.success(msg),
  error:   (msg: string) => toast.error(msg),
  info:    (msg: string) => toast.info(msg),
  // Dose reminder — called from push notification handler
  reminder: (animal: string, protocol: string) =>
    toast(`${animal}: ${protocol} due now`, { duration: 10000 }),
};

// Usage anywhere in app:
import { notify } from "@/lib/toast";
notify.success("Dose confirmed for Duchess");
notify.error("Invoice payment failed — try again");
```

---

## 9. Accessibility Rules

These apply to every component, no exceptions.

- All interactive elements have visible focus states (shadcn/ui handles this via `ring` utility)
- All images have `alt` text — animal photos use `alt={animal.name}`
- All icon-only buttons have `aria-label`
- Color is never the only way to convey information — always pair with text or icon
- Minimum contrast ratio 4.5:1 for body text, 3:1 for large text
- Form fields always have associated `<label>` elements — shadcn/ui `FormLabel` does this automatically

---

## 10. What NOT to Do

| ❌ Do not | ✅ Do instead |
|---|---|
| Import from `@heroui/react` in Trainer or Silver Lining portal | Use shadcn/ui components only |
| Hardcode hex colors in components | Use Tailwind tokens from `tailwind.config.ts` |
| Build a custom card input for payments | Use Stripe Elements `<PaymentElement />` |
| Use inline `style={{ color: '#...' }}` | Use Tailwind classes or CSS variables |
| Install a new UI library without checking this guide first | Ask: does shadcn/ui already have this? |
| Use `console.log` for errors in production | Use structured error handling + Sentry |
| Write CSS outside of Tailwind utilities | All styling is Tailwind only |
| Put HeroUI Provider in the app root | Scope it to `OwnerLayout` only |
| Skip Zod schema for a "quick" form | Every form has a Zod schema, no exceptions |
| Use `any` type in TypeScript | Define proper types in `src/types/` |

---

## 11. Component Decision Tree

When starting any new UI element, follow this checklist in order:

```
1. Does shadcn/ui have this component?
   YES → npx shadcn@latest add [component] and use it
   NO  → continue

2. Is this for the Owner Portal mobile card layer?
   YES → Check HeroUI component list (Section 4.5)
   NO  → continue

3. Is this a chart or data visualization?
   YES → Use Recharts (Section 6)
   NO  → continue

4. Is this a payment UI?
   YES → Use Stripe Elements (Section 7) — full stop, no alternatives
   NO  → continue

5. Build a custom component using shadcn/ui primitives + Tailwind
   Place in src/components/[portal]/ or src/components/shared/
   Export from an index.ts barrel file
```

---

## 12. Environment Variables Required

```bash
# .env.local (never commit this file)
VITE_SUPABASE_URL=https://[project].supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_STRIPE_PUBLIC_KEY=pk_live_...      # pk_test_... for dev
VITE_CLOUDFLARE_WORKER_URL=https://maneline.[account].workers.dev
```

---

## 13. Quick Reference — Most-Used Commands

```bash
# Add a new shadcn/ui component
npx shadcn@latest add [component-name]

# Check what's installed
npx shadcn@latest diff

# Run dev server
npm run dev

# Type check
npx tsc --noEmit

# Build for Cloudflare Pages
npm run build
```

---

*End of FRONTEND-UI-GUIDE.md*
*Next revision: After Silver Lining brand guide received — update Section 2.5 color tokens*
*Owner: Cedric / OAG | Client: Silver Lining Herbs*
