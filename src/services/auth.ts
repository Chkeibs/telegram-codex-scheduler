export function isAuthorized(allowedUserIds: ReadonlySet<string>, telegramUserId: string | null | undefined): telegramUserId is string {
  return telegramUserId !== null && telegramUserId !== undefined && allowedUserIds.has(telegramUserId);
}
