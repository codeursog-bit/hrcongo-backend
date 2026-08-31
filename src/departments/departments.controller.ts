import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { AuthGuard } from '@nestjs/passport';

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
}
