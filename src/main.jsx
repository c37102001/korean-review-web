import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './app/App.jsx';

if (typeof document !== 'undefined') {
  createRoot(document.getElementById('root')).render(<App />);
}
