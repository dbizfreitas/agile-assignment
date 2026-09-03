import { CONFIG_ERROR_MARKER, isConfigError } from "./config-error";

export function renderErrorPage(error?: unknown): string {
  const config = isConfigError(error);
  const title = config ? "App nao configurado" : "This page didn't load";
  const detail = config
    ? escapeHtml((error as Error).message.slice(CONFIG_ERROR_MARKER.length).trim())
    : "Something went wrong on our end. You can try refreshing or head back home.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #111822; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #94a3b8; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #0077ff; color: #fff; }
      .secondary { background: #161f2c; color: #f8fafc; border-color: #1d283a; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${detail}</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
