// src/recruitment/recruitment-ai.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PDFExtractionService } from './pdf-extraction.service';
import { Mistral } from '@mistralai/mistralai';

export interface TestCorrection {
  questionId: string;
  isCorrect: boolean;
  pointsEarned: number;
  maxPoints: number;
}

export interface PreScreeningResult {
  isEligible: boolean;
  cvScore: number;
  reasoning: string; // ← MAINTENANT GÉNÉRÉ DÈS LE DÉBUT
  finalReasoning: string; // ← Raisonnement complet (CV + test)
  strengths: string[];
  weaknesses: string[];
  shouldTakeTest: boolean;
}

@Injectable()
export class RecruitmentAIService {
  private mistralClient: Mistral;

  private readonly CV_MAX_POINTS = 35;
  private readonly TEST_MAX_POINTS = 65;
  private readonly TOTAL_MAX_POINTS = 100;
  private readonly MIN_CV_SCORE_FOR_TEST = 15;

  constructor(
    private prisma: PrismaService,
    private pdfExtraction: PDFExtractionService,
  ) {
    const apiKey = process.env.MISTRAL_API_KEY;

    if (!apiKey) {
      throw new Error('❌ MISTRAL_API_KEY manquante ! Ajoute-la dans .env');
    }

    this.mistralClient = new Mistral({ apiKey });
    console.log('✅ Mistral API activée et prête !');
  }

