// A magyar D3 locale-t minden más modul előtt kell beállítani, mert a formázók modul-betöltéskor jönnek létre.
import './utils/locale.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
