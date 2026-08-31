import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';

@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  async startProcess(data: any) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: data.employeeId },
      select: { companyId: true },
    });

    if (!employee) {
      throw new NotFoundException('Employé introuvable');
    }

    // ⚠️ TEMPORAIRE : Utilise feature existante PRO+
    await this.subscriptionGuard.checkFeatureAccess(
      employee.companyId,
      'hasOnboarding', // Feature PRO+ (en attendant hasOnboarding)
    );

    return this.prisma.onboardingProcess.create({
      data: {
        employeeId: data.employeeId,
        type: data.type,
        startDate: new Date(data.startDate),
        tasks: {
          create: data.tasks.map((t: any) => ({
            title: t.title,
            assigneeRole: t.assigneeRole,
          })),
        },
      },
      include: { tasks: true },
    });
  }

  async getProcesses(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) return [];

    return this.prisma.onboardingProcess.findMany({
      where: {
        employee: { companyId: user.companyId },
      },
      include: {
        employee: {
          include: { department: true },
        },
        tasks: true,
      },
    });
  }

  async completeTask(taskId: string) {
    return this.prisma.onboardingTask.update({
      where: { id: taskId },
      data: {
        isCompleted: true,
        completedAt: new Date(),
      },
    });
  }
}
