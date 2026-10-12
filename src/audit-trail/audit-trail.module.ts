import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditTrailService } from './audit-trail.service';
import { AuditTrailQueryService } from './audit-trail.query.service';
import { AuditTrailController } from './audit-trail.controller';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditTrailService, AuditTrailQueryService],
  controllers: [AuditTrailController],
  exports: [AuditTrailService],
})
export class AuditTrailModule {}