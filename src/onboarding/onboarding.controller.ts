import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('onboarding')
@UseGuards(AuthGuard('jwt'))
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post()
  startProcess(@Body() data: any) {
    return this.onboardingService.startProcess(data);
  }

  @Get()
  findAll(@Request() req) {
    return this.onboardingService.getProcesses(req.user.userId);
  }

  @Patch('tasks/:id/complete')
  completeTask(@Param('id') id: string) {
    return this.onboardingService.completeTask(id);
  }
}
