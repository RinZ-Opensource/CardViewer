import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/card.css";
import "./styles/holo.css";
import "./styles/ui.css";
import { installPrivateFontFaces } from "./fonts";
import { App } from "./App";

installPrivateFontFaces();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('Missing #root element; cannot mount the app.');

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
