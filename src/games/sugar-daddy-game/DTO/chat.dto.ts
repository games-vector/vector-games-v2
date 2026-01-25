/**
 * DTOs for Chat service
 */

export interface ChatAuthor {
  id: string; // Format: "{operatorId}::{userId}"
  userId: string;
  operatorId: string;
  nickname: string;
  gameAvatar: number | null;
}

export interface ChatMessage {
  chatRoom: string; // Format: "sugar-daddy-chat-{languageCode}"
  message: string;
  author: ChatAuthor;
}

export interface JoinChatRoomPayload {
  chatRoom?: string; // Language code like "en", "es", "fr", etc.
  language?: string; // Alternative field name (for frontend compatibility)
}
