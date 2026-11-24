import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SupportService } from './support.service';
import {
  SupportAgentCreateDto,
  SupportAgentUpdateDto,
  SupportCreateDto,
  SupportGuestDto,
  SupportGuestSendDto,
  SupportMessagesDto,
  SupportPageDto,
  SupportSendDto,
  SupportUpdateDto,
} from './support.dto';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly service: SupportService) {}
  @Get('tickets')
  @Header('Cache-Control', 'no-store')
  async list(@Req() req: any, @Query() q: SupportPageDto) {
    return this.service.list(
      await this.service.actor(req.user.id),
      false,
      q.offset,
      q.status,
    );
  }
  @Post('tickets')
  @HttpCode(200)
  async create(@Req() req: any, @Body() dto: SupportCreateDto) {
    return this.service.create(await this.service.actor(req.user.id), dto);
  }
  @Get('tickets/:id/messages')
  @Header('Cache-Control', 'no-store')
  async messages(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: SupportMessagesDto,
  ) {
    return this.service.messages(
      await this.service.actor(req.user.id),
      id,
      false,
      q,
    );
  }
  @Post('tickets/:id/messages')
  @HttpCode(200)
  async send(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SupportSendDto,
  ) {
    return this.service.send(
      await this.service.actor(req.user.id),
      id,
      false,
      dto,
    );
  }
}
@Controller('admin/support')
@UseGuards(JwtAuthGuard)
export class SupportStaffController {
  constructor(private readonly service: SupportService) {}
  @Get('tickets')
  @Header('Cache-Control', 'no-store')
  async list(@Req() req: any, @Query() q: SupportPageDto) {
    return this.service.list(
      await this.service.actor(req.user.id, true),
      true,
      q.offset,
      q.status,
    );
  }
  @Get('tickets/:id/messages')
  @Header('Cache-Control', 'no-store')
  async messages(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: SupportMessagesDto,
  ) {
    return this.service.messages(
      await this.service.actor(req.user.id, true),
      id,
      true,
      q,
    );
  }
  @Post('tickets/:id/messages')
  @HttpCode(200)
  async send(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SupportSendDto,
  ) {
    return this.service.send(
      await this.service.actor(req.user.id, true),
      id,
      true,
      dto,
    );
  }
  @Patch('tickets/:id')
  async update(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SupportUpdateDto,
  ) {
    return this.service.update(
      await this.service.actor(req.user.id, true),
      id,
      dto,
    );
  }
  @Post('tickets/:id/guest-link')
  @HttpCode(200)
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  async guestLink(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.resendGuestLink(
      await this.service.actor(req.user.id, true),
      id,
    );
  }
  @Get('agents')
  async agents(@Req() req: any) {
    return this.service.agents(await this.service.actor(req.user.id, true));
  }
  @Post('agents')
  @HttpCode(200)
  async createAgent(@Req() req: any, @Body() dto: SupportAgentCreateDto) {
    return this.service.createAgent(
      await this.service.actor(req.user.id, true, true),
      dto,
    );
  }
  @Patch('agents/:id')
  async updateAgent(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SupportAgentUpdateDto,
  ) {
    return this.service.updateAgent(
      await this.service.actor(req.user.id, true, true),
      id,
      dto.isActive,
    );
  }
}
@Controller('support/guest')
export class SupportGuestController {
  constructor(private readonly service: SupportService) {}
  @Post('read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ short: { limit: 30, ttl: 60000 } })
  read(@Body() dto: SupportGuestDto) {
    return this.service.guestRead(dto.id, dto.token, dto.after, dto.before);
  }
  @Post('messages')
  @HttpCode(200)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  send(@Body() dto: SupportGuestSendDto) {
    return this.service.guestSend(dto.id, dto.token, dto);
  }
}
