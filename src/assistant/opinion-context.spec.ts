import { buildOpinionFindings, opinionFindingText, withOpinions } from './opinion-context';

const circuit = ['ACCOUNTANT', 'HR', 'DG'];

describe('opinion-context', () => {
  it('sépare avis favorables, défavorables et avis encore attendus', () => {
    const f = buildOpinionFindings(circuit, [
      { functionCode: 'DG', opinion: 'FAVORABLE' },
      { functionCode: 'ACCOUNTANT', opinion: 'UNFAVORABLE' },
    ]);
    const by = Object.fromEntries(f.map((x) => [x.code, x]));
    expect(by.OPINIONS_FAVORABLE.values).toEqual({ count: 1, dg: 1 });
    expect(by.OPINIONS_UNFAVORABLE.values).toEqual({ count: 1, accountant: 1 });
    expect(by.OPINIONS_PENDING.values).toEqual({ count: 1, hr: 1 });
  });

  it('ne signale rien sans circuit ni avis', () => {
    expect(buildOpinionFindings(null, [])).toEqual([]);
  });

  it('nomme les fonctions en français sans nom de personne', () => {
    const [pending] = buildOpinionFindings(circuit, []);
    expect(opinionFindingText(pending)).toContain('Comptable');
    expect(opinionFindingText(pending)).toContain('Direction Générale');
  });

  it('un avis manquant ou défavorable rend un avis favorable « réservé »', () => {
    const extra = buildOpinionFindings(circuit, [{ functionCode: 'DG', opinion: 'FAVORABLE' }]);
    const clear = [{ code: 'CLEAR_FINANCE', severity: 'info' as const, values: {} }];
    const r = withOpinions('FAVORABLE', clear, extra, 'CLEAR_FINANCE');
    expect(r.verdict).toBe('RESERVE');
    expect(r.findings.some((f) => f.code === 'CLEAR_FINANCE')).toBe(false);
  });

  it('ne modifie pas un motif urgent', () => {
    const extra = buildOpinionFindings(circuit, []);
    expect(withOpinions('URGENT', [], extra, 'X').verdict).toBe('URGENT');
  });

  it('tous les avis favorables laissent l’avis favorable', () => {
    const extra = buildOpinionFindings(circuit, circuit.map((c) => ({ functionCode: c, opinion: 'FAVORABLE' })));
    expect(withOpinions('FAVORABLE', [], extra, 'X').verdict).toBe('FAVORABLE');
  });
});