  /**
   * 📋 Construit un résumé CV optimisé pour Mistral
   */
  private buildOptimizedCVSummary(parsedCV: any): string {
    const parts: string[] = [];

    if (
      parsedCV.sections.skills ||
      parsedCV.metadata.detectedSkills.length > 0
    ) {
      parts.push('=== COMPÉTENCES ===');
      if (parsedCV.sections.skills) {
        parts.push(parsedCV.sections.skills.substring(0, 500));
      }
      parts.push(
        `Compétences détectées : ${parsedCV.metadata.detectedSkills.slice(0, 30).join(', ')}`,
      );
      parts.push('');
    }

    if (parsedCV.sections.experience) {
      parts.push('=== EXPÉRIENCE PROFESSIONNELLE ===');
      parts.push(parsedCV.sections.experience.substring(0, 800));
      if (parsedCV.metadata.totalYearsExperience) {
        parts.push(
          `Expérience estimée : ${parsedCV.metadata.totalYearsExperience} ans`,
        );
      }
      parts.push('');
    } else if (parsedCV.metadata.totalYearsExperience) {
      parts.push('=== EXPÉRIENCE ===');
      parts.push(
        `Expérience détectée : ${parsedCV.metadata.totalYearsExperience} ans`,
      );
      parts.push('');
    }

    if (
      parsedCV.sections.education ||
      parsedCV.metadata.detectedDegrees.length > 0
    ) {
      parts.push('=== FORMATION ===');
      if (parsedCV.sections.education) {
        parts.push(parsedCV.sections.education.substring(0, 400));
      }
      if (parsedCV.metadata.detectedDegrees.length > 0) {
        parts.push(`Niveau détecté : ${parsedCV.metadata.detectedDegrees[0]}`);
      }
      parts.push('');
    }

    if (parsedCV.sections.profile) {
      parts.push('=== PROFIL ===');
      parts.push(parsedCV.sections.profile.substring(0, 300));
      parts.push('');
    }

    if (parsedCV.sections.projects) {
      parts.push('=== PROJETS ===');
      parts.push(parsedCV.sections.projects.substring(0, 400));
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * 🔍 PRÉ-SCREENING INTELLIGENT (1 SEUL APPEL MISTRAL)
   */
  async preScreenCV(
    cvFile: Express.Multer.File,
    jobOfferId: string,
  ): Promise<PreScreeningResult> {
    const jobOffer = await this.prisma.jobOffer.findUnique({
      where: { id: jobOfferId },
      select: {
        title: true,
        description: true,
        requiredSkills: true,
        minExperience: true,
        educationLevel: true,
        aiConfig: true,
      },
    });

    if (!jobOffer) {
      throw new NotFoundException('Offre introuvable');
    }

    console.log('📄 Extraction et analyse du CV...');
    const parsedCV = await this.pdfExtraction.extractAndParseCV(cvFile.buffer);

    console.log('📊 Métadonnées extraites:');
    console.log(`  - Compétences: ${parsedCV.metadata.detectedSkills.length}`);
    console.log(
      `  - Formation: ${parsedCV.metadata.detectedDegrees[0] || 'Non détectée'}`,
    );
    console.log(
      `  - Expérience: ${parsedCV.metadata.totalYearsExperience || 0} ans`,
    );

    const requiredSkillsStr = Array.isArray(jobOffer.requiredSkills)
      ? jobOffer.requiredSkills.join(', ')
      : 'Non spécifié';

    const cvSummary = this.buildOptimizedCVSummary(parsedCV);

    // 🔥 NOUVEAU PROMPT : Génère TOUT en 1 seul appel
    const prompt = `Tu es un expert RH PRAGMATIQUE. Analyse ce CV pour le poste de "${jobOffer.title}".

DESCRIPTION DU POSTE :
${jobOffer.description}

COMPÉTENCES REQUISES (PRIORITÉ ABSOLUE) :
${requiredSkillsStr}

${jobOffer.minExperience ? `EXPÉRIENCE MINIMALE : ${jobOffer.minExperience} ans` : 'EXPÉRIENCE : Pas de minimum requis'}
${jobOffer.educationLevel ? `FORMATION REQUISE : ${jobOffer.educationLevel}` : 'FORMATION : Non requise'}

──────────────────────────────────────────────────
${cvSummary}
──────────────────────────────────────────────────

INSTRUCTIONS :
✅ Compare compétences, expérience et formation
✅ PRIORISE les COMPÉTENCES TECHNIQUES (60% du score)
✅ Génère un raisonnement COURT (2-3 phrases) utilisable pour feedback candidat

GRILLE DE NOTATION (${this.CV_MAX_POINTS} pts max) :

1. COMPÉTENCES TECHNIQUES (0-21 pts)
   - 19-21 pts : Maîtrise excellente (90%+)
   - 15-18 pts : Bonne maîtrise (70-90%)
   - 9-14 pts : Maîtrise partielle (40-70%)
   - 0-8 pts : Insuffisant (<40%)
   
2. EXPÉRIENCE (0-9 pts)
   - 9 pts : 2+ ans ou nombreux projets
   - 5-8 pts : 1-2 ans
   - 2-4 pts : Débutant avec projets
   - 0-1 pts : Aucune
   
3. FORMATION (0-5 pts)
   ${
     jobOffer.educationLevel
       ? `- 5 pts : >= ${jobOffer.educationLevel}
   - 3 pts : Juste en-dessous
   - 1.5 pts : Très inférieur
   - 0 pts : Absent (PÉNALISANT)`
       : `- 5 pts : Présente (BONUS)
   - 2.5 pts : Absente (NEUTRE)`
   }

SEUIL : ${this.MIN_CV_SCORE_FOR_TEST}/${this.CV_MAX_POINTS}

Réponds en JSON (sans \`\`\`json) :
{
  "cvScore": 0-${this.CV_MAX_POINTS},
  "isEligible": true/false,
  "reasoning": "Feedback court pour le candidat (2-3 phrases, cite ce que tu as VU)",
  "strengths": ["2 points forts concrets"],
  "weaknesses": ["2 faiblesses concrètes"]
}`;

    try {
      console.log('🤖 Appel à Mistral API (1 SEUL APPEL)...');

      const chatResponse = await this.mistralClient.chat.complete({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 500,
      });

      const messageContent = chatResponse.choices?.[0]?.message?.content;
      const responseText =
        typeof messageContent === 'string'
          ? messageContent.trim()
          : JSON.stringify(messageContent);

      const cleanText = responseText.replace(/```json|```/g, '').trim();
      const analysis = JSON.parse(cleanText);

      if (
        typeof analysis.cvScore !== 'number' ||
        analysis.cvScore < 0 ||
        analysis.cvScore > this.CV_MAX_POINTS
      ) {
        throw new Error('Score CV invalide');
      }

      const isEligible = analysis.cvScore >= this.MIN_CV_SCORE_FOR_TEST;

      console.log(
        `🎯 Résultat IA : ${analysis.cvScore}/${this.CV_MAX_POINTS} - Éligible: ${isEligible ? '✅' : '❌'}`,
      );

      return {
        isEligible,
        cvScore: analysis.cvScore,
        reasoning: analysis.reasoning || 'Analyse automatique',
        finalReasoning: analysis.reasoning, // ← Réutilisé plus tard
        strengths: analysis.strengths || [],
        weaknesses: analysis.weaknesses || [],
        shouldTakeTest: isEligible,
      };
    } catch (error) {
      console.error('❌ Erreur Mistral API:', error.message);

      const fallbackScore = this.calculatePragmaticScore(parsedCV, jobOffer);
      const isEligible = fallbackScore >= this.MIN_CV_SCORE_FOR_TEST;

      return {
        isEligible,
        cvScore: fallbackScore,
        reasoning: 'Analyse automatique (IA indisponible)',
        finalReasoning: 'Analyse automatique (IA indisponible)',
        strengths: fallbackScore >= 20 ? ['Profil à revoir en détail'] : [],
        weaknesses: ['Analyse IA indisponible'],
        shouldTakeTest: isEligible,
      };
    }
  }

  /**
   * 🎯 CALCUL PRAGMATIQUE (fallback)
   */
  private calculatePragmaticScore(parsedCV: any, jobOffer: any): number {
    let score = 0;

    if (
      Array.isArray(jobOffer.requiredSkills) &&
      jobOffer.requiredSkills.length > 0
    ) {
      const requiredSkillsLower = jobOffer.requiredSkills.map((s: string) =>
        s.toLowerCase(),
      );
      const detectedSkillsLower = parsedCV.metadata.detectedSkills.map(
        (s: string) => s.toLowerCase(),
      );

      let matchCount = 0;
      for (const required of requiredSkillsLower) {
        const found = detectedSkillsLower.some(
          (detected) =>
            detected.includes(required) ||
            required.includes(detected) ||
            this.areSimilarSkills(required, detected),
        );
        if (found) matchCount++;
      }

      const matchPercentage = (matchCount / requiredSkillsLower.length) * 100;

      if (matchPercentage >= 90) score += 21;
      else if (matchPercentage >= 70) score += 17;
      else if (matchPercentage >= 50) score += 13;
      else if (matchPercentage >= 30) score += 8;
      else score += 3;
    }

    const yearsExp = parsedCV.metadata.totalYearsExperience || 0;
    const minExp = jobOffer.minExperience || 0;

    let expScore = 0;
    if (yearsExp >= minExp * 1.5) expScore = 9;
    else if (yearsExp >= minExp) expScore = 8;
    else if (yearsExp >= minExp * 0.5) expScore = 5;
    else if (parsedCV.metadata.detectedSkills.length > 10) expScore = 3;
    else expScore = 1;

    score += expScore;

    const detectedDegree = parsedCV.metadata.detectedDegrees[0];
    const requiredLevel = jobOffer.educationLevel;

    let formationScore = 0;

    if (requiredLevel) {
      if (detectedDegree) {
        const degreeValue: Record<string, number> = {
          'BAC+5': 5,
          'BAC+4': 4,
          'BAC+3': 3,
          'BAC+2': 2,
          BAC: 1,
        };
        const detectedValue = degreeValue[detectedDegree] || 0;
        const requiredValue = degreeValue[requiredLevel] || 0;

        if (detectedValue >= requiredValue) formationScore = 5;
        else if (detectedValue === requiredValue - 1) formationScore = 3;
        else if (detectedValue > 0) formationScore = 1.5;
        else formationScore = 0;
      }
    } else {
      formationScore = detectedDegree ? 5 : 2.5;
    }

    score += formationScore;
    return Math.min(score, this.CV_MAX_POINTS);
  }

  private areSimilarSkills(skill1: string, skill2: string): boolean {
    const s1 = skill1.toLowerCase().trim();
    const s2 = skill2.toLowerCase().trim();

    if (s1 === s2) return true;
    if (s1.includes(s2) || s2.includes(s1)) return true;

    const root1 = this.getWordRoot(s1);
    const root2 = this.getWordRoot(s2);
    if (root1.length >= 4 && root1 === root2) return true;

    const synonymGroups = [
      ['js', 'javascript'],
      ['ts', 'typescript'],
      ['py', 'python'],
      ['react', 'reactjs'],
      ['next', 'nextjs'],
      ['node', 'nodejs'],
      ['anglais', 'english'],
      ['français', 'french'],
      ['management', 'gestion'],
      ['vente', 'commerce'],
    ];

    for (const group of synonymGroups) {
      const foundInGroup1 = group.some((syn) => s1.includes(syn));
      const foundInGroup2 = group.some((syn) => s2.includes(syn));
      if (foundInGroup1 && foundInGroup2) return true;
    }

    return false;
  }

  private getWordRoot(word: string): string {
    return word
      .replace(/(tion|ment|eur|euse|iste|able|ible|ance|ence|age|isme)$/i, '')
      .replace(/(s|e|x)$/i, '');
  }

  /**
   * ✅ CORRECTION TEST (0 token IA)
   */
  async gradeTest(candidateId: string) {
    const answers = await this.prisma.candidateTestAnswer.findMany({
      where: { candidateId },
      include: { question: true },
    });

    if (answers.length === 0) {
      throw new NotFoundException('Aucune réponse trouvée');
    }

    let totalScore = 0;
    const corrections: TestCorrection[] = [];

    for (const answer of answers) {
      const isCorrect = this.checkAnswer(
        answer.selectedOption || '',
        answer.question.correctAnswers,
      );

      const pointsEarned = isCorrect ? answer.question.points : 0;
      totalScore += pointsEarned;

      corrections.push({
        questionId: answer.questionId,
        isCorrect,
        pointsEarned,
        maxPoints: answer.question.points,
      });

      await this.prisma.candidateTestAnswer.update({
        where: { id: answer.id },
        data: { isCorrect, pointsEarned },
      });
    }

    await this.prisma.candidate.update({
      where: { id: candidateId },
      data: {
        testScore: totalScore,
        testCompletedAt: new Date(),
      },
    });

    return {
      success: true,
      testScore: totalScore,
      maxScore: this.TEST_MAX_POINTS,
      totalQuestions: answers.length,
      corrections,
    };
  }

  /**
   * 🎯 CALCUL SCORE FINAL (réutilise reasoning du pré-screening)
   */
  async calculateFinalScore(candidateId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        jobOffer: {
          select: {
            aiConfig: true,
            title: true,
          },
        },
      },
    });

