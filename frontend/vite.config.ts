import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

const certDir = path.resolve(__dirname, "../certs");
const hasSSL = fs.existsSync(path.join(certDir, "cert.pem"));
const backendPort = process.env.BACKEND_PORT || "8000";
const livekitPort = process.env.LIVEKIT_PORT || "7880";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    https: hasSSL
      ? { key: fs.readFileSync(path.join(certDir, "key.pem")), cert: fs.readFileSync(path.join(certDir, "cert.pem")) }
      : undefined,
    proxy: {
      "/api": {
        target: `https://localhost:${backendPort}`,
        secure: false, // Accept self-signed cert
      },
      "/ws": {
        target: `https://localhost:${backendPort}`,
        secure: false,
        ws: true,
      },
      "/rtc": {
        target: `http://localhost:${livekitPort}`,
        ws: true,
      },
    },
  },
});
