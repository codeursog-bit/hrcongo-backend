// ============================================================================
// 📁 chat/chat.controller.ts
// ----------------------------------------------------------------------------
// Adapté à ton projet : JwtAuthGuard = src/auth/jwt-auth.guard.ts ; req.user = { id, userId, role, companyId }
// ============================================================================
import {
  Body, Controller, ForbiddenException, Get, Header, HttpCode, NotFoundException, Param,
  ParseUUIDPipe, Post, Query, Req, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
// ⚠️ ADAPTER : chemin de ton guard JWT
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatBodyScrubInterceptor } from './chat-body-scrub.interceptor';
import { ChatService } from './chat.service';
import { OpenConversationDto, SendMessageDto } from './chat.dto';
import { CHAT_ROLES, ChatActor } from './chat.types';

// ⚠️ ADAPTER : forme de req.user chez toi
function actorFrom(req: any): ChatActor {
  // 🔌 Interrupteur d'urgence : CHAT_ENABLED=false (puis redémarrage) coupe tout le module.
  // Les routes répondent 404 → le front arrête de lui-même de poller. Aucun redéploiement de code.
  if (process.env.CHAT_ENABLED === 'false') throw new NotFoundException();
  const u = req.user ?? {};
  const id = u.id ?? u.sub ?? u.userId;
  if (!id || !u.role || !u.companyId || !CHAT_ROLES.includes(u.role)) {
    throw new ForbiddenException('Messagerie non disponible pour ce compte.');
  }
  return { id, role: u.role, companyId: u.companyId };
}

const toInt = (v?: string) => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

// Le poll est fréquent par conception : on le retire du ThrottlerGuard global
// (le service applique son propre limiteur par utilisateur, 120/min).
@SkipThrottle()
@UseGuards(JwtAuthGuard)
@UseInterceptors(ChatBodyScrubInterceptor)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('contacts')
  contacts(@Req() req: any, @Query('q') q?: string, @Query('limit') limit?: string) {
    return this.chat.contacts(actorFrom(req), q, toInt(limit) ?? 30);
  }

  @Get('conversations')
  conversations(@Req() req: any) {
    return this.chat.listConversations(actorFrom(req));
  }

  @Post('conversations')
  @HttpCode(200)
  open(@Req() req: any, @Body() dto: OpenConversationDto) {
    return this.chat.openConversation(actorFrom(req), dto.userId);
  }

  @Get('conversations/:id/messages')
  messages(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.getMessages(actorFrom(req), id, {
      before: toInt(before),
      after: toInt(after),
      limit: toInt(limit),
    });
  }

  @Post('conversations/:id/messages')
  send(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(actorFrom(req), id, dto.body, dto.clientId);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  read(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.chat.markRead(actorFrom(req), id);
  }

  @Get('poll')
  @Header('Cache-Control', 'no-store')
  poll(@Req() req: any, @Query('v') v?: string, @Query('since') since?: string) {
    return this.chat.poll(actorFrom(req), v, since);
  }

  /** Appelé quand l'onglet passe en arrière-plan → le push hors-app reprend aussitôt. */
  @Post('away')
  @HttpCode(200)
  away(@Req() req: any) {
    return this.chat.away(actorFrom(req));
  }
}