import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { Telegram } from "telegraf";
import { loadFunctionsConfig } from "./config.js";
import { FirestoreConversationRepository } from "./repositories/firestoreConversationRepository.js";
import { FirestoreJobRepository } from "./repositories/firestoreJobRepository.js";
import { FirestoreDeliveryRepository } from "./repositories/firestoreDeliveryRepository.js";
import { FirestoreUserRepository } from "./repositories/firestoreUserRepository.js";
import { createCloudTasksService } from "./services/cloudTasksService.js";
import { createComputeService } from "./services/computeService.js";
import { createTaskHandler } from "./taskHandler.js";
import { createCloudTelegramBot } from "./telegramBot.js";
import { createResultDelivery } from "./deliverResult.js";
import { ResultArtifactService } from "./services/resultArtifactService.js";

if (getApps().length === 0) initializeApp();

const region = process.env.GCP_REGION ?? "us-central1";
const telegramToken = defineSecret("TELEGRAM_BOT_TOKEN");
const webhookSecret = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const telegramFunctionServiceAccount = defineString("TELEGRAM_FUNCTION_SERVICE_ACCOUNT");
const wakeFunctionServiceAccount = defineString("WAKE_FUNCTION_SERVICE_ACCOUNT");
const deliveryFunctionServiceAccount = defineString("DELIVERY_FUNCTION_SERVICE_ACCOUNT");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const taskHandler = onRequest({ region, invoker: "private", serviceAccount: wakeFunctionServiceAccount, memory: "512MiB", minInstances: 0, maxInstances: 3 }, async (request, response) => {
  const projectId = required("GCP_PROJECT_ID");
  const location = process.env.CLOUD_TASKS_LOCATION ?? region;
  const queue = process.env.CLOUD_TASKS_QUEUE ?? "codex-wakeups";
  const jobs = new FirestoreJobRepository(getFirestore());
  const tasks = createCloudTasksService({
    projectId,
    location,
    queue,
    handlerUrl: required("CLOUD_TASKS_HANDLER_URL"),
    invokerServiceAccount: required("CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT"),
  });
  const handler = createTaskHandler({
    jobs,
    tasks,
    compute: createComputeService(projectId, process.env.GCP_ZONE ?? "us-central1-a", process.env.GCE_INSTANCE_NAME ?? "telegram-codex-worker"),
    retryDelaySeconds: Number(process.env.WAKE_RETRY_DELAY_SECONDS ?? 60),
  });
  await handler(request, response);
});

export const telegramWebhook = onRequest({ region, secrets: [telegramToken, webhookSecret], serviceAccount: telegramFunctionServiceAccount, memory: "512MiB", minInstances: 0, maxInstances: 3 }, async (request, response) => {
  const expected = webhookSecret.value();
  if (request.get("X-Telegram-Bot-Api-Secret-Token") !== expected) {
    response.status(403).send("Forbidden");
    return;
  }
  const config = loadFunctionsConfig({
    ...process.env,
    TELEGRAM_BOT_TOKEN: telegramToken.value(),
    TELEGRAM_WEBHOOK_SECRET: webhookSecret.value(),
  });
  const firestore = getFirestore();
  const bot = createCloudTelegramBot({
    config,
    users: new FirestoreUserRepository(firestore, {
      timezone: config.defaultTimezone,
      defaultWorkdirKey: config.defaultWorkdirKey,
      maxOutputChars: config.maxTelegramOutputChars,
    }),
    conversations: new FirestoreConversationRepository(firestore, config.conversationTtlMinutes * 60_000),
    jobs: new FirestoreJobRepository(firestore),
    tasks: createCloudTasksService({
      projectId: config.projectId,
      location: config.tasksLocation,
      queue: config.tasksQueue,
      handlerUrl: config.taskHandlerUrl,
      invokerServiceAccount: config.taskInvokerServiceAccount,
    }),
  });
  await bot.handleUpdate(request.body);
  response.status(200).send("OK");
});

export const deliverResult = onDocumentUpdated({ region, document: "jobs/{jobId}", secrets: [telegramToken], retry: true, serviceAccount: deliveryFunctionServiceAccount, memory: "512MiB", minInstances: 0, maxInstances: 3 }, async (event) => {
  const after = event.data?.after.data();
  if (!after || after.deliveryStatus !== "pending" || (after.status !== "completed" && after.status !== "failed")) return;
  const delivery = createResultDelivery(
    new FirestoreDeliveryRepository(getFirestore()),
    new Telegram(telegramToken.value()),
    new ResultArtifactService(required("RESULTS_BUCKET")),
  );
  await delivery(event.params.jobId);
});
