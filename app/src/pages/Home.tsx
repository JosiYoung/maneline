import { Link } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { homeForRole } from '../components/ProtectedRoute';
import type { UserRole } from '../lib/types';
import ScrollHero from '../components/landing/ScrollHero';
import { SupportWidget } from '../components/shared/SupportWidget';

// Public marketing landing. Mane Line is a standalone, unbranded product
// surface — no partner attribution anywhere (the app is licensed to supplement
// brands who white-label the Team tier). Story arc: scroll-scrubbed 3-scene
// hero, then a long-form page that walks owners → trainers → team through the
// product. CSS mockups mark every spot that should become a real screenshot.
export default function Home() {
  const { profile } = useAuthStore();
  const authed = !!profile;

  return (
    <>
      <TopNav authed={authed} role={profile?.role} />

      <ScrollHero>
        <HeroScene authed={authed} role={profile?.role} />
        <ChaosScene />
        <OnePageScene />
      </ScrollHero>

      <main style={{ background: 'var(--color-bg)', color: 'var(--color-ink)' }}>
        <StoryBand />
        <TodayChapter />
        <ProtocolBrainChapter />
        <TrainerChapter authed={authed} />
        <VetChapter />
        <MarketplaceChapter />
        <SpeciesChapter />
        <HowItWorksChapter />
        <EndorsersChapter />
        <PricingChapter />
        <FAQChapter />
        <FinalCTA authed={authed} role={profile?.role} />
        <Footer />
      </main>

      <SupportWidget forceAnon />
    </>
  );
}

/* ================================================================ *
 *  Top navigation (floating over the hero, solid on scroll)
 * ================================================================ */

