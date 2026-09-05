// ============================================================================
// 📁 src/leaves/leaves-common.util.ts
// ✅ Helpers partagés entre les services du module congé (LeavesService,
//    LeavesBalanceService, LeavesIndemnityService, LeavesDocumentsService) —
//    extraits pour éviter la duplication lors du découpage de l'ancien
//    leaves.service.ts monolithique.
// ============================================================================

import { PrismaService } from '../prisma/prisma.service';
import { CompanyNotFoundException } from '../exceptions/business.exceptions';

/**
 * Résout le companyId effectif pour un utilisateur.
 *
 * Pour les users ENTREPRISE (ADMIN, HR_MANAGER, MANAGER, EMPLOYEE) :
 *   → utilise user.companyId (comportement original inchangé)
 *
 * Pour les CABINET_ADMIN / CABINET_GESTIONNAIRE :
 *   → ils n'ont PAS de companyId sur leur User
 *   → on accepte overrideCompanyId passé depuis le controller
 *   → la vérification que ce companyId appartient au cabinet
 *     est faite par CabinetCompanyIsolationGuard en amont
 *
 * ⚠️  Si overrideCompanyId est absent ET que c'est un user cabinet
 *      → on lève CompanyNotFoundException comme avant
 */
export async function getUserWithCompany(
  prisma: PrismaService,
  userId: string,
  overrideCompanyId?: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, companyId: true, role: true, email: true },
  });

  const isCabinet =
    user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';

  if (isCabinet) {
    if (!overrideCompanyId) throw new CompanyNotFoundException();
    return {
      id: user.id,
      companyId: overrideCompanyId,
      role: user.role,
      email: user.email,
    };
  }

  if (!user?.companyId) throw new CompanyNotFoundException();
  return { ...user, companyId: user.companyId };
}

export async function getManagerDepartmentId(
  prisma: PrismaService,
  userId: string,
  companyId: string,
): Promise<string | null> {
  const dept = await prisma.department.findFirst({
    where: { managerId: userId, companyId },
    select: { id: true },
  });
  if (dept) return dept.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (user?.email) {
    const emp = await prisma.employee.findFirst({
      where: { email: user.email, companyId },
      select: { departmentId: true },
    });
    return emp?.departmentId ?? null;
  }
  return null;
}

/**
 * Résout la fenêtre du cycle d'acquisition en cours pour un employé —
 * démarre à l'embauche, redémarre à chaque retour de congé Annuel normal.
 *
 * ✅ CORRECTIF : fait avancer le cycle par tranches de 12 mois tant qu'il est
 *    entièrement dans le passé par rapport à `referenceDate`, pour retomber
 *    sur le cycle RÉELLEMENT ouvert aujourd'hui — au lieu de rester figée sur
 *    le tout premier cycle calculé depuis `hireDate`. Sans ça, un employé
 *    importé (hireDate ancienne, jamais eu de retour de congé validé dans
 *    l'appli donc `leaveCycleStartDate` toujours null) restait bloqué sur un
 *    `cycleEndDate` dans le passé pour toujours (ex: 2019), ce qui faussait à
 *    la fois le solde affiché (toujours plafonné à 26j, "12 mois" étant
 *    considérés comme déjà entièrement écoulés) et le faisait disparaître de
 *    tout planning de départs théoriques.
 *    ⚠️ Rétrocompatible : `referenceDate` est optionnel (défaut = maintenant)
 *    et n'affecte QUE les employés dont le cycle calculé est déjà expiré —
 *    ceux qui ont un `leaveCycleStartDate` à jour (mis à jour à chaque retour
 *    de congé validé via `updateStatus()`) ont déjà un cycle courant ou futur,
 *    donc la boucle ci-dessous ne s'exécute jamais pour eux.
 *
 * 🆕 `cycleMode` (Company.leaveCycleMode) :
 *  - 'ROLLING' (défaut, comportement historique inchangé) : le cycle redémarre
 *    à la date de RETOUR réelle du dernier congé (`leaveCycleStartDate`),
 *    donc toujours 12 mois de présence réelle avant le prochain départ.
 *  - 'ANNIVERSARY' : le cycle est TOUJOURS ancré sur le mois d'embauche
 *    (`hireDate`), peu importe la date réelle de retour — `leaveCycleStartDate`
 *    est ignoré. Un employé embauché en février part toujours en février,
 *    chaque année, sans dérive. Voir la conversation produit : le cycle
 *    suivant le premier ne totalise alors que 11 mois réels de présence (le
 *    12e étant le mois de départ lui-même), compensé côté indemnité par la
 *    substitution `paidIndemnityAmount` (voir leaves-indemnity.service.ts) —
 *    jamais par un prorata du solde (26j+ancienneté restent pleins, décision
 *    produit confirmée).
 */
export function resolveCycleWindow(
  hireDate: Date,
  leaveCycleStartDate: Date | null,
  referenceDate: Date = new Date(),
  cycleMode: 'ROLLING' | 'ANNIVERSARY' = 'ROLLING',
) {
  let cycleStartDate: Date;
  if (cycleMode === 'ANNIVERSARY') {
    // Toujours ancré sur hireDate — le retour réel n'a jamais d'influence.
    cycleStartDate = new Date(hireDate);
  } else {
    cycleStartDate = new Date(leaveCycleStartDate ?? hireDate);
  }
  let cycleEndDate = new Date(cycleStartDate);
  cycleEndDate.setMonth(cycleEndDate.getMonth() + 12);

  while (cycleEndDate < referenceDate) {
    cycleStartDate = new Date(cycleEndDate);
    cycleEndDate = new Date(cycleStartDate);
    cycleEndDate.setMonth(cycleEndDate.getMonth() + 12);
  }

  return { cycleStartDate, cycleEndDate };
}