import type { FirestoreDeliveryRepository } from "./repositories/firestoreDeliveryRepository.js";
import type { ResultArtifactServiceLike } from "./services/resultArtifactService.js";

export interface TelegramSenderLike {
  sendMessage(chatId: string, text: string): Promise<{ message_id: number }>;
  sendDocument(chatId: string, document: { source: Buffer; filename: string }, options: { caption: string }): Promise<{ message_id: number }>;
}

export function createResultDelivery(repository: FirestoreDeliveryRepository, telegram: TelegramSenderLike, artifacts: ResultArtifactServiceLike) {
  return async (jobId: string): Promise<"sent" | "skipped"> => {
    const delivery = await repository.claim(jobId);
    if (!delivery) return "skipped";
    const text = delivery.kind === "reset_credit_status" && delivery.status === "completed"
      ? (delivery.outputPreview ?? "Codex resets: 0")
      : (delivery.status === "completed"
      ? `✅ Codex task completed.\n\nOutput:\n${delivery.outputPreview ?? "(No output returned.)"}`
      : delivery.kind === "reset_credit_status"
        ? `Codex resets: unavailable`
        : `❌ Codex task failed.\n\nError:\n${delivery.errorPreview ?? "Unknown error. Check protected logs."}`);
    const boundedText = text.slice(0, delivery.maxOutputChars);
    try {
      const message = delivery.kind !== "reset_credit_status" && delivery.outputMode === "full" && delivery.resultObjectName
        ? await telegram.sendDocument(delivery.telegramChatId, {
          source: await artifacts.read(delivery.resultObjectName),
          filename: `codex-result-${jobId.slice(0, 8)}.txt`,
        }, { caption: boundedText.slice(0, 1024) })
        : await telegram.sendMessage(delivery.telegramChatId, boundedText);
      await repository.markSent(jobId, message.message_id);
      if (delivery.resultObjectName) await artifacts.delete(delivery.resultObjectName).catch(() => undefined);
      return "sent";
    } catch (error) {
      await repository.releaseForRetry(jobId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
}
