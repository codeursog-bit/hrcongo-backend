import { Module, Global } from '@nestjs/common';
import { MailService } from './mail.service';

@Global() // Rendre le module global pour l'utiliser partout sans réimporter
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
