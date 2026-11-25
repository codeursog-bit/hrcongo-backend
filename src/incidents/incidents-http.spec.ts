import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import * as bodyParser from 'body-parser';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { ClientErrorsController, OptionalIncidentSessionGuard } from './client-errors.controller';
import { AdminIncidentsController } from './admin-incidents.controller';
import { IncidentsService } from './incidents.service';
import { IncidentAlertsService } from './incident-alerts.service';

describe('HTTP incidents — JWT réel, validation et cloisonnement',()=>{
  let app:any,jwt:JwtService,service:IncidentsService;
  const oldFlag=process.env.INCIDENTS_ENABLED;
  const company='00000000-0000-4000-8000-000000000001',employee='00000000-0000-4000-8000-000000000002',admin='00000000-0000-4000-8000-000000000003';
  let preference=false;
  const capture=jest.fn();
  const prisma:any={userSession:{findUnique:jest.fn(async({where})=>({userId:where.jti==='admin'?admin:employee,expiresAt:new Date(Date.now()+60000),revokedAt:where.jti==='revoked'?new Date():null,user:{role:where.jti==='admin'?'SUPER_ADMIN':where.jti==='support'?'SUPPORT':'EMPLOYEE',isActive:true,email:'test@konza.cg',companyId:company}}))},user:{findUnique:jest.fn(async()=>({incidentEmailAlerts:preference})),update:jest.fn(async({data})=>{preference=data.incidentEmailAlerts;return {incidentEmailAlerts:preference}})}};
  const token=(sid:string,type='access')=>jwt.sign({sub:sid==='admin'?admin:employee,sid,type,companyId:company},{expiresIn:'5m'});
  beforeAll(async()=>{
    process.env.INCIDENTS_ENABLED='true';
    const module=await Test.createTestingModule({imports:[PassportModule,JwtModule.register({secret:'incident-http-test-secret-long-value'})],controllers:[ClientErrorsController,AdminIncidentsController],providers:[JwtStrategy,OptionalIncidentSessionGuard,{provide:ConfigService,useValue:{get:()=> 'incident-http-test-secret-long-value'}},{provide:PrismaService,useValue:prisma},{provide:IncidentsService,useValue:{enabled:true,capture}},{provide:IncidentAlertsService,useValue:{notify:jest.fn()}}]}).compile();
    app=module.createNestApplication({bodyParser:false});app.use(bodyParser.json({limit:'16kb'}));
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true,transformOptions:{enableImplicitConversion:true}}));
    await app.init();jwt=module.get(JwtService);
  });
  afterAll(async()=>{await app?.close();if(oldFlag===undefined)delete process.env.INCIDENTS_ENABLED;else process.env.INCIDENTS_ENABLED=oldFlag});
  it('capture le navigateur sous l’identité de la session validée, jamais sous celle du corps',async()=>{
    await request(app.getHttpServer()).post('/client-errors').set('Authorization',`Bearer ${token('employee')}`).send({message:'Render failed',path:'/employees/123',code:'JS_ERROR'}).expect(204);
    expect(capture.mock.calls.at(-1)[0]).toMatchObject({userId:employee,companyId:company});
    await request(app.getHttpServer()).post('/client-errors').set('Authorization',`Bearer ${token('employee')}`).send({message:'Render failed',path:'/',code:'JS_ERROR',companyId:'attacker-company'}).expect(400);
  });
  it('traite une session absente ou révoquée comme un signalement anonyme',async()=>{
    for(const authorization of ['',`Bearer ${token('revoked')}`]){
      await request(app.getHttpServer()).post('/client-errors').set('Authorization',authorization).send({message:'Public render failed',path:'/',code:'JS_ERROR'}).expect(204);
      expect(capture.mock.calls.at(-1)[0].companyId).toBeUndefined();expect(capture.mock.calls.at(-1)[0].userId).toBeUndefined();
    }
  });
  it('interdit les lectures aux anonymes, aux employés et au support',async()=>{
    await request(app.getHttpServer()).get('/admin/incidents/preferences').expect(401);
    for(const sid of ['employee','support'])await request(app.getHttpServer()).get('/admin/incidents/preferences').set('Authorization',`Bearer ${token(sid)}`).expect(403);
    await request(app.getHttpServer()).get('/admin/incidents/preferences').set('Authorization',`Bearer ${token('admin','refresh')}`).expect(401);
  });
  it('enregistre le choix mail du seul super admin authentifié, y compris sa désactivation',async()=>{
    for(const emailEnabled of [true,false]){
      const response=await request(app.getHttpServer()).patch('/admin/incidents/preferences').set('Authorization',`Bearer ${token('admin')}`).send({emailEnabled}).expect(200);
      expect(response.body.emailEnabled).toBe(emailEnabled);expect(prisma.user.update.mock.calls.at(-1)[0].where).toEqual({id:admin});
    }
    await request(app.getHttpServer()).patch('/admin/incidents/preferences').set('Authorization',`Bearer ${token('admin')}`).send({emailEnabled:'false'}).expect(400);
  });
  it('rejette les charges au-delà de 16 Ko avant le contrôleur',async()=>{
    await request(app.getHttpServer()).post('/client-errors').send({message:'x'.repeat(17000),path:'/',code:'JS_ERROR'}).expect(413);
  });
});
