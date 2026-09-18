import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './app/App.jsx';
import { AppErrorBoundary } from './app/AppErrorBoundary.jsx';

if (typeof document !== 'undefined') {
  createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>);
}
