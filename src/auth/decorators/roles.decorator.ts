import { SetMetadata } from '@nestjs/common';

/**
 * ✅ Décorateur pour définir les rôles autorisés sur une route
 *
 * Usage:
 * @Roles('ADMIN', 'HR_MANAGER')
 * @UseGuards(RolesGuard)
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
