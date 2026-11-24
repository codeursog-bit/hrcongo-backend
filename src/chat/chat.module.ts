// ============================================================================
// 📁 chat/chat.module.ts — branché sur ton NotificationsModule (push existant)
// ============================================================================
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushNotificationsService } from '../notifications/push-notifications.service';

import { ChatController } from './chat.controller';
import { ChatPolicyService } from './chat-policy.service';
import { ChatRetentionService } from './chat-retention.service';
import { ChatSignalService } from './chat-signal.service';
import { CHAT_PUSH_SENDER, ChatPushSender, ChatService } from './chat.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatPolicyService,
    ChatSignalService,
    ChatRetentionService,
    {
      provide: CHAT_PUSH_SENDER,
      inject: [PushNotificationsService],
      useFactory: (push: PushNotificationsService): ChatPushSender => ({
        send: (userId, p) =>
          push.sendPushToUser(userId, {
            title: p.title,
            body: p.body,
            url: p.url,
            tag: p.tag,
            requireInteraction: false,
            urgency: 'high',        // livraison immédiate même téléphone en veille
            ttlSeconds: 60 * 60 * 24, // un message de plus de 24 h n'a plus de valeur en push
          }),
      }),
    },
  ],
})
export class ChatModule {}