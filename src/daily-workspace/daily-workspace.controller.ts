import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DailyWorkspaceService } from './daily-workspace.service';
import {
  AnnouncementDto,
  AssignTaskDto,
  CompanyAppearanceDto,
  PersonalTaskDto,
  ReactionDto,
  EventCommentDto,
  TaskCommentDto,
  TaskStatusDto,
  UserAppearanceDto,
} from './daily-workspace.dto';

@Controller()
@UseGuards(AuthGuard('jwt'))
export class DailyWorkspaceController {
  constructor(private readonly service: DailyWorkspaceService) {}
  @Get('tasks/me') async mine(@Req() r: any) {
    return this.service.tasks(await this.service.actor(r.user), 'me');
  }
  @Get('tasks/admin') async team(@Req() r: any) {
    return this.service.tasks(await this.service.actor(r.user), 'admin');
  }
  @Post('tasks') async create(@Req() r: any, @Body() dto: PersonalTaskDto) {
    return this.service.createTask(await this.service.actor(r.user), dto);
  }
  @Post('tasks/assign') async assign(
    @Req() r: any,
    @Body() dto: AssignTaskDto,
  ) {
    return this.service.assignTask(await this.service.actor(r.user), dto);
  }
  @Patch('tasks/:id') async status(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TaskStatusDto,
  ) {
    return this.service.taskStatus(await this.service.actor(r.user), id, dto);
  }
  @Post('tasks/:id/comments') async comment(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TaskCommentDto,
  ) {
    return this.service.comment(await this.service.actor(r.user), id, dto);
  }
  @Get('announcements') async announcements(@Req() r: any) {
    return this.service.announcements(await this.service.actor(r.user));
  }
  @Post('announcements') async announce(
    @Req() r: any,
    @Body() dto: AnnouncementDto,
  ) {
    return this.service.announce(await this.service.actor(r.user), dto);
  }
  @Get('day-events') async events(@Req() r: any) {
    return this.service.events(await this.service.actor(r.user));
  }
  @Post('day-events/:id/comments') async commentEvent(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EventCommentDto,
  ) {
    return this.service.commentEvent(await this.service.actor(r.user), id, dto);
  }
  @Post('day-events/:id/reactions') async react(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactionDto,
  ) {
    return this.service.react(await this.service.actor(r.user), id, dto.emoji);
  }
  @Get('anniversaries/notifications') async anniversaries(@Req() r: any) {
    return this.service.anniversaries(await this.service.actor(r.user));
  }
  @Patch('anniversaries/notifications/:id/read') async read(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.readAnniversary(await this.service.actor(r.user), id);
  }
  @Get('day-overview/me') async overview(@Req() r: any) {
    return this.service.overview(await this.service.actor(r.user));
  }
  @Get('appearance/me') async appearance(@Req() r: any) {
    return this.service.appearance(await this.service.actor(r.user));
  }
  @Patch('users/me/appearance') async userAppearance(
    @Req() r: any,
    @Body() dto: UserAppearanceDto,
  ) {
    return this.service.saveUserAppearance(
      await this.service.actor(r.user),
      dto,
    );
  }
  @Patch('companies/:id/appearance') async companyAppearance(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompanyAppearanceDto,
  ) {
    return this.service.saveCompanyAppearance(
      await this.service.actor(r.user),
      id,
      dto,
    );
  }
}