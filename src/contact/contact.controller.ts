// ============================================================================
// 📁 src/contact/contact.controller.ts — Konza RH
// POST /contact      → public (tout le monde peut envoyer un message)
// GET  /contact      → SUPER_ADMIN uniquement (liste des messages)
// PATCH /contact/:id → SUPER_ADMIN uniquement (marquer lu)
// ============================================================================
import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CreateContactDto } from './contact.service';
import { ContactService } from './contact.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  // ── POST /contact — PUBLIC (throttle serré anti-spam) ─────────────────────
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } }) // max 3 messages/min par IP
  async create(@Body() body: CreateContactDto, @Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      undefined;
    return this.contactService.create(body, ip);
  }

  // ── GET /contact — SUPER_ADMIN uniquement ─────────────────────────────────
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@GetUser() user: any, @Query('status') status?: string) {
    if (user.role !== 'SUPER_ADMIN') {
      return { messages: [], total: 0 };
    }
    return this.contactService.findAll(status);
  }

  // ── PATCH /contact/:id/read — SUPER_ADMIN uniquement ──────────────────────
  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  markAsRead(@Param('id') id: string, @GetUser() user: any) {
    if (user.role !== 'SUPER_ADMIN') return { success: false };
    return this.contactService.markAsRead(id);
  }
}
