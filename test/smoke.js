// Serves test/fixtures/site on localhost, records it with dist/cli.js, and checks demo.webm exists.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "fixtures", "site");
const out = path.join(__dirname, "..", "smoke-out");
const server = http.createServer((req, res) => {
  const file = path.join(root, req.url === "/" ? "index.html" : path.normalize(req.url));
  if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html" }).end(fs.readFileSync(file));
});
server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  // Async spawn keeps this process's event loop free to serve the page.
  const child = spawn(process.execPath, [path.join(__dirname, "..", "dist", "cli.js"), url, "--no-cards",
    "--script", path.join(__dirname, "fixtures", "smoke-script.json"), "--out", out], { stdio: "inherit" });
  const timer = setTimeout(() => child.kill(), 120000);
  child.on("close", (code) => {
    clearTimeout(timer);
    server.close();
    try {
      if (code !== 0) throw new Error(`demo-reel exited with ${code}`);
      const webm = path.join(out, "demo.webm");
      const size = fs.statSync(webm).size;
      if (size < 1000) throw new Error(`demo.webm is only ${size} bytes`);
      console.log(`smoke ok: ${webm} (${size} bytes)`);
    } catch (e) {
      console.error(e);
      process.exitCode = 1;
    }
  });
});
