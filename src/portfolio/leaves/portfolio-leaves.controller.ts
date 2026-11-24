import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../auth/get-user.decorator';
import { PortfolioLeavesService } from './portfolio-leaves.service';
import { CreateLeaveDto } from '../../leaves/dto/create-leave.dto';

// 🆕 Congés — vue transverse "toutes mes entreprises".
// ⚠️ Routes fixes déclarées avant ':id', même règle que le reste du portefeuille.
@Controller('portfolio/leaves')
@UseGuards(AuthGuard('jwt'))
export class PortfolioLeavesController {
  constructor(private readonly service: PortfolioLeavesService) {}

  @Get()
  search(
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.search(userId, { companyId, status });
  }

  @Post()
  create(@GetUser('id') userId: string, @Body() dto: CreateLeaveDto) {
    return this.service.create(userId, dto);
  }

  @Post('manual')
  createManual(@GetUser('id') userId: string, @Body() dto: any) {
    return this.service.createManual(userId, dto);
  }

  @Get('planning')
  getMonthlyPlanning(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('mode') mode?: 'departures' | 'payable',
  ) {
    return this.service.getMonthlyPlanning(
      userId,
      companyId,
      Number(month),
      Number(year),
      mode,
    );
  }

  @Get('balances')
  getAllEmployeeBalances(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
  ) {
    return this.service.getAllEmployeeBalances(userId, companyId);
  }

  @Get(':id')
  findOne(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.findOne(userId, id);
  }

  @Patch(':id/status')
  updateStatus(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
    @Body('rejectionReason') rejectionReason?: string,
    @Body('extraDaysGranted') extraDaysGranted?: number,
    @Body('resumptionNote') resumptionNote?: string,
  ) {
    return this.service.updateStatus(
      userId,
      id,
      status,
      rejectionReason,
      extraDaysGranted,
      resumptionNote,
    );
  }

  @Patch(':id/cancel')
  cancel(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.service.cancel(userId, id, reason);
  }

  @Delete(':id')
  deleteLeave(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.deleteLeave(userId, id);
  }
}