import { JwtService } from '@nestjs/jwt';
import { RecruitmentTestAccessService } from './recruitment-test-access.service';

describe('Candidate test access', () => {
  const jwt = new JwtService({ secret: 'qa-unit-test-secret-not-a-production-key' });
  let candidate: any;
  let published: boolean;
  let service: RecruitmentTestAccessService;
  beforeEach(() => {
    candidate = { id: 'qa-candidate', jobOfferId: 'qa-job', status: 'EN_ATTENTE_TEST', retakeGrantedAt: null, testCompletedAt: null };
    published = true;
    service = new RecruitmentTestAccessService({ jobOffer: { findFirst: async () => published ? { id: 'qa-job' } : null }, candidate: { findFirst: async () => candidate } } as any, jwt);
  });
  it('accepts the signed link belonging to the candidate', async () => {
    expect((await service.authorize('qa-job', service.issue(candidate), candidate.id)).id).toBe(candidate.id);
  });
  it('rejects a missing, forged or expired token', async () => {
    for (const token of [undefined, 'forged', jwt.sign({ type: 'recruitment-test' }, { expiresIn: -1 })]) await expect(service.authorize('qa-job', token)).rejects.toThrow();
  });
  it('binds tokens to both the job and candidate', async () => {
    const token = service.issue(candidate);
    await expect(service.authorize('other-job', token)).rejects.toThrow();
    await expect(service.authorize('qa-job', token, 'other-candidate')).rejects.toThrow();
  });
  it('does not accept account access tokens', async () => {
    await expect(service.authorize('qa-job', jwt.sign({ type: 'access', sub: candidate.id, jobId: 'qa-job', version: null }))).rejects.toThrow();
  });
  it('rejects a draft or closed job', async () => {
    published = false;
    await expect(service.authorize('qa-job', service.issue(candidate))).rejects.toThrow();
  });
  it('revokes old links when a retake is granted or revoked', async () => {
    const token = service.issue(candidate);
    candidate.retakeGrantedAt = new Date();
    await expect(service.authorize('qa-job', token)).rejects.toThrow();
  });
  it('rejects completed or ineligible tests', async () => {
    const token = service.issue(candidate);
    candidate.testCompletedAt = new Date();
    await expect(service.authorize('qa-job', token)).rejects.toThrow();
    candidate.testCompletedAt = null; candidate.status = 'REFUSE';
    await expect(service.authorize('qa-job', token)).rejects.toThrow();
  });
});
