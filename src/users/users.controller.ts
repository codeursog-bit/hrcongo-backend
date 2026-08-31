import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Delete,
  Param,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Post('invite')
  @UseGuards(AuthGuard('jwt'))
  @UsePipes(new ValidationPipe({ whitelist: true }))
  invite(@Body() inviteDto: InviteUserDto, @Request() req) {
    return this.usersService.inviteUser(req.user.userId, inviteDto);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  findAll(@Request() req) {
    return this.usersService.findAllByCompany(req.user.userId);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  /**
   * 🆕 Suppression d'un utilisateur (Admin/Super Admin uniquement)
   * DELETE /users/:id
   */
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  remove(@Param('id') id: string, @Request() req) {
    return this.usersService.remove(id, req.user.userId);
  }
}
