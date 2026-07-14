import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { seedIfEmpty } from './globals.js';
import './styles/global.css';

seedIfEmpty();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