function TopNav({ authed, role }: { authed: boolean; role?: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        padding: '14px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <Link
        to="/"
        style={{
          pointerEvents: 'auto',
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 700,
          color: 'white',
          textShadow: '0 2px 10px rgba(0,0,0,0.5)',
          textDecoration: 'none',
          letterSpacing: '-0.01em',
        }}
      >
        Mane Line
      </Link>

      <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
        {authed ? (
          <Link to={homeForRole((role || 'owner') as UserRole)} style={navCta('primary')}>
            My portal
          </Link>
        ) : (
          <>
            <Link to="/login" style={navCta('ghost')}>
              Sign in
            </Link>
            <Link to="/signup" style={navCta('primary')}>
              Get started
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function navCta(kind: 'primary' | 'ghost'): React.CSSProperties {
  return kind === 'primary'
    ? {
        padding: '9px 16px',
        background: 'white',
        color: '#2a1a12',
        borderRadius: 999,
        textDecoration: 'none',
        fontWeight: 700,
        fontSize: 13,
        boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
      }
    : {
        padding: '9px 16px',
        background: 'rgba(0,0,0,0.2)',
        color: 'white',
        borderRadius: 999,
        textDecoration: 'none',
        fontWeight: 700,
        fontSize: 13,
        border: '1px solid rgba(255,255,255,0.4)',
        backdropFilter: 'blur(10px)',
      };
}

/* ================================================================ *
 *  Hero (scroll-scrubbed) — three acts
 * ================================================================ */

function HeroScene({ authed, role }: { authed: boolean; role?: string }) {
  return (
    <section
      data-scene="0"
      className="relative flex h-screen flex-col justify-between px-6 py-10 md:px-16 md:py-16"
    >
      <div /> {/* spacer where the old header used to sit */}
      <div className="max-w-3xl">
        <div
          style={{
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.14)',
            color: 'white',
            fontSize: 12,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            marginBottom: 18,
            border: '1px solid rgba(255,255,255,0.25)',
            backdropFilter: 'blur(6px)',
          }}
        >
          For every hoof &amp; paw
        </div>
        <h1
          style={{
            fontSize: 'clamp(44px, 7vw, 96px)',
            lineHeight: 0.98,
            marginBottom: 22,
            color: 'white',
            textShadow: '0 4px 30px rgba(0,0,0,0.35)',
            letterSpacing: '-0.02em',
          }}
        >
          Everything your horse needs,{' '}
          <em style={{ color: '#ffe5bd', fontStyle: 'italic' }}>
            in the palm of your hand.
          </em>
        </h1>
        <p
          style={{
            fontSize: 19,
            color: 'rgba(255,255,255,0.92)',
            maxWidth: '56ch',
            marginBottom: 32,
            textShadow: '0 2px 16px rgba(0,0,0,0.35)',
          }}
        >
          The daily companion for owners, trainers, and vets. Feed, supplements,
          records, training, and schedule — every animal, one app.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {authed ? (
            <Link to={homeForRole((role || 'owner') as UserRole)} style={cta('primary')}>
              Go to my portal
            </Link>
          ) : (
            <>
              <Link to="/signup" style={cta('primary')}>
                Start free
              </Link>
              <Link to="/login" style={cta('ghost')}>
                Sign in
              </Link>
            </>
          )}
        </div>

        <div
          style={{
            marginTop: 22,
            fontSize: 13,
            color: 'rgba(255,255,255,0.75)',
            textShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}
        >
          Free for owners, forever. No credit card to sign up.
        </div>
      </div>

      <div
        style={{
          fontSize: 12,
          letterSpacing: '.2em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.7)',
        }}
      >
        Scroll ↓
      </div>
    </section>
  );
}

function ChaosScene() {
  return (
    <section
      data-scene="1"
      className="relative flex h-screen items-center px-6 md:px-16"
    >
      <div className="max-w-xl">
        <div
          style={{
            fontSize: 12,
            letterSpacing: '.2em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.78)',
            marginBottom: 16,
          }}
        >
          Before Mane Line
        </div>
        <h2
          style={{
            fontSize: 'clamp(34px, 5vw, 64px)',
            lineHeight: 1.02,
            color: 'white',
            textShadow: '0 3px 22px rgba(0,0,0,0.45)',
            marginBottom: 22,
            letterSpacing: '-0.015em',
          }}
        >
          The paper chart. The Notes-app log. The WhatsApp thread. The lost
          receipt.
        </h2>
        <p
          style={{
            fontSize: 19,
            color: 'rgba(255,255,255,0.9)',
            maxWidth: '52ch',
            textShadow: '0 2px 16px rgba(0,0,0,0.35)',
          }}
        >
          You love the horse. You don&apos;t love the paperwork. Neither do we.
        </p>
      </div>
    </section>
  );
}

function OnePageScene() {
  return (
    <section
      data-scene="2"
      className="relative flex h-screen items-end px-6 pb-28 md:px-16"
    >
      <div className="max-w-2xl">
        <h2
          style={{
            fontSize: 'clamp(34px, 5vw, 64px)',
            lineHeight: 1.02,
            color: 'white',
            marginBottom: 22,
            textShadow: '0 3px 22px rgba(0,0,0,0.45)',
            letterSpacing: '-0.015em',
          }}
        >
          One page. Every animal. Every day.
        </h2>
        <p
          style={{
            fontSize: 19,
            color: 'rgba(255,255,255,0.9)',
            maxWidth: '58ch',
            textShadow: '0 2px 16px rgba(0,0,0,0.35)',
          }}
        >
          From the barn to the back country — every horse and every dog gets
          the same care, the same day, no matter who&apos;s standing next to
          them.
        </p>
      </div>
    </section>
  );
}

/* ================================================================ *
 *  Below the fold — the narrative
 * ================================================================ */

function StoryBand() {
  const stats = [
    { n: '11', label: 'questions a horse owner answers every week' },
    { n: '7', label: 'apps and paper stacks that fail to answer them' },
    { n: '1', label: 'place Mane Line collapses it all into' },
  ];
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-line)',
      }}
    >
      <div
        className="mx-auto px-6 md:px-10"
        style={{ maxWidth: 1180, paddingTop: 88, paddingBottom: 72 }}
      >
        <Eyebrow>Why Mane Line exists</Eyebrow>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(34px, 4.6vw, 56px)',
            lineHeight: 1.06,
            margin: '14px 0 20px',
            maxWidth: '22ch',
            letterSpacing: '-0.01em',
          }}
        >
          Horses deserve better than duct tape.
        </h2>
        <p
          style={{
            fontSize: 19,
            lineHeight: 1.55,
            color: 'var(--text-muted)',
            maxWidth: '62ch',
            marginBottom: 48,
          }}
        >
          A horse owner and their trainer today duct-tape together a paper feed
          chart, a Notes-app vet log, texted farrier pictures, a PDF Coggins, a
          WhatsApp thread, a Venmo invoice, and a sticky note on the barn
          fridge. Every one of them is waste.{' '}
          <strong style={{ color: 'var(--color-primary)' }}>
            Mane Line collapses the stack — one pane of glass, anchored by the
            animal.
          </strong>
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 20,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                padding: 24,
                borderRadius: 14,
                background: 'var(--color-bg)',
                border: '1px solid var(--color-line)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 56,
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  lineHeight: 1,
                  marginBottom: 8,
                  letterSpacing: '-0.02em',
                }}
              >
                {s.n}
              </div>
              <div
                style={{
                  fontSize: 15,
                  color: 'var(--text-muted)',
                  lineHeight: 1.45,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- Chapter 1 — The Today view ------------------------------- */

function TodayChapter() {
  return (
    <ChapterSection eyebrow="Chapter one · for owners" bg="var(--color-bg)">
      <ChapterCols
        left={
          <>
            <ChapterHeading>
              Meet <em style={{ fontStyle: 'italic' }}>Today</em>.
            </ChapterHeading>
            <ChapterBody>
              The single screen you&apos;ll open more than any other. Every
              animal you love, stacked as cards. One tap confirms the dose.
              One tap logs a note. One tap flags the vet.
            </ChapterBody>

            <BulletList
              items={[
                'Supplement dosing — pre-filled from the active protocol',
                'Vet flags and photo notes, threaded to the animal',
                'Reminders that actually know what day of the week it is',
                'Offline-first — the barn is a signal dead zone',
              ]}
            />
          </>
        }
        right={<TodayMock />}
      />
    </ChapterSection>
  );
}

function TodayMock() {
  return (
    <DeviceFrame label="Owner · Today · iPhone">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--color-ink)',
          }}
        >
          Good morning, Cedric
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          Tuesday, April 20 · 3 animals
        </div>

        <AnimalCard
          name="Midnight"
          species="Quarter Horse · 14 yr"
          tasks={[
            { label: 'Protocol #14 Gastric Comfort · AM', done: true },
            { label: 'Magnesium top-dress · AM', done: true },
            { label: 'Turnout 8–5', done: false },
          ]}
          status="On protocol"
        />
        <AnimalCard
          name="Juno"
          species="Border Collie · 6 yr"
          tasks={[
            { label: 'Joint supplement · PM', done: false },
            { label: 'Rabies booster due Fri', done: false },
          ]}
          status="2 reminders"
          warn
        />
        <AnimalCard
          name="Dusty"
          species="Gelding · 9 yr"
          tasks={[
            { label: 'Hoof trim scheduled · Thu', done: false },
            { label: 'Session w/ Sarah · 4 PM', done: false },
          ]}
          status="Trainer day"
        />
      </div>
    </DeviceFrame>
  );
}

