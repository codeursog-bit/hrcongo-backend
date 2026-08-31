// ============================================================================
// 📄 src/documents/documents.controller.ts
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { DocumentsService } from './documents.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DocumentType, DocumentStatus } from '@prisma/client';

const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

@Controller('documents')
@UseGuards(AuthGuard('jwt'))
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // ── GET /documents ───────────────────────────────────────────────────────

  @Get()
  findAll(
    @Request() req,
    @Query('employeeId') employeeId?: string,
    @Query('type') type?: DocumentType,
    @Query('status') status?: DocumentStatus,
    @Query('expiringInDays') expiringInDays?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.documentsService.findAll(req.user.userId, {
      employeeId,
      type,
      status,
      expiringInDays: expiringInDays ? parseInt(expiringInDays) : undefined,
      includeArchived: includeArchived === 'true',
    });
  }

  // ── GET /documents/stats ─────────────────────────────────────────────────

  @Get('stats')
  getStats(@Request() req) {
    return this.documentsService.getStats(req.user.userId);
  }

  // ── GET /documents/expiring ──────────────────────────────────────────────

  @Get('expiring')
  findExpiring(@Request() req, @Query('days') days = '30') {
    return this.documentsService.findAll(req.user.userId, {
      expiringInDays: parseInt(days),
    });
  }

  // ── GET /documents/pending ───────────────────────────────────────────────

  @Get('pending')
  findPending(@Request() req) {
    return this.documentsService.findAll(req.user.userId, {
      status: DocumentStatus.PENDING_REVIEW,
    });
  }

  // ── GET /documents/employee/:employeeId ──────────────────────────────────

  @Get('employee/:employeeId')
  findByEmployee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Request() req,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.documentsService.findByEmployee(
      employeeId,
      req.user.userId,
      includeArchived === 'true',
    );
  }

  // ── GET /documents/:id ───────────────────────────────────────────────────

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentsService.findOne(id, req.user.userId);
  }

  // ── GET /documents/:id/download ──────────────────────────────────────────

  @Get(':id/download')
  getDownloadUrl(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentsService.getSignedUrl(id, req.user.userId);
  }

  // ── POST /documents/upload ───────────────────────────────────────────────

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Format non autorisé: ${file.mimetype}. Acceptés : PDF, JPG, PNG, DOC, DOCX`,
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Request() req,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');

    const uploadResult = await this.cloudinaryService.uploadPrivateFile(
      file,
      `employee-documents/${new Date().getFullYear()}`,
    );

    return this.documentsService.create(
      {
        name: body.name,
        type: body.type,
        fileUrl: uploadResult.publicId,
        fileSize: file.size,
        mimeType: file.mimetype,
        description: body.description,
        employeeId: body.employeeId,
        documentNumber: body.documentNumber,
        issuingBody: body.issuingBody,
        issuedAt: body.issuedAt,
        expiresAt: body.expiresAt,
      },
      req.user.userId,
    );
  }

  // ── PATCH /documents/:id/verify ──────────────────────────────────────────

  @Patch(':id/verify')
  verify(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentsService.verify(id, req.user.userId);
  }

  // ── PATCH /documents/:id/reject ──────────────────────────────────────────

  @Patch(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @Request() req,
  ) {
    return this.documentsService.reject(id, req.user.userId, reason);
  }

  // ── DELETE /documents/:id ────────────────────────────────────────────────

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.documentsService.delete(id, req.user.userId);
  }
}
