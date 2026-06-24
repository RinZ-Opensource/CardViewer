import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/card.css";
import "./styles/holo.css";
import "./styles/ui.css";
import { installPrivateFontFaces } from "./fonts";
import { App } from "./App";

installPrivateFontFaces();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
