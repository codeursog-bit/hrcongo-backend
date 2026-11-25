import { AuthService } from './auth.service';
describe('Renouvellement atomique des sessions',()=>{
  function setup(expired=false){let consumed=false;const prisma:any={userSession:{findUnique:jest.fn().mockResolvedValue({userId:'user',revokedAt:null,expiresAt:new Date(Date.now()+(expired?-60000:60000))}),updateMany:jest.fn(async()=>{if(consumed)return {count:0};consumed=true;return {count:1}})},user:{findUnique:jest.fn().mockResolvedValue({id:'user',role:'EMPLOYEE',isActive:true})}};
    const service=Object.create(AuthService.prototype) as any;service.prisma=prisma;service.jwtService={verify:()=>({type:'refresh',jti:'session',sub:'user'})};service.issueTokensAndSetCookies=jest.fn().mockResolvedValue({ok:true});return {service,prisma};}
  it('un seul renouvellement concurrent peut consommer le jeton',async()=>{const {service}=setup();const outcomes=await Promise.allSettled([service.refreshToken('signed',{}),service.refreshToken('signed',{})]);expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(service.issueTokensAndSetCookies).toHaveBeenCalledTimes(1)});
  it('refuse une session expirée même si le JWT est encore signé et valide',async()=>{const {service,prisma}=setup(true);await expect(service.refreshToken('signed',{})).rejects.toThrow();expect(prisma.userSession.updateMany).not.toHaveBeenCalled()});
});
