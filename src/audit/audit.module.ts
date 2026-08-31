import { Module, Global } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
import { AuditController } from './audit.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditInterceptor],
  controllers: [AuditController],
  exports: [AuditInterceptor],
})
export class AuditModule {}
