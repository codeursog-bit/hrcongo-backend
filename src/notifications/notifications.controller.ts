// src/notifications/notifications.controller.ts

import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  UseGuards,
  Request,
  Query,
  Body,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushNotificationsService,
  ) {}

  @Get()
  findAll(@Request() req, @Query('limit') limit?: string) {
    // ✅ Utiliser req.user.userId (cohérent avec la stratégie JWT)
    return this.notificationsService.findAll(
      req.user.userId,
      limit ? parseInt(limit) : undefined,
    );
  }

  @Get('unread-count')
  getUnreadCount(@Request() req) {
    // ✅ Utiliser req.user.userId
    return this.notificationsService.getUnreadCount(req.user.userId);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @Request() req) {
    // ✅ Utiliser req.user.userId
    return this.notificationsService.markAsRead(id, req.user.userId);
  }

  @Patch('read-all')
  markAllAsRead(@Request() req) {
    // ✅ Utiliser req.user.userId
    return this.notificationsService.markAllAsRead(req.user.userId);
  }

  // ========================================
  // 🔑 VAPID Public Key (frontend en a besoin pour s'abonner)
  // ========================================
  @Get('push/vapid-key')
  getVapidKey() {
    return { publicKey: this.pushService.getPublicKey() };
  }

  // ========================================
  // 📱 Enregistrer le token push du device
  // ========================================
  @Post('push/subscribe')
  async subscribePush(
    @Body()
    body: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    @Request() req,
  ) {
    await this.pushService.registerToken(req.user.userId, body);
    return {
      success: true,
      message: 'Notifications activées sur cet appareil.',
    };
  }

  // ========================================
  // 🔕 Désabonner l'appareil
  // ========================================
  @Delete('push/unsubscribe')
  async unsubscribePush(@Request() req) {
    await this.pushService.unregisterToken(req.user.userId);
    return { success: true, message: 'Notifications désactivées.' };
  }
}
