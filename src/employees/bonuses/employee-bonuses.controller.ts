// 📁 src/employees/bonuses/employee-bonuses.controller.ts
// ✅ Fix : create() appelé avec 1 seul argument (dto complet)
//          employeeId injecté dans dto si route imbriquée

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { EmployeeBonusesService } from './employee-bonuses.service';
import { GetUser } from '../../auth/get-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class EmployeeBonusesController {
  constructor(private readonly bonusesService: EmployeeBonusesService) {}

  // ─── ROUTES PLATES (utilisées par le front) ───────────────────────────────

  @Get('employee-bonuses')
  async findAllFlat(
    @Query('employeeId') employeeId: string,
    @GetUser('id') userId: string,
  ) {
    return this.bonusesService.findAllByEmployee(employeeId, userId);
  }

  @Post('employee-bonuses')
  async createFlat(@Body() createDto: any, @GetUser('id') _userId: string) {
    // ✅ Fix : 1 seul argument — employeeId est dans createDto.employeeId
    return this.bonusesService.create(createDto);
  }

  @Put('employee-bonuses/:bonusId')
  @Patch('employee-bonuses/:bonusId')
  async updateFlat(
    @Param('bonusId') bonusId: string,
    @Body() updateDto: any,
    @GetUser('id') userId: string,
  ) {
    return this.bonusesService.update(bonusId, updateDto, userId);
  }

  @Delete('employee-bonuses/:bonusId')
  async removeFlat(
    @Param('bonusId') bonusId: string,
    @GetUser('id') userId: string,
  ) {
    return this.bonusesService.remove(bonusId, userId);
  }

  // ─── ROUTES IMBRIQUÉES (compatibilité) ────────────────────────────────────

  @Get('employees/:employeeId/bonuses')
  async findAll(
    @Param('employeeId') employeeId: string,
    @GetUser('id') userId: string,
  ) {
    return this.bonusesService.findAllByEmployee(employeeId, userId);
  }

  @Post('employees/:employeeId/bonuses')
  async create(
    @Param('employeeId') employeeId: string,
    @Body() createDto: any,
    @GetUser('id') _userId: string,
  ) {
    // ✅ Fix : on injecte employeeId dans dto puis 1 seul argument
    return this.bonusesService.create({ ...createDto, employeeId });
  }

  @Put('employees/:employeeId/bonuses/:bonusId')
  @Patch('employees/:employeeId/bonuses/:bonusId')
  async update(
    @Param('bonusId') bonusId: string,
    @Body() updateDto: any,
    @GetUser('id') userId: string,
  ) {
    return this.bonusesService.update(bonusId, updateDto, userId);
  }

  @Delete('employees/:employeeId/bonuses/:bonusId')
  async remove(
    @Param('bonusId') bonusId: string,
    @GetUser('id') userId: string,
  ) {
    return this.bonusesService.remove(bonusId, userId);
  }
}
