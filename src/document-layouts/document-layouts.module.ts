import { Module } from '@nestjs/common';
import { DocumentLayoutsController } from './document-layouts.controller';
import { DocumentLayoutsService } from './document-layouts.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [CloudinaryModule],
  controllers: [DocumentLayoutsController],
  providers: [DocumentLayoutsService],
})
export class DocumentLayoutsModule {}
