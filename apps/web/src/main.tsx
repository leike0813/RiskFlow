import { createRoot } from "react-dom/client";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Web root element is missing");
}

createRoot(root).render(null);
