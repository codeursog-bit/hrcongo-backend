import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { employeeRecordFilter } from './employee-record-filter';
import { captureIncident } from '../incidents/incident-sink';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL, // ✅ Utilise la poolée
        },
      },
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'error', 'warn']
          : ['error'],
    });
    this.$use(employeeRecordFilter);
    this.$use(async (params, next) => {
      if (['AppError','ErrorGroup','ErrorGroupActor','SystemLog','Notification','NotificationDedupKey','PushDelivery'].includes(params.model || '')) return next(params);
      const start = Date.now();
      try {
        const result = await next(params);
        const durationMs = Date.now() - start;
        if (durationMs >= Math.max(100, Number(process.env.INCIDENTS_SLOW_QUERY_MS) || 5000)) captureIncident({source:'BACK',code:'SLOW_QUERY',message:`Requête lente : ${params.model || 'SQL'}.${params.action}`,path:`/database/${params.model || 'SQL'}/${params.action}`,severity:'WARN',context:{durationMs}});
        return result;
      } catch (error) {
        const code = (error as any)?.code || 'DB_ERROR';
        captureIncident({source:'THIRD_PARTY',code,message:`Base de données : ${code}`,path:`/database/${params.model || 'SQL'}/${params.action}`,severity:/P1001|P1002|P1008|P1017/.test(code)?'CRITICAL':'ERROR',context:{durationMs:Date.now()-start}});
        throw error;
      }
    });
  }

  async onModuleInit() {
    try {
      await Promise.race([
        this.$connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connexion timeout (10s)')), 10000),
        ),
      ]);
      this.logger.log('✅ Base de données connectée');
    } catch (error) {
      this.logger.error('❌ Connexion DB échouée:', error.message);
      // En production, on veut que ça crash si pas de DB
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
      this.logger.warn('🔄 Mode dev : serveur continue sans DB');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🔌 Déconnexion DB');
  }

  // Helper pour cleanup
  async cleanDatabase() {
    if (process.env.NODE_ENV !== 'production') {
      const models = Reflect.ownKeys(this).filter(
        (key) => key[0] !== '_' && key !== 'constructor',
      );
      return Promise.all(
        models.map((modelKey) => (this[modelKey] as any).deleteMany()),
      );
    }
  }
}
