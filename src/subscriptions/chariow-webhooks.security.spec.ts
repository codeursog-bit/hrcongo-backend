import { ChariowWebhooksController } from './chariow-webhooks.controller';
describe('Chariow non vérifié',()=>{
 it('n’utilise jamais le payload public pour déclencher un paiement ou un appel prestataire',()=>{const controller=new ChariowWebhooksController();expect(controller.handleWebhook()).toEqual({received:true,processing:'POLLING_ONLY'});expect(Object.keys(controller)).toHaveLength(0)});
});
