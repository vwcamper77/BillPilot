import net from "node:net";
import { spawn } from "node:child_process";

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort) {
  let port = startPort;

  while (!(await canListen(port))) {
    port += 1;
  }

  return port;
}

const requestedPort = Number.parseInt(process.env.PORT || "3000", 10);
const basePort = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 3000;
const port = await findAvailablePort(basePort);
const distDir = `.next-dev-${port}`;

const child = spawn(
  process.execPath,
  ["./node_modules/next/dist/bin/next", "dev", "-p", String(port)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      NEXT_DIST_DIR: distDir,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