    if (!candidate) {
      throw new NotFoundException('Candidat introuvable');
    }

    const cvScore = candidate.cvScore || 0;
    const testScore = candidate.testScore || 0;
    const totalScore = cvScore + testScore;

    const config = (candidate.jobOffer.aiConfig as any) || {};
    const thresholds = {
      retenu: config.minScoreRetenu || 75,
      moyenne: config.minScoreMoyenne || 55,
      seconde: config.minScoreSeconde || 40,
    };

    let aiSuggestion: 'RETENU' | 'MOYENNE' | 'SECONDE_CHANCE' | 'REFUS';

    if (totalScore >= thresholds.retenu) aiSuggestion = 'RETENU';
    else if (totalScore >= thresholds.moyenne) aiSuggestion = 'MOYENNE';
    else if (totalScore >= thresholds.seconde) aiSuggestion = 'SECONDE_CHANCE';
    else aiSuggestion = 'REFUS';

    // 🔥 RÉUTILISE le raisonnement du pré-screening au lieu de rappeler Mistral
    const cvAnalysis = candidate.cvAnalysis as any;
    let aiReasoning = cvAnalysis?.reasoning || 'Analyse automatique du profil.';

    // Ajoute juste le résultat du test
    if (testScore > 0) {
      const testPercentage = Math.round(
        (testScore / this.TEST_MAX_POINTS) * 100,
      );
      aiReasoning += ` Test technique : ${testScore}/${this.TEST_MAX_POINTS} (${testPercentage}%).`;
    }

