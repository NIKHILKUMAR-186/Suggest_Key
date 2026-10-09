import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import './index.css';

/**
 * Root containment boundary.
 *
 * Wraps the whole application so a render error in any provider or in the shell
 * produces a visible error card with a local retry instead of an unmounted
 * React root and a blank page. This is the last line of defence: the route-level
 * boundary in `App.tsx` already contains ordinary page failures.
 *
 * A 429 never reaches here - it is a normal API result handled by the API
 * client's recoverable error path, not a render error.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="application">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
