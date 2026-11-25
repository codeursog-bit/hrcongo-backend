import {
  Body,
  Controller,
  HttpCode,
  Injectable,
  Post,
  Request,
  UseGuards,
  PayloadTooLargeException,
  HttpException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ClientErrorDto } from './client-error.dto';
import { IncidentsService } from './incidents.service';

@Injectable()
export class OptionalIncidentSessionGuard extends AuthGuard('jwt') {
  handleRequest(_err: unknown, user: any) {
    return user || null;
  }
}
@Controller('client-errors')
export class ClientErrorsController {
  private readonly rates = new Map<string, { time: number; count: number }>();
  constructor(private readonly incidents: IncidentsService) {}
  private consume(key: string, max: number) {
    const now = Date.now();
    let bucket = this.rates.get(key);
    if (!bucket || now - bucket.time >= 60000) {
      bucket = { time: now, count: 0 };
      this.rates.set(key, bucket);
    }
    if (++bucket.count > max)
      throw new HttpException('Signalements temporairement limités.', 429);
    if (this.rates.size > 10000) {
      for (const [id, row] of this.rates)
        if (now - row.time >= 60000) this.rates.delete(id);
      if (this.rates.size > 10000)
        this.rates.delete(this.rates.keys().next().value!);
    }
  }
  @Post()
  @HttpCode(204)
  @UseGuards(OptionalIncidentSessionGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  capture(@Request() req: any, @Body() dto: ClientErrorDto) {
    if (!this.incidents.enabled) return;
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > 16384)
      throw new PayloadTooLargeException();
    this.consume(`ip:${req.ip ?? 'unknown'}`, 30);
    if (req.user?.companyId) this.consume(`company:${req.user.companyId}`, 300);
    if (/bot|crawler|spider|headless/i.test(req.headers['user-agent'] ?? ''))
      return;
    this.incidents.capture({
      source: 'FRONT',
      code: dto.code,
      message: dto.message,
      stack: dto.stack,
      path: dto.path,
      version: dto.version,
      severity: dto.code === 'CHUNK_LOAD' ? 'INFO' : 'ERROR',
      userId: req.user?.userId,
      companyId: req.user?.companyId,
      context: {
        browser: dto.browser,
        screen: dto.screen,
        online: dto.online,
        breadcrumbs: dto.breadcrumbs,
      },
    });
  }
}
