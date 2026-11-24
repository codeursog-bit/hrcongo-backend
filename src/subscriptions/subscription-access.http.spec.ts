import { Controller, Get, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessInterceptor } from './subscription-access.interceptor';
import { EntitlementsService } from './entitlements.service';

let writes = 0;
@Controller()
class BusinessProbe {
  @Get('dashboard/summary') dashboard() { return { total: 20 }; }
  @Get('employees') employees() { return []; }
  @Post('employees') create() { writes++; return { created: true }; }
  @Post('subscriptions/upgrade') renew() { return { checkout: true }; }
}

describe('Barrière HTTP abonnement', () => {
  it('refuse une écriture réelle avant son contrôleur et rouvre après renouvellement', async () => {
    let subscription:any = { plan:'PRO',status:'ACTIVE',currentPeriodEnd:new Date(0) };
    const module = await Test.createTestingModule({ controllers:[BusinessProbe], providers:[
      { provide:PrismaService,useValue:{company:{findUnique:async()=>({managedByCabinet:false})},subscription:{findUnique:async()=>subscription}} },
      { provide:APP_INTERCEPTOR,useClass:SubscriptionAccessInterceptor },
      { provide:EntitlementsService,useValue:{reserve:async()=>async()=>{}} },
    ] }).compile();
    const app = module.createNestApplication();
    // Session pré-authentifiée fictive, réservée à cette application de test.
    app.use((req:any,_res:any,next:any)=>{req.user={companyId:'qa',role:'ADMIN'};next();});
    await app.listen(0,'127.0.0.1');
    try {
      const url=await app.getUrl();
      expect((await fetch(url+'/dashboard/summary')).status).toBe(200);
      expect((await fetch(url+'/employees')).status).toBe(403);
      const denied=await fetch(url+'/employees',{method:'POST'});
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({error:'SUBSCRIPTION_BLOCKED',reason:'SUBSCRIPTION_EXPIRED'});
      expect(writes).toBe(0);
      expect((await fetch(url+'/subscriptions/upgrade',{method:'POST'})).status).toBe(201);
      subscription={plan:'PRO',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000),downgradedAt:null};
      expect((await fetch(url+'/employees',{method:'POST'})).status).toBe(201);
      expect(writes).toBe(1);
    } finally { await app.close(); }
  });
});
