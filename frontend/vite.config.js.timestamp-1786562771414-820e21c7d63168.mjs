// vite.config.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "file:///C:/Users/Dell/Downloads/Projects/chatflow-pro%20(test)/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/Dell/Downloads/Projects/chatflow-pro%20(test)/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
var __vite_injected_original_import_meta_url = "file:///C:/Users/Dell/Downloads/Projects/chatflow-pro%20(test)/frontend/vite.config.js";
var repoRoot = path.resolve(path.dirname(fileURLToPath(__vite_injected_original_import_meta_url)), "..");
var vite_config_default = defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Landing.jsx imports the site copy from backend/src/data/siteContent.js —
    // one source of truth shared with the assistant's indexer. That path is
    // outside this package, so the dev server has to be told it may serve it.
    // Vite infers the same root from the repo lockfile today, but relying on
    // that inference means a lockfile move breaks `npm run dev` with a
    // confusing 403 instead of an error that names the cause.
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 5173
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxEZWxsXFxcXERvd25sb2Fkc1xcXFxQcm9qZWN0c1xcXFxjaGF0Zmxvdy1wcm8gKHRlc3QpXFxcXGZyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxEZWxsXFxcXERvd25sb2Fkc1xcXFxQcm9qZWN0c1xcXFxjaGF0Zmxvdy1wcm8gKHRlc3QpXFxcXGZyb250ZW5kXFxcXHZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9EZWxsL0Rvd25sb2Fkcy9Qcm9qZWN0cy9jaGF0Zmxvdy1wcm8lMjAodGVzdCkvZnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xyXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAnbm9kZTp1cmwnO1xyXG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcclxuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcclxuXHJcbmNvbnN0IHJlcG9Sb290ID0gcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpLCAnLi4nKTtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgcGx1Z2luczogW3JlYWN0KCldLFxyXG4gIHNlcnZlcjoge1xyXG4gICAgcG9ydDogNTE3MyxcclxuICAgIC8vIExhbmRpbmcuanN4IGltcG9ydHMgdGhlIHNpdGUgY29weSBmcm9tIGJhY2tlbmQvc3JjL2RhdGEvc2l0ZUNvbnRlbnQuanMgXHUyMDE0XHJcbiAgICAvLyBvbmUgc291cmNlIG9mIHRydXRoIHNoYXJlZCB3aXRoIHRoZSBhc3Npc3RhbnQncyBpbmRleGVyLiBUaGF0IHBhdGggaXNcclxuICAgIC8vIG91dHNpZGUgdGhpcyBwYWNrYWdlLCBzbyB0aGUgZGV2IHNlcnZlciBoYXMgdG8gYmUgdG9sZCBpdCBtYXkgc2VydmUgaXQuXHJcbiAgICAvLyBWaXRlIGluZmVycyB0aGUgc2FtZSByb290IGZyb20gdGhlIHJlcG8gbG9ja2ZpbGUgdG9kYXksIGJ1dCByZWx5aW5nIG9uXHJcbiAgICAvLyB0aGF0IGluZmVyZW5jZSBtZWFucyBhIGxvY2tmaWxlIG1vdmUgYnJlYWtzIGBucG0gcnVuIGRldmAgd2l0aCBhXHJcbiAgICAvLyBjb25mdXNpbmcgNDAzIGluc3RlYWQgb2YgYW4gZXJyb3IgdGhhdCBuYW1lcyB0aGUgY2F1c2UuXHJcbiAgICBmczogeyBhbGxvdzogW3JlcG9Sb290XSB9LFxyXG4gICAgcHJveHk6IHtcclxuICAgICAgJy9hcGknOiB7XHJcbiAgICAgICAgdGFyZ2V0OiAnaHR0cDovLzEyNy4wLjAuMTo0MDAwJyxcclxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAgcHJldmlldzoge1xyXG4gICAgcG9ydDogNTE3MyxcclxuICB9LFxyXG59KTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5WCxPQUFPLFVBQVU7QUFDMVksU0FBUyxxQkFBcUI7QUFDOUIsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxXQUFXO0FBSDZOLElBQU0sMkNBQTJDO0FBS2hTLElBQU0sV0FBVyxLQUFLLFFBQVEsS0FBSyxRQUFRLGNBQWMsd0NBQWUsQ0FBQyxHQUFHLElBQUk7QUFFaEYsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQU9OLElBQUksRUFBRSxPQUFPLENBQUMsUUFBUSxFQUFFO0FBQUEsSUFDeEIsT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLFFBQ04sUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLE1BQ2hCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxFQUNSO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
