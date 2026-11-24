import {
  allScored,
  combineScores,
  verdictLabel,
  weightedAverage,
  weightsAreComplete,
} from './performance-scoring.util';

describe('performance-scoring.util (logique de la fiche Excel)', () => {
  const objectifs = [25, 20, 15, 15, 15, 10].map((weight) => ({ weight, score: 4 }));
  const facteurs = [1, 2, 3, 4, 5].map(() => ({ weight: 20, score: 3 }));

  it('reproduit F32 = obj/5×0,8 + fact/5×0,2 → 0,76 → "Dépasse les attentes"', () => {
    const obj = weightedAverage(objectifs);
    const fac = weightedAverage(facteurs);
    const final = combineScores(obj, fac, 80);
    expect(obj).toBe(4);
    expect(fac).toBe(3);
    expect(final).toBe(3.8);
    expect(final / 5).toBeCloseTo(0.76);
    expect(verdictLabel(final)).toBe('Dépasse les attentes');
  });

  it('si une section est vide, l\'autre compte pour 100 %', () => {
    expect(combineScores(null, 3, 80)).toBe(3);
    expect(combineScores(4, null, 80)).toBe(4);
  });

  it('seuils du verdict (ratio = score / 5)', () => {
    expect(verdictLabel(1.9)).toBe('Insuffisant');
    expect(verdictLabel(2.9)).toBe('En dessous des attentes');
    expect(verdictLabel(3.7)).toBe('Atteint');
    expect(verdictLabel(4.4)).toBe('Dépasse les attentes');
    expect(verdictLabel(4.6)).toBe('Excellent');
  });

  it('contrôle des poids (100 %) et des notes (1 à 5)', () => {
    expect(weightsAreComplete(objectifs)).toBe(true);
    expect(weightsAreComplete([{ weight: 60 }, { weight: 30 }])).toBe(false);
    expect(allScored([{ weight: 10, score: 0 }])).toBe(false);
    expect(allScored(objectifs)).toBe(true);
  });
});