import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../auth/get-user.decorator';
import { PortfolioTeamService } from './portfolio-team.service';

@Controller()
export class PortfolioTeamController {
  constructor(private readonly service: PortfolioTeamService) {}

  // ── Protégé : l'admin portefeuille invite / consulte ses invitations ────
  @Post('portfolio/team/invite')
  @UseGuards(AuthGuard('jwt'))
  invite(
    @GetUser('id') userId: string,
    @Body() dto: { email: string; firstName: string; lastName: string },
  ) {
    return this.service.invite(userId, dto);
  }

  @Get('portfolio/team')
  @UseGuards(AuthGuard('jwt'))
  list(@GetUser('id') userId: string) {
    return this.service.listInvitations(userId);
  }

  // ── Public : la personne invitée consulte puis accepte ──────────────────
  @Get('auth/portfolio-invitation-info/:token')
  getInvitationInfo(@Param('token') token: string) {
    return this.service.getInvitationInfo(token);
  }

  @Post('auth/accept-portfolio-invitation/:token')
  acceptInvitation(
    @Param('token') token: string,
    @Body() body: { password: string; firstName?: string; lastName?: string },
  ) {
    return this.service.acceptInvitation(token, body.password, body.firstName, body.lastName);
  }
}