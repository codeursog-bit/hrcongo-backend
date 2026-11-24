import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
