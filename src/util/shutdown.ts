export type ShutdownHandler = () => void | Promise<void>;

export function registerShutdown(handlers: ShutdownHandler[]): void {
  let shuttingDown = false;

  const run = async (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[github-mcp-sketch] shutting down (${reason})`);
    for (const h of handlers) {
      try {
        await h();
      } catch (err) {
        console.error("[github-mcp-sketch] shutdown handler error:", err);
      }
    }
    process.exit(exitCode);
  };

  process.on("SIGINT", () => void run("SIGINT", 0));
  process.on("SIGTERM", () => void run("SIGTERM", 0));
  process.on("uncaughtException", (err) => {
    console.error("[github-mcp-sketch] uncaughtException:", err);
    void run("uncaughtException", 1);
  });
  process.on("unhandledRejection", (err) => {
    console.error("[github-mcp-sketch] unhandledRejection:", err);
    void run("unhandledRejection", 1);
  });
}
