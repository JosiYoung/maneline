import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from 'sonner';

import App from './App';
import { queryClient } from './lib/queryClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isSupabaseConfigured } from './lib/supabase';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

// Friendly config-missing screen. Previously supabase.ts threw at module
// load time and the user saw a white page. Now the SPA mounts, reports
// the configuration issue, and the rest of the tree is isolated from it.
function ConfigMissing() {
  return (
    <main
      style={{
        maxWidth: 540,
        margin: '0 auto',
        padding: '72px 24px',
        color: 'var(--color-ink)',
      }}
    >
      <h1 style={{ fontSize: 26, marginBottom: 12 }}>Mane Line is not configured.</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
        The app was deployed without its Supabase environment variables. This
        is an infrastructure error, not something you can fix.
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
        If you are the developer: copy <code>app/.env.example</code> to{' '}
        <code>app/.env.local</code> and set <code>VITE_SUPABASE_URL</code> +{' '}
        <code>VITE_SUPABASE_ANON_KEY</code>, then rebuild.
      </p>
    </main>
  );
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      {isSupabaseConfigured() ? (
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
            <Toaster position="top-center" richColors closeButton />
          </BrowserRouter>
        </QueryClientProvider>
      ) : (
        <ConfigMissing />
      )}
    </ErrorBoundary>
  </StrictMode>
);
