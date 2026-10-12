// import { Controller, Get, Post, Body, Patch, Param, UseGuards, Request } from '@nestjs/common';
// import { AssetsService } from './assets.service';
// import { CreateAssetDto } from './dto/create-asset.dto';
// import { AuthGuard } from '@nestjs/passport';

// @Controller('assets')
// @UseGuards(AuthGuard('jwt'))
// export class AssetsController {
//   constructor(private readonly assetsService: AssetsService) {}

//   @Post()
//   create(@Body() createAssetDto: CreateAssetDto, @Request() req) {
//     return this.assetsService.create(createAssetDto, req.user.userId);
//   }

//   @Get()
//   findAll(@Request() req) {
//     return this.assetsService.findAll(req.user.userId);
//   }

//   @Patch(':id/assign')
//   assign(@Param('id') id: string, @Body('employeeId') employeeId: string | null, @Request() req) {
//     return this.assetsService.assign(id, employeeId, req.user.userId);
//   }

//   @Get('employee/:id')
//   findByEmployee(@Param('id') id: string) {
//     return this.assetsService.findByEmployee(id);
//   }
// }
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('assets')
@UseGuards(AuthGuard('jwt'))
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  // POST /assets — Créer un actif
  @Post()
  create(@Body() createAssetDto: CreateAssetDto, @Request() req) {
    return this.assetsService.create(createAssetDto, req.user.userId);
  }

  // GET /assets — Lister tous les actifs de l'entreprise
  @Get()
  findAll(@Request() req) {
    return this.assetsService.findAll(req.user.userId);
  }

  // PATCH /assets/:id — Modifier les informations d'un actif
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateAssetDto: UpdateAssetDto,
    @Request() req,
  ) {
    return this.assetsService.update(id, updateAssetDto, req.user.userId);
  }

  // DELETE /assets/:id — Supprimer un actif (refusé s'il est attribué)
  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.assetsService.remove(id, req.user.userId);
  }

  // PATCH /assets/:id/assign — Assigner ou désassigner
  @Patch(':id/assign')
  assign(
    @Param('id') id: string,
    @Body('employeeId') employeeId: string | null,
    @Request() req,
  ) {
    return this.assetsService.assign(id, employeeId, req.user.userId);
  }

  // ✅ PATCH /assets/:id/status — Changer le statut (Maintenance, Disponible, Retraité…)
  @Patch(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Request() req,
  ) {
    return this.assetsService.changeStatus(id, status, req.user.userId);
  }

  // GET /assets/employee/:id — Actifs d'un employé
  @Get('employee/:id')
  findByEmployee(@Param('id') id: string) {
    return this.assetsService.findByEmployee(id);
  }
}