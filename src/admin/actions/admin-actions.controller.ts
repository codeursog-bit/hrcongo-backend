// ============================================================================
// src/admin/actions/admin-actions.controller.ts
// Routes SUPER_ADMIN : actions de support (bulletins, utilisateurs) + journal.
// ============================================================================
import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../guards/ultra-admin.guard';
import { AdminActionsService } from './admin-actions.service';
import {
  ActionsHistoryQueryDto, ChangePayrollStatusDto, ChangeUserEmailDto, ChangeUserRoleDto, DeletePayrollDto, ListPayrollsQueryDto,
  SearchSupportUsersQueryDto, SetUserActiveDto, UserSupportActionDto,
} from './admin-actions.dto';

const actorId = (req: any): string => req.user.userId ?? req.user.sub;
const routeOf = (req: any): string => `${req.method} ${req.originalUrl?.split('?')[0] ?? ''}`.slice(0, 200);

@Controller('admin/actions')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class AdminActionsController {
  constructor(private readonly service: AdminActionsService) {}

  // ── Bulletins ───────────────────────────────────────────────────────────
  @Get('payrolls')
  listPayrolls(@Query() q: ListPayrollsQueryDto) {
    return this.service.listPayrolls(q);
  }

  @Patch('payrolls/:id/status')
  changePayrollStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePayrollStatusDto,
    @Request() req,
  ) {
    return this.service.changePayrollStatus(actorId(req), id, dto, routeOf(req));
  }

  @Delete('payrolls/:id')
  deletePayroll(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeletePayrollDto, @Request() req) {
    return this.service.deletePayroll(actorId(req), id, dto, routeOf(req));
  }

  // ── Utilisateurs ────────────────────────────────────────────────────────
  @Get('users')
  searchUsers(@Query() q: SearchSupportUsersQueryDto) {
    return this.service.searchUsers(q.q, q.companyId);
  }

  @Post('users/:id/unlock')
  unlock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UserSupportActionDto, @Request() req) {
    return this.service.unlockUser(actorId(req), id, dto.reason, routeOf(req));
  }

  @Patch('users/:id/active')
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserActiveDto, @Request() req) {
    return this.service.setUserActive(actorId(req), id, dto.isActive, dto.reason, routeOf(req));
  }

  @Post('users/:id/reset-password')
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UserSupportActionDto, @Request() req) {
    return this.service.resetUserPassword(actorId(req), id, dto.reason, routeOf(req));
  }

  @Post('users/:id/disable-2fa')
  disable2fa(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UserSupportActionDto, @Request() req) {
    return this.service.disableUserTwoFactor(actorId(req), id, dto.reason, routeOf(req));
  }

  @Post('users/:id/revoke-sessions')
  revokeSessions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UserSupportActionDto, @Request() req) {
    return this.service.revokeUserSessions(actorId(req), id, dto.reason, routeOf(req));
  }

  @Patch('users/:id/email')
  changeEmail(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeUserEmailDto, @Request() req) {
    return this.service.changeUserEmail(actorId(req), id, dto.email, dto.reason, routeOf(req));
  }

  @Patch('users/:id/role')
  changeRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeUserRoleDto, @Request() req) {
    return this.service.changeUserRole(actorId(req), id, dto.role, dto.reason, routeOf(req));
  }

  @Delete('invitations/:id')
  revokeInvitation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UserSupportActionDto, @Request() req) {
    return this.service.revokeInvitation(actorId(req), id, dto.reason, routeOf(req));
  }

  // ── Journal ─────────────────────────────────────────────────────────────
  @Get('history')
  history(@Query() q: ActionsHistoryQueryDto) {
    return this.service.history(q.companyId, q.page);
  }
}