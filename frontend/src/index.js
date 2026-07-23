import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

// Register service worker so the app is installable as a standalone PWA.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = `${process.env.PUBLIC_URL || ""}/service-worker.js`;
    navigator.serviceWorker.register(swUrl).catch(() => {});
  });
}
