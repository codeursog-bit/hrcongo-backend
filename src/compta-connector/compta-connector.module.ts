
import {Module} from '@nestjs/common';
import {PrismaModule} from '../prisma/prisma.module';
import {CryptoModule} from '../crypto/crypto.module';
import {ComptaConnectorController} from './compta-connector.controller';
import {ComptaConnectorService} from './compta-connector.service';
@Module({imports:[PrismaModule,CryptoModule],controllers:[ComptaConnectorController],providers:[ComptaConnectorService]})
export class ComptaConnectorModule {}

