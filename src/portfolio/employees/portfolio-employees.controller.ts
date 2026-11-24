import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PortfolioEmployeesService } from './portfolio-employees.service';
import { CreatePortfolioEmployeeDto } from './dto/create-portfolio-employee.dto';
import { UpdateEmployeeDto } from '../../employees/dto/update-employee.dto';

// 🆕 GET/POST/PATCH/DELETE /portfolio/employees — vue transverse
// "toutes mes entreprises" pour l'admin multi-entreprises.
@Controller('portfolio/employees')
@UseGuards(AuthGuard('jwt'))
export class PortfolioEmployeesController {
  constructor(private readonly service: PortfolioEmployeesService) {}

  @Get()
  search(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.search(req.user.userId, q, companyId, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.userId, id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreatePortfolioEmployeeDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Patch(':id')
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.service.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.userId, id);
  }
}