import { Link } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { homeForRole } from '../components/ProtectedRoute';
import ScrollHero from '../components/landing/ScrollHero';
import { SupportWidget } from '../components/shared/SupportWidget';

// Public marketing landing. Mane Line chrome only — no Silver Lining co-brand
// (per post-2026-04-15 call). The hero is a scroll-linked 3D experience;
// DOM copy layers sit on top of a sticky R3F canvas.
export default function Home() {
  const { profile } = useAuthStore();

  return (
    <ScrollHero>
      {/* Scene 1 — sunrise over the plains */}
      <section
        data-scene="0"
        className="relative flex h-screen flex-col justify-between px-6 py-10 md:px-16 md:py-16"
      >
        <header>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              fontWeight: 700,
              color: 'white',
              textShadow: '0 2px 20px rgba(0,0,0,0.35)',
            }}
          >
            Mane Line
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'rgba(255,255,255,0.85)',
              letterSpacing: '.14em',
              textTransform: 'uppercase',
            }}
          >
            The Horse OS
          </div>
        </header>

        <div className="max-w-3xl">
          <h1
            style={{
              fontSize: 'clamp(40px, 6.4vw, 84px)',
              lineHeight: 1.02,
              marginBottom: 20,
              color: 'white',
              textShadow: '0 4px 30px rgba(0,0,0,0.35)',
            }}
          >
            Everything your horse needs,{' '}
            <em style={{ color: '#ffe5bd', fontStyle: 'italic' }}>in the palm of your hand.</em>
          </h1>
          <p
            style={{
              fontSize: 18,
              color: 'rgba(255,255,255,0.9)',
              maxWidth: '56ch',
              marginBottom: 28,
              textShadow: '0 2px 16px rgba(0,0,0,0.35)',
            }}
          >
            The daily companion for owners, trainers, and vets. Animals at the center —
            feed, supplements, records, training, and schedule, all in one place.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {profile ? (
              <Link
                to={homeForRole(profile.role)}
                style={cta('primary')}
              >
                Go to my portal
              </Link>
            ) : (
              <>
                <Link to="/signup" style={cta('primary')}>Create an account</Link>
                <Link to="/login" style={cta('ghost')}>Sign in</Link>
              </>
            )}
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

      {/* Scene 2 — the vials / herbs close-up */}
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
              color: 'rgba(255,255,255,0.75)',
              marginBottom: 16,
            }}
          >
            Built around the animal
          </div>
          <h2
            style={{
              fontSize: 'clamp(32px, 4.6vw, 60px)',
              lineHeight: 1.05,
              color: 'white',
              textShadow: '0 3px 22px rgba(0,0,0,0.4)',
            }}
          >
            Herbs, feed, and records — kept where the work actually happens.
          </h2>
        </div>
      </section>

      {/* Scene 3 — pulled-back horizon */}
      <section
        data-scene="2"
        className="relative flex h-screen items-end px-6 pb-24 md:px-16"
      >
        <div className="max-w-2xl">
          <h2
            style={{
              fontSize: 'clamp(32px, 4.6vw, 60px)',
              lineHeight: 1.05,
              color: 'white',
              marginBottom: 20,
              textShadow: '0 3px 22px rgba(0,0,0,0.4)',
            }}
          >
            From the barn to the back country.
          </h2>
          <p
            style={{
              fontSize: 18,
              color: 'rgba(255,255,255,0.9)',
              maxWidth: '56ch',
              textShadow: '0 2px 16px rgba(0,0,0,0.35)',
            }}
          >
            One tool for owners, trainers, and vets — so every horse and every dog gets
            the same care, the same day, no matter who is standing next to them.
          </p>
        </div>
      </section>
      <SupportWidget forceAnon />
    </ScrollHero>
  );
}

function cta(kind: 'primary' | 'ghost'): React.CSSProperties {
  if (kind === 'primary') {
    return {
      padding: '14px 26px',
      background: 'white',
      color: '#2a1a12',
      borderRadius: 10,
      textDecoration: 'none',
      fontWeight: 700,
      fontSize: 15,
      boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
    };
  }
  return {
    padding: '14px 26px',
    background: 'transparent',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.6)',
    borderRadius: 10,
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: 15,
    backdropFilter: 'blur(6px)',
  };
}