function AnimalCard(props: {
  name: string;
  species: string;
  tasks: { label: string; done: boolean }[];
  status: string;
  warn?: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid var(--color-line)',
        background: 'var(--color-surface)',
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 17,
              fontWeight: 700,
            }}
          >
            {props.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{props.species}</div>
        </div>
        <div
          style={{
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 999,
            background: props.warn ? '#FCE5E5' : 'var(--color-secondary)',
            color: props.warn ? '#B33A3A' : 'var(--secondary-foreground)',
            fontWeight: 700,
            letterSpacing: '.05em',
            textTransform: 'uppercase',
          }}
        >
          {props.status}
        </div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {props.tasks.map((t, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: t.done ? 'var(--text-muted)' : 'var(--color-ink)',
              textDecoration: t.done ? 'line-through' : 'none',
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                border: '1.5px solid var(--color-primary)',
                background: t.done ? 'var(--color-primary)' : 'transparent',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 9,
                flexShrink: 0,
              }}
            >
              {t.done ? '✓' : ''}
            </span>
            {t.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Chapter 2 — Protocol Brain ------------------------------- */

function ProtocolBrainChapter() {
  return (
    <section
      style={{
        background: 'var(--color-primary)',
        color: 'var(--color-surface)',
      }}
    >
      <div
        className="mx-auto px-6 md:px-10"
        style={{ maxWidth: 1180, paddingTop: 96, paddingBottom: 96 }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 56,
            alignItems: 'center',
          }}
        >
          <div>
            <Eyebrow light>Chapter two · 25 years, on call</Eyebrow>
            <ChapterHeading light>
              Your horse is off. She isn&apos;t eating.{' '}
              <em style={{ fontStyle: 'italic' }}>Now what?</em>
            </ChapterHeading>
            <p
              style={{
                maxWidth: '52ch',
                fontSize: 18,
                lineHeight: 1.62,
                opacity: 0.94,
                marginTop: 14,
                marginBottom: 20,
              }}
            >
              Tell Protocol Brain in plain English. It searches a library of
              200+ numbered equine-herbal protocols, cites the one that fits,
              and hands you a plan. One tap adds the right supplements to your
              order and schedules the daily dose.
            </p>
            <BulletList
              light
              items={[
                'Trained on a quarter-century of equine-herbal fieldwork',
                'Cites the protocol number so you can read the source',
                'One-tap purchase inside the chat',
                'Escalates to a vet referral when the situation calls for one',
              ]}
            />
          </div>

          <ChatCard />
        </div>
      </div>
    </section>
  );
}

function ChatCard() {
  return (
    <div
      style={{
        borderRadius: 20,
        background: 'rgba(255,253,245,0.08)',
        border: '1px solid rgba(255,253,245,0.28)',
        padding: 22,
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingBottom: 10,
          borderBottom: '1px solid rgba(255,253,245,0.2)',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'rgba(255,253,245,0.9)',
            color: 'var(--color-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
          }}
        >
          🌿
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Protocol Brain</div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>Protocol Brain · always awake</div>
        </div>
      </div>

      <ChatBubble side="you">
        My mare&apos;s been grumpy under saddle and off her feed since the
        weather turned. Nothing&apos;s wrong on the scope.
      </ChatBubble>
      <ChatBubble side="brain">
        Sounds like a classic seasonal gut story. Start with{' '}
        <strong>Protocol #14 — Gastric Comfort</strong>, 30 days, plus a
        magnesium top-dress for the mood piece.
      </ChatBubble>
      <ChatBubble side="brain">
        Want me to add both to your next order and schedule the daily dose on
        her Today card?
      </ChatBubble>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--color-surface)',
            color: 'var(--color-primary)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Add both — $47
        </button>
        <button
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid rgba(255,253,245,0.4)',
            background: 'transparent',
            color: 'var(--color-surface)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function ChatBubble({
  side,
  children,
}: {
  side: 'you' | 'brain';
  children: React.ReactNode;
}) {
  const isYou = side === 'you';
  return (
    <div
      style={{
        alignSelf: isYou ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        padding: '10px 14px',
        borderRadius: 14,
        background: isYou ? 'rgba(255,253,245,0.92)' : 'rgba(26,26,26,0.28)',
        color: isYou ? 'var(--color-ink)' : 'var(--color-surface)',
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

/* ---- Chapter 3 — Trainers ------------------------------------- */

function TrainerChapter({ authed }: { authed: boolean }) {
  return (
    <ChapterSection eyebrow="Chapter three · for trainers" bg="var(--color-surface)">
      <ChapterCols
        reverse
        left={<TrainerDashboardMock />}
        right={
          <>
            <ChapterHeading>
              Run the barn. <em style={{ fontStyle: 'italic' }}>Not the spreadsheets.</em>
            </ChapterHeading>
            <ChapterBody>
              The first trainer platform built by people who know what Tuesday
              at 6 a.m. looks like. White-label. Mobile-first. Zero duct tape.
            </ChapterBody>

            <BulletList
              items={[
                'White-label invoices · your logo, your colors, your Stripe',
                'Session logger on the phone → invoice at month-end',
                'Expenses tagged by horse, rolled up to P&L',
                'Marketplace supplements, one tap from the expense form',
                'Owner sign-offs — no more "I didn&apos;t see the text"',
                '1099-friendly tax export in November',
              ]}
            />

            <div
              style={{
                marginTop: 22,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                borderRadius: 999,
                background: 'var(--color-secondary)',
                color: 'var(--secondary-foreground)',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <span style={{ fontSize: 14 }}>✦</span>
              Every trainer passes a vetting review before going live.
            </div>

            {!authed && (
              <div style={{ marginTop: 22 }}>
                <Link to="/signup" style={cta('primarySolid')}>
                  Apply as a trainer
                </Link>
              </div>
            )}
          </>
        }
      />
    </ChapterSection>
  );
}

function TrainerDashboardMock() {
  return (
    <DeviceFrame label="Trainer · Dashboard · Desktop" wide>
      <div
        style={{
          padding: 18,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <MiniStat label="April revenue" value="$8,420" delta="+18% MoM" />
        <MiniStat label="Sessions logged" value="42" delta="7 unbilled" />
        <MiniStat label="Active clients" value="11" delta="+2 this month" warn={false} />
        <MiniStat label="Expense receipts" value="$1,284" delta="5 unfiled" />
      </div>
      <div
        style={{
          padding: '0 18px 18px',
          borderTop: '1px solid var(--color-line)',
          paddingTop: 14,
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 10,
            fontWeight: 700,
          }}
        >
          This week
        </div>
        {[
          { h: 'Tue · Midnight · Flatwork', who: 'Cedric C.', amt: '$95' },
          { h: 'Wed · Juno · Agility intake', who: 'Marlowe B.', amt: '$60' },
          { h: 'Thu · Dusty · Trailer loading', who: 'Jordan P.', amt: '$120' },
        ].map((r) => (
          <div
            key={r.h}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0',
              borderTop: '1px solid var(--color-line)',
              fontSize: 13,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{r.h}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>for {r.who}</div>
            </div>
            <div
              style={{
                fontWeight: 700,
                color: 'var(--color-primary)',
              }}
            >
              {r.amt}
            </div>
          </div>
        ))}
      </div>
    </DeviceFrame>
  );
}

function MiniStat(props: { label: string; value: string; delta: string; warn?: boolean }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-line)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          fontWeight: 700,
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          marginTop: 4,
          letterSpacing: '-0.01em',
        }}
      >
        {props.value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: props.warn ? '#B33A3A' : 'var(--color-primary)',
          marginTop: 2,
          fontWeight: 600,
        }}
      >
        {props.delta}
      </div>
    </div>
  );
}

/* ---- Chapter 4 — Vet View ------------------------------------- */

function VetChapter() {
  return (
    <ChapterSection eyebrow="Chapter four · for vets" bg="var(--color-bg)">
      <ChapterCols
        left={
          <>
            <ChapterHeading>
              One link. <em style={{ fontStyle: 'italic' }}>Everything that matters.</em>
            </ChapterHeading>
            <ChapterBody>
              No logins. No account. A vet clicks the link the owner sent and
              sees every Coggins, every vaccine, every chart — for that animal,
              for as long as the owner says. Then it expires. Quiet. Private.
              Respectful of everyone&apos;s time.
            </ChapterBody>
            <BulletList
              items={[
                'Scoped magic-link · one animal, read-only',
                '30-day default expiry, extendable or revocable',
                'Coggins + vaccines + bloodwork + supplement chart',
                'Owner sees every access in the audit log',
              ]}
            />
          </>
        }
        right={<VetCard />}
      />
    </ChapterSection>
  );
}

function VetCard() {
  return (
    <DeviceFrame label="Vet View · shared by owner · browser">
      <div style={{ padding: 20 }}>
        <div
          style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: 999,
            background: 'var(--color-secondary)',
            color: 'var(--secondary-foreground)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          Read-only
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            fontWeight: 700,
            marginBottom: 4,
            letterSpacing: '-0.01em',
          }}
        >
          Midnight
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          14-yr Quarter Horse Gelding · shared by Cedric Corbett
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
          {[
            ['Coggins', 'Oct 2025 · negative · expires Oct 2026'],
            ['Rabies', 'Spring 2026 · Dr. Garcia'],
            ['Dental', 'Mar 2026 · float, no findings'],
            ['Bloodwork', 'Feb 2026 · within normal range'],
            ['Chart', '12-month supplement + workout log'],
          ].map(([k, v]) => (
            <li
              key={k}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderTop: '1px solid var(--color-line)',
              }}
            >
              <span style={{ fontWeight: 600 }}>{k}</span>
              <span style={{ color: 'var(--text-muted)' }}>{v}</span>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>
          Link expires in 30 days · revocable any time by the owner.
        </div>
      </div>
    </DeviceFrame>
  );
}

/* ---- Chapter 5 — Marketplace ---------------------------------- */

function MarketplaceChapter() {
  const skus = [
    { n: '#3', t: 'Hoof & Coat', use: 'Shine, strength, cracks', p: '$38' },
    { n: '#7', t: 'Gut Shield', use: 'Travel, colic-prone', p: '$42' },
    { n: '#14', t: 'Gastric Comfort', use: 'Ulcer support, seasonal', p: '$46' },
    { n: '#22', t: 'Joint Freedom', use: 'Senior horses, arena work', p: '$54' },
  ];
  return (
    <ChapterSection eyebrow="Chapter five · the marketplace" bg="var(--color-surface)">
      <div style={{ maxWidth: 880, marginBottom: 48 }}>
        <ChapterHeading>
          From the pasture to the pill,{' '}
          <em style={{ fontStyle: 'italic' }}>the same family of herbs.</em>
        </ChapterHeading>
        <ChapterBody>
          Twenty-five years of equine herbal blends, finally sitting on the
          same screen as your horse&apos;s daily chart. Browse, get a
          recommendation from Protocol Brain, buy, and log the dose — all in
          the same two taps.
        </ChapterBody>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {skus.map((s) => (
          <div
            key={s.n}
            style={{
              borderRadius: 14,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-line)',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -20,
                right: -20,
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'var(--color-sage)',
                opacity: 0.22,
              }}
            />
            <div
              style={{
                fontSize: 11,
                letterSpacing: '.2em',
                textTransform: 'uppercase',
                color: 'var(--color-primary)',
                fontWeight: 700,
              }}
            >
              Protocol {s.n}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              {s.t}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', minHeight: 36 }}>
              {s.use}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--color-ink)',
              }}
            >
              30-day supply · from {s.p}
            </div>
          </div>
        ))}
      </div>
    </ChapterSection>
  );
}

