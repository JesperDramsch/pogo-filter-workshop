import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/I18nProvider.jsx";
import { AnnouncerProvider } from "./Announcer.jsx";
import "./index.css";

// Service worker is the trigger that flips Firefox Mobile from "best
// effort" to durable localStorage; autoUpdate handles new versions
// transparently without an update-toast.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <AnnouncerProvider>
        <App />
      </AnnouncerProvider>
    </I18nProvider>
  </React.StrictMode>
);
