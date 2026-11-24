import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
  Patch,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AssistantService } from './assistant.service';
import {
  AssistantOverrideDto,
  AssistantSettingsDto,
  ChatDto,
  FeedbackDto,
  CompanyAssistantDto,
  GuideEventDto,
  CreditAdjustDto,
  CreditPackDto,
  UnansweredUpdateDto,
} from './assistant.dto';
@Controller('assistant')
@UseGuards(AuthGuard('jwt'))
export class AssistantController {
  constructor(private readonly service: AssistantService) {}
  @Get('capabilities') async capabilities(@Req() r: any) {
    return this.service.capabilities(await this.service.actor(r.user));
  }
  @Get('help') async help(@Req() r: any) {
    return this.service.help(await this.service.actor(r.user));
  }
  @Get('credit-packs') async creditPacks(@Req() r: any) {
    await this.service.actor(r.user);
    return this.service.packs(true);
  }
  @Get('suggestions') async suggestions(@Req() r: any) {
    return this.service.availableSuggestions(await this.service.actor(r.user));
  }
  @Get('employees') async employees(@Req() r: any, @Query('q') q: string) {
    return this.service.employees(await this.service.actor(r.user), q);
  }
  @Patch('preferences') async preference(
    @Req() r: any,
    @Body() dto: CompanyAssistantDto,
  ) {
    return this.service.companyPreference(
      await this.service.actor(r.user),
      dto,
    );
  }
  @Post('guide-events') @HttpCode(200) async guideEvent(
    @Req() r: any,
    @Body() dto: GuideEventDto,
  ) {
    return this.service.guideEvent(await this.service.actor(r.user), dto);
  }
  @Post('upgrade-click') @HttpCode(200) async upgradeClick(@Req() r: any) {
    return this.service.upgradeClick(await this.service.actor(r.user));
  }
  @Get('conversations') async list(@Req() r: any) {
    return this.service.list(await this.service.actor(r.user));
  }
  @Get('conversations/:id') async get(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const actor = await this.service.actor(r.user),
      c = await this.service.conversation(actor, id);
    return {
      ...c,
      messages: await Promise.all(
        c.messages.map((m) => this.service.present(actor, m)),
      ),
    };
  }
  @Delete('conversations/:id') async remove(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.remove(await this.service.actor(r.user), id);
    return { ok: true };
  }
  @Post('feedback') @HttpCode(200) async feedback(
    @Req() r: any,
    @Body() dto: FeedbackDto,
  ) {
    await this.service.feedback(await this.service.actor(r.user), dto);
    return { ok: true };
  }
  @Post('chat') async chat(
    @Req() r: any,
    @Body() dto: ChatDto,
    @Res() res: Response,
  ) {
    const actor = await this.service.actor(r.user);
    const result = await this.service.present(
      actor,
      await this.service.chat(actor, dto),
    );
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const emit = (type: string, value: unknown) => {
      if (!res.destroyed)
        res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
    };
    emit('meta', {
      conversationId: result.conversationId,
      messageId: result.messageId,
    });
    if ((result.payload as any)?.refusal)
      emit('refusal', { text: result.text });
    else
      for (const chunk of result.text.match(/.{1,140}(?:\s|$)/g) || [
        result.text,
      ])
        emit('text', { text: chunk });
    if ((result.payload as any)?.card)
      emit('card', { card: (result.payload as any).card });
    if ((result.payload as any)?.guideId)
      emit('guide', { guideId: (result.payload as any).guideId });
    emit('done', { ...result, text: undefined });
    res.end();
  }
}
@Controller('admin/assistant')
@UseGuards(AuthGuard('jwt'))
export class AssistantAdminController {
  constructor(private readonly service: AssistantService) {}
  @Get('usage') async usage(@Req() r: any) {
    await this.service.requireSuper(r.user);
    return this.service.usage();
  }
  @Get('unanswered') async unanswered(
    @Req() r: any,
    @Query('days') days?: string,
    @Query('status') status?: string,
    @Query('reason') reason?: string,
  ) {
    await this.service.requireSuper(r.user);
    const d = Math.min(90, Math.max(1, parseInt(days || '7', 10) || 7));
    return this.service.unansweredList(
      d,
      ['NEW', 'PLANNED', 'DONE', 'IGNORED'].includes(status || '') ? status : undefined,
      ['OUT_OF_SCOPE', 'OPEN_LANE', 'ANALYSIS_FAILED'].includes(reason || '')
        ? reason
        : undefined,
    );
  }
  @Patch('unanswered/:key') async unansweredUpdate(
    @Req() r: any,
    @Param('key') key: string,
    @Body() dto: UnansweredUpdateDto,
  ) {
    return this.service.unansweredUpdate(
      await this.service.requireSuper(r.user),
      key,
      dto,
    );
  }
  @Get('companies') async companies(
    @Req() r: any,
    @Query('search') search?: string,
  ) {
    await this.service.requireSuper(r.user);
    return this.service.companies(
      typeof search === 'string' ? search.slice(0, 100) : '',
    );
  }
  @Get('settings') async settings(@Req() r: any) {
    await this.service.requireSuper(r.user);
    return this.service.settings();
  }
  @Post('model-test') @HttpCode(200) async testModel(@Req() r: any) {
    return this.service.testModel(await this.service.requireSuper(r.user));
  }
  @Put('settings') async update(
    @Req() r: any,
    @Body() dto: AssistantSettingsDto,
  ) {
    return this.service.updateSettings(
      await this.service.requireSuper(r.user),
      dto,
    );
  }
  @Get('companies/:id/credits') async credits(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.requireSuper(r.user);
    return this.service.companyCredits(id);
  }
  @Post('companies/:id/credits') @HttpCode(200) async adjust(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreditAdjustDto,
  ) {
    return this.service.adjustCredits(
      await this.service.requireSuper(r.user),
      id,
      dto,
    );
  }
  @Get('packs') async packs(@Req() r: any) {
    await this.service.requireSuper(r.user);
    return this.service.packs(false);
  }
  @Put('packs') async savePack(@Req() r: any, @Body() dto: CreditPackDto) {
    return this.service.savePack(await this.service.requireSuper(r.user), dto);
  }
  @Delete('packs/:id') async removePack(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removePack(
      await this.service.requireSuper(r.user),
      id,
    );
  }
  @Put('companies/:id') async override(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssistantOverrideDto,
  ) {
    return this.service.updateOverride(
      await this.service.requireSuper(r.user),
      id,
      dto,
    );
  }
}