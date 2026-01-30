export interface ChatAuthor {
  id: string;
  userId: string;
  operatorId: string;
  nickname: string;
  gameAvatar: number | null;
}

export interface ChatMessage {
  chatRoom: string;
  message: string;
  author: ChatAuthor;
}

export interface JoinChatRoomPayload {
  chatRoom?: string;
  language?: string;
}
