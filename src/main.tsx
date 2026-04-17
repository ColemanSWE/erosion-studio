import React from "react";
import ReactDOM from "react-dom/client";
import App from "./components/App";
import "./styles/global.scss";

if (!window.electron) {
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:9999;background:#c0392b;color:#fff;" +
    "padding:8px 16px;font:13px/1.4 monospace;text-align:center;";
  banner.textContent =
    "Not running in Electron — export will not work. " +
    "Use the Electron window that opened alongside the dev server, not this browser/IDE preview.";
  document.body.appendChild(banner);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
