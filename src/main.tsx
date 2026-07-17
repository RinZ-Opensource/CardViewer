import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/card.css";
import "./styles/holo.css";
import "./styles/ui.css";
import "./styles/scorecard-ui.css";
import "./styles/scorecard-mai.css";
import "./styles/scorecard-chuni.css";
import "./styles/scorecard-chuni-box.css";
import "./styles/scorecard-ongeki.css";
import "./styles/scorecard-ongeki-bt.css";
import { AppShell } from "./AppShell";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('Missing #root element; cannot mount the app.');

createRoot(rootElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
