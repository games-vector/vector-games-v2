/**
 * Mock data for chatService-messages response
 * TODO: Replace with real data from database/chat service
 */

import { ChatMessage } from '../DTO/chat.dto';

/**
 * Generate mock chat messages
 * TODO: Replace with actual chat messages from database
 */
export function getMockChatMessages(chatRoom: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const operators = [
    '810039ef-8b4a-4242-861f-623f64615e92',
    '8d1e6547-271e-4894-b053-ed659c0f4b0a',
    '97dc5e94-2850-413f-ae8e-def1c4b6e7f5',
    'cd7b239a-4f0b-45ac-83c2-56b66d8a079c',
    '021edeee-182b-47dd-ba1e-49952b14a14b',
  ];

  const nicknames = [
    'Soham23', 'cgav0406', 'player1', 'gamer123', 'betmaster',
    'lucky7', 'winner99', 'progamer', 'testuser1', 'testuser2',
    'user001', 'user002', 'user003', 'user004', 'user005',
    'agent_123', 'agent_456', 'agent_789', 'agent_101', 'agent_202',
    'player_alpha', 'player_beta', 'player_gamma', 'player_delta', 'player_epsilon',
    'gamer_001', 'gamer_002', 'gamer_003', 'gamer_004', 'gamer_005',
    'bet_001', 'bet_002', 'bet_003', 'bet_004', 'bet_005',
    'user_alpha', 'user_beta', 'user_gamma', 'user_delta', 'user_epsilon',
    'test_001', 'test_002', 'test_003', 'test_004', 'test_005',
    'chatter1', 'chatter2', 'chatter3', 'chatter4', 'chatter5',
    'talker1', 'talker2', 'talker3', 'talker4', 'talker5',
    'speaker1', 'speaker2', 'speaker3', 'speaker4', 'speaker5',
    'msg_user1', 'msg_user2', 'msg_user3', 'msg_user4', 'msg_user5',
    'chat_user1', 'chat_user2', 'chat_user3', 'chat_user4', 'chat_user5',
    'room_user1', 'room_user2', 'room_user3', 'room_user4', 'room_user5',
    'active_user1', 'active_user2', 'active_user3', 'active_user4', 'active_user5',
    'social_user1', 'social_user2', 'social_user3', 'social_user4', 'social_user5',
    'fun_user1', 'fun_user2', 'fun_user3', 'fun_user4', 'fun_user5',
    'cool_user1', 'cool_user2', 'cool_user3', 'cool_user4', 'cool_user5',
  ];

  const sampleMessages = [
    '8898 9999//=:!! Knz z..,n',
    '   n ,',
    'E',
    'Hello everyone!',
    'Good luck!',
    'Nice win!',
    'Let\'s go!',
    'Amazing!',
    'Wow!',
    'Great game!',
    'Good luck to all!',
    'Let\'s win big!',
    'This is exciting!',
    'Good game everyone',
    'Nice one!',
    'Congratulations!',
    'Well played!',
    'Awesome!',
    'Fantastic!',
    'Incredible!',
    'Unbelievable!',
    'What a round!',
    'That was close!',
    'Almost there!',
    'So close!',
    'Better luck next time',
    'Next round!',
    'Here we go!',
    'Good vibes!',
    'Positive energy!',
  ];

  // Generate chat room name from language code
  const roomName = `sugar-daddy-chat-${chatRoom}`;

  for (let i = 0; i < 100; i++) {
    const operatorId = operators[i % operators.length];
    const userId = i < 50 ? `157215${i}` : `agent_${i}`;
    const nickname = nicknames[i % nicknames.length];
    const message = sampleMessages[i % sampleMessages.length];

    const messageObj: ChatMessage = {
      chatRoom: roomName,
      message: message,
      author: {
        id: `${operatorId}::${userId}`,
        userId: userId,
        operatorId: operatorId,
        nickname: nickname,
        gameAvatar: i % 3 === 0 ? null : Math.floor(Math.random() * 12),
      },
    };

    messages.push(messageObj);
  }

  return messages;
}
