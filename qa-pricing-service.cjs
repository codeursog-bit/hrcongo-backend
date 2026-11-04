require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {SubscriptionsService}=require('./src/subscriptions/subscriptions.service');
test('catalog is independent of the payment provider',async()=>{
 for(const provider of ['YABETOOPAY','MOTEKI','CHARIOW']){
  const catalog={PRO:{priceMonthly:43210,priceYearly:321987}};
  const response=await SubscriptionsService.prototype.getAvailablePlans.call({pricingService:{getPlans:async()=>catalog},platformSettings:{get:async()=>({paymentProvider:provider})}});
  assert.deepEqual(response.plans,catalog);
 }
});
test('a confirmed payment keeps its recorded price even if the catalog is removed',async()=>{
 let updated;
 const currentPeriodEnd=new Date(Date.now()+86400000);
 const context={logger:{log:()=>{}},pricingService:{getPrice:async()=>{throw Error('Catalog removed');}},prisma:{subscription:{findUnique:async()=>({plan:'PRO',status:'ACTIVE',currentPeriodEnd}),update:async args=>{updated=args.data;}}}};
 await SubscriptionsService.prototype.activateUpgrade.call(context,'qa-company','PRO','monthly',{pricePerMonth:43210});
 assert.equal(updated.pricePerMonth,43210);assert.equal(updated.currentPeriodStart,currentPeriodEnd);
});
