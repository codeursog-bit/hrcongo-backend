// ============================================================================
// 📄 backend/src/documents/documents.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    CloudinaryService, // ✅ Ajout du service Cloudinary
  ],
})
export class DocumentsModule {}