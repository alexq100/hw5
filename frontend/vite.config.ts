import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The desk runs on http://localhost:5173 and talks to the FastAPI backend on http://localhost:8000.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