/* ---- Chapter 6 — Cross-species -------------------------------- */

function SpeciesChapter() {
  return (
    <section style={{ background: 'var(--color-bg)' }}>
      <div
        className="mx-auto px-6 md:px-10"
        style={{
          maxWidth: 1180,
          paddingTop: 96,
          paddingBottom: 96,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 40,
          alignItems: 'center',
        }}
      >
        <div>
          <Eyebrow>One data model, many creatures</Eyebrow>
          <ChapterHeading>
            Horse, dog,{' '}
            <em style={{ fontStyle: 'italic' }}>and whoever comes next.</em>
          </ChapterHeading>
          <ChapterBody>
            Mane Line was built cross-species from day one. The same profile,
            the same protocol card, the same records drawer works for a
            cutting-horse gelding, a stock-dog mix, or the next goat you bring
            home. We treat the animal as the center — not the species.
          </ChapterBody>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
          }}
        >
          {[
            { emoji: '🐎', name: 'Horses', tag: 'v1' },
            { emoji: '🐕', name: 'Dogs', tag: 'v1' },
            { emoji: '🐐', name: 'Goats', tag: 'roadmap' },
            { emoji: '🐄', name: 'Cattle', tag: 'roadmap' },
            { emoji: '🐈', name: 'Cats', tag: 'roadmap' },
            { emoji: '🦙', name: 'Camelids', tag: 'roadmap' },
          ].map((s) => (
            <div
              key={s.name}
              style={{
                aspectRatio: '1 / 1',
                borderRadius: 14,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-line)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 4,
                opacity: s.tag === 'v1' ? 1 : 0.55,
              }}
            >
              <div style={{ fontSize: 36 }}>{s.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color:
                    s.tag === 'v1' ? 'var(--color-primary)' : 'var(--text-muted)',
                  fontWeight: 700,
                }}
              >
                {s.tag}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- Chapter 7 — How it works --------------------------------- */

function HowItWorksChapter() {
  const steps = [
    {
      n: '1',
      t: 'Sign up in 60 seconds',
      b: 'Magic link or 6-digit PIN. No credit card. Free for owners, forever.',
    },
    {
      n: '2',
      t: 'Add your animals',
      b: 'One card per horse or dog. Upload a Coggins, import a feed chart — or start fresh.',
    },
    {
      n: '3',
      t: 'Invite your trainer (or vet)',
      b: 'Scoped access. One horse or the whole ranch. Revocable in a tap.',
    },
    {
      n: '4',
      t: 'Ride on with the barn in your pocket',
      b: 'Today view, Protocol Brain, invoices, records — all in one app.',
    },
  ];
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-line)',
        borderBottom: '1px solid var(--color-line)',
      }}
    >
      <div
        className="mx-auto px-6 md:px-10"
        style={{ maxWidth: 1180, paddingTop: 96, paddingBottom: 96 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <Eyebrow centered>How it works</Eyebrow>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(34px, 4.4vw, 52px)',
              lineHeight: 1.05,
              margin: '14px auto 0',
              maxWidth: '20ch',
              letterSpacing: '-0.01em',
            }}
          >
            From the box to the barn in ten minutes.
          </h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 20,
          }}
        >
          {steps.map((s) => (
            <div
              key={s.n}
              style={{
                padding: 24,
                borderRadius: 14,
                background: 'var(--color-bg)',
                border: '1px solid var(--color-line)',
                position: 'relative',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 48,
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  lineHeight: 1,
                  opacity: 0.85,
                  marginBottom: 12,
                  letterSpacing: '-0.02em',
                }}
              >
                {s.n}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 19,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {s.t}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                {s.b}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- Chapter 8 — Endorsers ------------------------------------ */

function EndorsersChapter() {
  const voices = [
    {
      who: 'Sherry Cervi',
      role: '3× WPRA World Champion Barrel Racer',
      quote:
        '"Protocol #14 is in every one of my mares&apos; feed bags. Mane Line finally puts it on the same screen as their workout log."',
    },
    {
      who: 'Clay Maier',
      role: 'Cutting Horse Trainer, Weatherford TX',
      quote:
        '"Invoices used to take me a Sunday. Now they build themselves from what I already logged on my phone at the barn."',
    },
    {
      who: 'Shelly Baker',
      role: 'NRHA Reining Champion',
      quote:
        '"Every owner I train for is on Mane Line. That&apos;s the whole handoff now — no more texts, no more lost paperwork."',
    },
  ];
  return (
    <section style={{ background: 'var(--color-bg)' }}>
      <div
        className="mx-auto px-6 md:px-10"
        style={{ maxWidth: 1180, paddingTop: 96, paddingBottom: 96 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <Eyebrow centered>Trusted where the best ride</Eyebrow>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(30px, 4vw, 48px)',
              lineHeight: 1.06,
              margin: '14px auto 0',
              maxWidth: '22ch',
              letterSpacing: '-0.01em',
            }}
          >
            Chosen by the riders who chose herbs first.
          </h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
          }}
        >
          {voices.map((v) => (
            <figure
              key={v.who}
              style={{
                margin: 0,
                padding: 24,
                borderRadius: 16,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-line)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 32,
                  color: 'var(--color-primary)',
                  lineHeight: 1,
                }}
              >
                &ldquo;
              </div>
              <blockquote
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  fontSize: 17,
                  lineHeight: 1.45,
                  color: 'var(--color-ink)',
                }}
                dangerouslySetInnerHTML={{ __html: v.quote }}
              />
              <figcaption style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontWeight: 700 }}>{v.who}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v.role}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- Chapter 9 — Pricing -------------------------------------- */

