import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './services/serviceWorkerRegistration.ts';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { FirebaseProvider } from './contexts/FirebaseContext.tsx';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <FirebaseProvider>
      <App />
    </FirebaseProvider>
  </ErrorBoundary>
);
