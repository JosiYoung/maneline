import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 48, marginBottom: 12 }}>404</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: 24 }}>
        That page isn't part of Mane Line (yet).
      </p>
      <Link to="/" style={{ fontWeight: 600 }}>&larr; Back to home</Link>
    </main>
  );
}
