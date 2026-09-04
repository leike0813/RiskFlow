import { createRoot } from "react-dom/client";

import { App } from "./app/App.js";
import "./shell/AppShell.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Web root element is missing");
}

createRoot(root).render(<App />);