    await this.prisma.candidate.update({
      where: { id: candidateId },
      data: {
        totalScore,
        aiSuggestion,
        aiReasoning,
        aiAnalyzedAt: new Date(),
      },
    });

    return {
      success: true,
      totalScore,
      cvScore,
      testScore,
      aiSuggestion,
      aiReasoning,
      thresholds,
      breakdown: {
        cv: `${cvScore}/${this.CV_MAX_POINTS}`,
        test: `${testScore}/${this.TEST_MAX_POINTS}`,
        total: `${totalScore}/${this.TOTAL_MAX_POINTS}`,
      },
    };
  }

  private checkAnswer(selected: string, correctAnswers: string[]): boolean {
    return correctAnswers.includes(selected);
  }

  /**
   * 🤖 GÉNÉRATION AUTOMATIQUE DE QUESTIONS (NOUVEAU)
   */
  async generateTestQuestions(jobOfferId: string, parsedCV?: any) {
    const jobOffer = await this.prisma.jobOffer.findUnique({
      where: { id: jobOfferId },
      select: {
        title: true,
        description: true,
        requiredSkills: true,
        aiConfig: true,
      },
    });

    if (!jobOffer) {
      throw new NotFoundException('Offre introuvable');
    }

    const config = (jobOffer.aiConfig as any) || {};
    const numQuestions = config.testQuestionCount || 10;

    const requiredSkillsStr = Array.isArray(jobOffer.requiredSkills)
      ? jobOffer.requiredSkills.join(', ')
      : 'Compétences du poste';

    // Si on a le CV du candidat, personnaliser les questions
    const cvContext = parsedCV
      ? `\n\nCOMPÉTENCES DU CANDIDAT (à tester en priorité) :\n${parsedCV.metadata.detectedSkills.slice(0, 20).join(', ')}`
      : '';

    const prompt = `Tu es un expert RH. Génère EXACTEMENT ${numQuestions} questions de recrutement pour le poste de "${jobOffer.title}".

DESCRIPTION DU POSTE :
${jobOffer.description}

COMPÉTENCES REQUISES :
${requiredSkillsStr}${cvContext}

INSTRUCTIONS CRITIQUES :
✅ Questions basées sur les COMPÉTENCES REQUISES (pas hors sujet)
✅ Mix : 60% techniques + 30% mise en situation + 10% culture
✅ Difficulté progressive (facile → moyen → difficile)
✅ Chaque question vaut entre 5-8 points
✅ 4 options par question, 1 seule correcte
✅ Options plausibles (évite les réponses évidentes)

Réponds en JSON (sans \`\`\`json) :
{
  "questions": [
    {
      "question": "Question claire et précise",
      "questionType": "MULTIPLE_CHOICE",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswers": ["Option B"],
      "points": 6,
      "order": 1
    }
  ]
}`;

    try {
      console.log(`🤖 Génération de ${numQuestions} questions par IA...`);

      const chatResponse = await this.mistralClient.chat.complete({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5, // Un peu de créativité
        maxTokens: 2000,
      });

      const messageContent = chatResponse.choices?.[0]?.message?.content;
      const responseText =
        typeof messageContent === 'string'
          ? messageContent.trim()
          : JSON.stringify(messageContent);

      const cleanText = responseText.replace(/```json|```/g, '').trim();
      const result = JSON.parse(cleanText);

      if (!result.questions || !Array.isArray(result.questions)) {
        throw new Error('Format de réponse invalide');
      }

      // Créer les questions dans la BDD
      // Autour de la ligne 540
      const createdQuestions: Array<{
        id: string;
        question: string;
        questionType: string;
        options: string[];
        correctAnswers: string[];
        points: number;
        order: number;
      }> = [];
      for (const q of result.questions) {
        const created = await this.prisma.jobOfferTestQuestion.create({
          data: {
            jobOfferId,
            question: q.question,
            questionType: q.questionType || 'MULTIPLE_CHOICE',
            options: q.options,
            correctAnswers: q.correctAnswers,
            points: q.points || 6,
            order: q.order || createdQuestions.length + 1,
          },
        });
        createdQuestions.push(created);
      }

      // Marquer que les questions ont été générées par IA
      await this.prisma.jobOffer.update({
        where: { id: jobOfferId },
        data: { questionsGeneratedByAI: true },
      });

      console.log(
        `✅ ${createdQuestions.length} questions créées avec succès !`,
      );

      return {
        success: true,
        count: createdQuestions.length,
        questions: createdQuestions,
      };
    } catch (error) {
      console.error('❌ Erreur génération questions:', error);
      throw new BadRequestException(
        'Impossible de générer les questions. Veuillez créer manuellement.',
      );
    }
  }

  async getAIStats(companyId: string) {
    const candidates = await this.prisma.candidate.findMany({
      where: {
        jobOffer: { companyId },
        aiSuggestion: { not: null },
      },
      select: {
        aiSuggestion: true,
        hrDecision: true,
        totalScore: true,
      },
    });

    if (candidates.length === 0) {
      return {
        total: 0,
        retenu: 0,
        moyenne: 0,
        seconde: 0,
        refus: 0,
        overrideRate: 0,
        avgScore: 0,
      };
    }

    const stats = {
      total: candidates.length,
      retenu: candidates.filter((c) => c.aiSuggestion === 'RETENU').length,
      moyenne: candidates.filter((c) => c.aiSuggestion === 'MOYENNE').length,
      seconde: candidates.filter((c) => c.aiSuggestion === 'SECONDE_CHANCE')
        .length,
      refus: candidates.filter((c) => c.aiSuggestion === 'REFUS').length,

      overrideRate: Math.round(
        (candidates.filter(
          (c) => c.hrDecision !== null && c.hrDecision !== c.aiSuggestion,
        ).length /
          candidates.length) *
          100,
      ),

      avgScore: Math.round(
        candidates.reduce((sum, c) => sum + (c.totalScore || 0), 0) /
          candidates.length,
      ),
    };

    return stats;
  }
}
