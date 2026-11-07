
import {Body,Controller,Get,Patch,Post,Query,Request,UseGuards} from '@nestjs/common';
import {AuthGuard} from '@nestjs/passport';
import {IsIn,IsObject,IsOptional,IsString,Length,Matches} from 'class-validator';
import {RolesGuard} from '../auth/guards/roles.guard';
import {Roles} from '../auth/decorators/roles.decorator';
import {ComptaConnectorService} from './compta-connector.service';

class PairDto { @IsString() @Length(40,150) code!:string; }
class MappingsDto { @IsObject() mappings!:Record<string,string>; }
class CompanyQuery { @IsOptional() @Matches(/^[0-9a-f-]{36}$/i) companyId?:string; }
@Controller('compta-connector')
@UseGuards(AuthGuard('jwt'),RolesGuard)
@Roles('ADMIN','HR_MANAGER','CABINET_ADMIN','CABINET_GESTIONNAIRE')
export class ComptaConnectorController {
 constructor(private readonly service:ComptaConnectorService){}
 @Get() status(@Request() req:any,@Query() q:CompanyQuery){return this.service.status(req.user.userId,q.companyId);}
 @Post('pair') pair(@Request() req:any,@Query() q:CompanyQuery,@Body() dto:PairDto){return this.service.pair(req.user.userId,dto.code,q.companyId);}
 @Patch('mappings') mappings(@Request() req:any,@Query() q:CompanyQuery,@Body() dto:MappingsDto){return this.service.mappings(req.user.userId,dto.mappings,q.companyId);}
 @Post('sync') sync(@Request() req:any,@Query() q:CompanyQuery){return this.service.sync(req.user.userId,q.companyId);}
 @Post('suspend') suspend(@Request() req:any,@Query() q:CompanyQuery){return this.service.suspend(req.user.userId,q.companyId);}
}

