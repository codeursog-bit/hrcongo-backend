// ============================================================================
// Fichier: backend/src/admin/guards/ultra-admin.guard.ts
// ============================================================================

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class UltraAdminGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Accès refusé. Super Admin requis.');
    }

    return true;
  }
}
