import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * ✅ Guard pour vérifier si l'utilisateur a les rôles requis
 *
 * Fonctionne avec le décorateur @Roles()
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Récupérer les rôles requis depuis les métadonnées
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Si aucun rôle requis, autoriser l'accès
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Récupérer l'utilisateur depuis la requête
    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.role) {
      throw new ForbiddenException(
        'Accès refusé : utilisateur non authentifié',
      );
    }

    // Vérifier si l'utilisateur a au moins un des rôles requis
    const hasRole = requiredRoles.includes(user.role);

    if (!hasRole) {
      throw new ForbiddenException(
        `Accès refusé : rôle requis parmi [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
