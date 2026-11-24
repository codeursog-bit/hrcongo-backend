// ============================================================================
// 📁 src/contact/contact.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [PrismaModule, SupportModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