function PricingChapter() {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-line)',
      }}
    >
      <div
        className="mx-auto px-6 md:px-10"
        style={{ maxWidth: 1180, paddingTop: 96, paddingBottom: 96 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <Eyebrow centered>Honest pricing</Eyebrow>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(32px, 4.4vw, 52px)',
              lineHeight: 1.05,
              margin: '14px auto 0',
              maxWidth: '22ch',
              letterSpacing: '-0.01em',
            }}
          >
            Free where it should be. Fair where it counts.
          </h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 20,
          }}
        >
          <PriceCard
            tier="Owner"
            price="Free"
            sub="Forever."
            features={[
              'Unlimited animals',
              'Today view, records, photo timeline',
              'Records export to PDF',
              'Protocol Brain chat (50 msgs / mo)',
              'Invite unlimited trainers & vets',
            ]}
            cta={{ label: 'Start free', to: '/signup' }}
          />
          <PriceCard
            highlight
            tier="Trainer"
            price="$29"
            sub="per month · per trainer"
            features={[
              'Everything in Owner',
              'White-label invoicing & payments',
              'Session log → auto-invoice',
              'Expenses by horse · P&L · tax export',
              'Stripe Connect payouts',
              'Unlimited clients',
            ]}
            cta={{ label: 'Apply to join', to: '/signup' }}
          />
          <PriceCard
            tier="Team"
            price="Custom"
            sub="For supplement brands & barns"
            features={[
              'Marketplace + Shopify sync',
              'Protocol authoring & SKU mapping',
              'Admin impersonation (audit logged)',
              'HubSpot CRM sync',
              'Aggregate signals & KPI dashboards',
            ]}
            cta={{ label: 'Talk to us', to: '/login' }}
          />
        </div>
      </div>
    </section>
  );
}

