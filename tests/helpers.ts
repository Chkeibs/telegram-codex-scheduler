import { openDatabase } from "../src/db/database.js";
import { ConversationStateService } from "../src/services/conversationStateService.js";
import { JobService } from "../src/services/jobService.js";
import { UserService } from "../src/services/userService.js";

export function createTestServices() {
  const database = openDatabase(":memory:");
  const users = new UserService(database, {
    timezone: "Europe/Paris",
    defaultWorkdir: process.cwd(),
    maxOutputChars: 3500,
  });
  const jobs = new JobService(database);
  const conversations = new ConversationStateService(database, 30);
  users.ensureUser("123", "123", "tester");
  return { database, users, jobs, conversations };
}
