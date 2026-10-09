import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('departments')
@UseGuards(AuthGuard('jwt'))
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  create(@Body() createDepartmentDto: CreateDepartmentDto, @Request() req) {
    return this.departmentsService.create(createDepartmentDto, req.user.userId);
  }

  @Get()
  findAll(@Request() req) {
    return this.departmentsService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.departmentsService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  update(
    @Param('id') id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
    @Request() req,
  ) {
    return this.departmentsService.update(
      id,
      updateDepartmentDto,
      req.user.userId,
    );
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  remove(@Param('id') id: string, @Request() req) {
    return this.departmentsService.remove(id, req.user.userId);
  }
}