function PriceCard(props: {
  tier: string;
  price: string;
  sub: string;
  features: string[];
  cta: { label: string; to: string };
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: 28,
        borderRadius: 18,
        background: props.highlight ? 'var(--color-primary)' : 'var(--color-bg)',
        color: props.highlight ? 'var(--color-surface)' : 'var(--color-ink)',
        border: props.highlight
          ? '1px solid var(--color-primary)'
          : '1px solid var(--color-line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxShadow: props.highlight
          ? '0 24px 60px -20px rgba(61,122,61,0.5)'
          : '0 8px 24px -20px rgba(0,0,0,0.2)',
        position: 'relative',
      }}
    >
      {props.highlight && (
        <div
          style={{
            position: 'absolute',
            top: -10,
            right: 16,
            padding: '4px 10px',
            borderRadius: 999,
            background: '#ffe5bd',
            color: '#2a1a12',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
          }}
        >
          Most popular
        </div>
      )}
      <div
        style={{
          fontSize: 12,
          letterSpacing: '.2em',
          textTransform: 'uppercase',
          fontWeight: 700,
          opacity: 0.8,
        }}
      >
        {props.tier}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 48,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {props.price}
      </div>
      <div style={{ fontSize: 13, opacity: 0.8, marginTop: -6 }}>{props.sub}</div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '12px 0',
          display: 'grid',
          gap: 8,
          fontSize: 14,
          flex: 1,
        }}
      >
        {props.features.map((f) => (
          <li key={f} style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
            <span
              style={{
                color: props.highlight ? '#ffe5bd' : 'var(--color-primary)',
                fontWeight: 700,
              }}
            >
              ✓
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        to={props.cta.to}
        style={{
          padding: '12px 16px',
          borderRadius: 10,
          textAlign: 'center',
          background: props.highlight ? 'var(--color-surface)' : 'var(--color-primary)',
          color: props.highlight ? 'var(--color-primary)' : 'var(--color-surface)',
          textDecoration: 'none',
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        {props.cta.label} →
      </Link>
    </div>
  );
}

/* ---- Chapter 10 — FAQ ----------------------------------------- */

function FAQChapter() {
  const faqs = [
    {
      q: 'Is Mane Line really free for owners?',
      a: 'Yes. Always. Unlimited animals, unlimited records, unlimited trainer & vet invites. Protocol Brain has a generous message cap; heavy users can upgrade, but nothing core is paywalled.',
    },
    {
      q: 'Am I locked into any one supplement brand?',
      a: 'No. The app works with any feed, any supplement, any brand. The marketplace brand of the day is a default — not the only option. Log whatever you use.',
    },
    {
      q: 'Is my data safe?',
      a: 'Every row is scoped to you. Trainers see only what you grant them. Vets see only what you share. Every access is logged, every share is revocable, and you can export everything as a PDF in one tap.',
    },
    {
      q: 'Does it work at the barn with no signal?',
      a: 'Yes. Log sessions, note supplements, and snap photos offline — it all syncs when you are back in range.',
    },
    {
      q: 'Can I bring horses, dogs, and other animals?',
      a: 'Yes. Mane Line is cross-species from day one. Horses and dogs ship in v1; goats, cattle, cats, and camelids are on the roadmap.',
    },
    {
      q: 'How does trainer vetting work?',
      a: 'Trainers apply with credentials, references, and proof of insurance. Our team reviews the packet — typical turnaround is 48 hours — and approves or declines. Until approved, a trainer cannot accept owner invites.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Yes — and you keep your data. Export the full chart for every animal as a PDF before you leave. No retention games.',
    },
  ];

  return (
    <section style={{ background: 'var(--color-bg)' }}>
      <div
        className="mx-auto px-6 md:px-10"
        style={{ maxWidth: 880, paddingTop: 96, paddingBottom: 96 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Eyebrow centered>Questions</Eyebrow>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(30px, 4vw, 48px)',
              lineHeight: 1.04,
              margin: '14px auto 0',
              maxWidth: '22ch',
              letterSpacing: '-0.01em',
            }}
          >
            The honest answers.
          </h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {faqs.map((f, i) => (
            <details
              key={f.q}
              style={{
                borderTop: i === 0 ? '1px solid var(--color-line)' : 'none',
                borderBottom: '1px solid var(--color-line)',
                padding: '20px 4px',
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  listStyle: 'none',
                  fontFamily: 'var(--font-display)',
                  fontSize: 20,
                  fontWeight: 600,
                  color: 'var(--color-ink)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 20,
                }}
              >
                {f.q}
                <span
                  aria-hidden
                  style={{
                    color: 'var(--color-primary)',
                    fontSize: 20,
                    lineHeight: 1,
                  }}
                >
                  +
                </span>
              </summary>
              <p
                style={{
                  marginTop: 12,
                  fontSize: 16,
                  lineHeight: 1.6,
                  color: 'var(--text-muted)',
                  maxWidth: '64ch',
                }}
              >
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- Final CTA + Footer --------------------------------------- */

function FinalCTA({ authed, role }: { authed: boolean; role?: string }) {
  return (
    <section
      style={{
        background: 'var(--color-ink)',
        color: 'var(--color-surface)',
      }}
    >
      <div
        className="mx-auto px-6 md:px-10"
        style={{
          maxWidth: 1180,
          paddingTop: 112,
          paddingBottom: 112,
          textAlign: 'center',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(36px, 5.4vw, 72px)',
            lineHeight: 1.02,
            margin: '0 auto 20px',
            maxWidth: '20ch',
            color: 'var(--color-surface)',
            letterSpacing: '-0.02em',
          }}
        >
          The whole barn. <em style={{ fontStyle: 'italic' }}>On one page.</em>
        </h2>
        <p
          style={{
            fontSize: 19,
            maxWidth: '54ch',
            margin: '0 auto 36px',
            opacity: 0.85,
            lineHeight: 1.6,
          }}
        >
          Owners start free. Trainers apply and most are live in 48 hours.
          Supplement brands license the Team tier to run their catalog inside
          Mane Line.
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {authed ? (
            <Link to={homeForRole((role || 'owner') as UserRole)} style={cta('primary')}>
              Go to my portal
            </Link>
          ) : (
            <>
              <Link to="/signup" style={cta('primary')}>
                Start free as an owner
              </Link>
              <Link to="/signup" style={cta('ghost')}>
                Apply as a trainer
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      style={{
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-line)',
      }}
    >
      <div
        className="mx-auto px-6 md:px-10"
        style={{
          maxWidth: 1180,
          paddingTop: 48,
          paddingBottom: 36,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 32,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              fontWeight: 700,
              color: 'var(--color-primary)',
              letterSpacing: '-0.01em',
            }}
          >
            Mane Line
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              marginTop: 8,
              maxWidth: '28ch',
              lineHeight: 1.5,
            }}
          >
            Every animal, one app. Built for owners, trainers, and vets
            — on the phone, at the barn, where the work actually happens.
          </div>
        </div>

        <FooterCol
          title="Product"
          links={[
            { label: 'For owners', to: '/signup' },
            { label: 'For trainers', to: '/signup' },
            { label: 'Sign in', to: '/login' },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { label: 'About', to: '/' },
            { label: 'Contact', to: '/' },
            { label: 'Privacy', to: '/' },
            { label: 'Terms', to: '/' },
          ]}
        />
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '.15em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 12,
              fontWeight: 700,
            }}
          >
            Dispatch from the barn
          </div>
          <div style={{ fontSize: 14, color: 'var(--color-ink)', lineHeight: 1.5 }}>
            Occasional notes on protocols, riders, and what we&apos;re
            shipping. No spam, ever.
          </div>
          <Link
            to="/signup"
            style={{
              display: 'inline-block',
              marginTop: 12,
              color: 'var(--color-primary)',
              fontWeight: 700,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Join the list →
          </Link>
        </div>
      </div>
      <div
        style={{
          borderTop: '1px solid var(--color-line)',
          padding: '20px 24px',
          fontSize: 12,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        © {new Date().getFullYear()} Mane Line · Made for horses, dogs, and
        the people who love them.
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; to: string }[];
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '.15em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 12,
          fontWeight: 700,
        }}
      >
        {title}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {links.map((l) => (
          <li key={l.label}>
            <Link
              to={l.to}
              style={{
                color: 'var(--color-ink)',
                textDecoration: 'none',
                fontSize: 14,
              }}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ================================================================ *
 *  Shared building blocks
 * ================================================================ */

function ChapterSection({
  eyebrow,
  bg,
  children,
}: {
  eyebrow: string;
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: bg,
        borderTop: '1px solid var(--color-line)',
        borderBottom: '1px solid var(--color-line)',
      }}
    >
      <div
        className="mx-auto px-6 md:px-10"
        style={{ maxWidth: 1180, paddingTop: 96, paddingBottom: 96 }}
      >
        <Eyebrow>{eyebrow}</Eyebrow>
        <div style={{ marginTop: 18 }}>{children}</div>
      </div>
    </section>
  );
}

function ChapterCols({
  left,
  right,
  reverse,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 56,
        alignItems: 'center',
        direction: reverse ? 'rtl' : 'ltr',
      }}
    >
      <div style={{ direction: 'ltr' }}>{left}</div>
      <div style={{ direction: 'ltr' }}>{right}</div>
    </div>
  );
}

function ChapterHeading({
  children,
  light,
}: {
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <h2
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(32px, 4.4vw, 54px)',
        lineHeight: 1.04,
        margin: '0 0 18px',
        maxWidth: '22ch',
        color: light ? 'var(--color-surface)' : 'var(--color-ink)',
        letterSpacing: '-0.015em',
      }}
    >
      {children}
    </h2>
  );
}

function ChapterBody({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 18,
        lineHeight: 1.6,
        color: 'var(--text-muted)',
        maxWidth: '58ch',
        marginBottom: 20,
      }}
    >
      {children}
    </p>
  );
}

function Eyebrow({
  children,
  centered,
  light,
}: {
  children: React.ReactNode;
  centered?: boolean;
  light?: boolean;
}) {
  return (
    <div
      style={{
        display: centered ? 'block' : 'inline-block',
        textAlign: centered ? 'center' : 'left',
        fontSize: 12,
        letterSpacing: '.22em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: light ? 'rgba(255,253,245,0.85)' : 'var(--color-primary)',
      }}
    >
      {children}
    </div>
  );
}

function BulletList({
  items,
  light,
}: {
  items: string[];
  light?: boolean;
}) {
  return (
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: '8px 0 0',
        display: 'grid',
        gap: 10,
      }}
    >
      {items.map((i) => (
        <li
          key={i}
          style={{
            display: 'flex',
            alignItems: 'start',
            gap: 10,
            fontSize: 16,
            lineHeight: 1.5,
            color: light ? 'var(--color-surface)' : 'var(--color-ink)',
            opacity: light ? 0.92 : 1,
          }}
        >
          <span
            style={{
              marginTop: 2,
              color: light ? '#ffe5bd' : 'var(--color-primary)',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            ✓
          </span>
          <span dangerouslySetInnerHTML={{ __html: i }} />
        </li>
      ))}
    </ul>
  );
}

function DeviceFrame({
  children,
  label,
  wide,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: -28,
          left: 0,
          fontSize: 11,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          borderRadius: wide ? 16 : 28,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-line)',
          boxShadow: '0 30px 70px -30px rgba(26,26,26,0.35)',
          overflow: 'hidden',
          maxWidth: wide ? '100%' : 340,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            height: 24,
            background: 'var(--color-bg)',
            borderBottom: '1px solid var(--color-line)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 12px',
          }}
        >
          {['#E86A6A', '#E8B96A', '#6AC48A'].map((c) => (
            <div
              key={c}
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: c,
                opacity: 0.7,
              }}
            />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

function cta(kind: 'primary' | 'ghost' | 'primarySolid'): React.CSSProperties {
  if (kind === 'primary') {
    return {
      padding: '14px 28px',
      background: 'white',
      color: '#2a1a12',
      borderRadius: 999,
      textDecoration: 'none',
      fontWeight: 700,
      fontSize: 15,
      boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
    };
  }
  if (kind === 'primarySolid') {
    return {
      padding: '12px 22px',
      background: 'var(--color-primary)',
      color: 'var(--color-surface)',
      borderRadius: 999,
      textDecoration: 'none',
      fontWeight: 700,
      fontSize: 15,
      boxShadow: '0 10px 24px -12px rgba(61,122,61,0.55)',
    };
  }
  return {
    padding: '14px 28px',
    background: 'transparent',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.6)',
    borderRadius: 999,
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: 15,
    backdropFilter: 'blur(6px)',
  };
}
