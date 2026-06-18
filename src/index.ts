import { createApplication } from "./bot.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openDatabase(config.databasePath);
  const application = createApplication(config, database);

  await application.bot.telegram.setMyCommands([
    { command: "start", description: "Open the bot and main menu" },
    { command: "menu", description: "Show the main menu" },
    { command: "schedule", description: "Schedule a Codex message" },
    { command: "run_now", description: "Run a Codex message now" },
    { command: "jobs", description: "List pending scheduled messages" },
    { command: "cancel", description: "Cancel a scheduled message" },
    { command: "settings", description: "Change your preferences" },
    { command: "help", description: "Show help and safety information" },
  ]);
  let stopping = false;
  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    application.scheduler.stop();
    application.bot.stop(signal);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  application.scheduler.start();
  try {
    const launch = application.bot.launch();
    const codexStatus = await application.services.codexRunner.checkAvailable();
    console.log(codexStatus.ok ? `Bot started. ${codexStatus.detail}` : `Bot started, but Codex is unavailable: ${codexStatus.detail}`);
    await launch;
  } finally {
    application.scheduler.stop();
    database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
