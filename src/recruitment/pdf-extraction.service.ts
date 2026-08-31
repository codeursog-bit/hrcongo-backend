// src/recruitment/pdf-extraction.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

interface ParsedCV {
  rawText: string;
  sections: {
    profile?: string;
    experience?: string;
    education?: string;
    skills?: string;
    languages?: string;
    certifications?: string;
    other?: string;
  };
  metadata: {
    name?: string;
    email?: string;
    phone?: string;
    totalYearsExperience?: number;
    detectedSkills: string[];
    detectedDegrees: string[];
  };
}

@Injectable()
export class PDFExtractionService {
  constructor() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  }

  private readonly SECTION_PATTERNS = {
    experience:
      /(?:expérience professionnelle|expériences?|parcours professionnel|professional experience|work experience|employment history|projets?)/i,
    education:
      /(?:formation|études|diplômes?|education|academic background|qualifications)/i,
    skills:
      /(?:compétences?|savoir-faire|aptitudes?|skills|technical skills|expertise)/i,
    languages: /(?:langues?|languages?)/i,
    certifications: /(?:certifications?|certificats?|certificates?)/i,
    profile: /(?:profil|résumé|à propos|about|summary|objective|profile)/i,
  };

  private readonly DEGREE_PATTERNS = [
    // BAC+5 (Master, Ingénieur, Doctorat, MBA)
    {
      pattern:
        /bac\s*\+\s*5|master|m2|mba|doctorat|phd|ingénieur|diplôme d'ingénieur|école d'ingénieur|grande école/i,
      level: 'BAC+5',
    },
    // BAC+4 (M1, Maîtrise)
    {
      pattern: /bac\s*\+\s*4|m1|maîtrise|maitrise/i,
      level: 'BAC+4',
    },
    // BAC+3 (Licence, Bachelor)
    {
      pattern: /bac\s*\+\s*3|licence|bachelor|l3/i,
      level: 'BAC+3',
    },
    // BAC+2 (BTS, DUT, DEUG, DEUST)
    {
      pattern: /bac\s*\+\s*2|bts|dut|deug|deust|l2/i,
      level: 'BAC+2',
    },
    // BAC (Baccalauréat, A-Level)
    {
      pattern: /baccalauréat|bac(?!\s*\+)|a-level|abitur/i,
      level: 'BAC',
    },
  ];

  async extractAndParseCV(buffer: Buffer): Promise<ParsedCV> {
    try {
      if (!buffer || buffer.length < 1000) {
        throw new BadRequestException('Fichier PDF vide ou invalide (< 1KB)');
      }

      console.log(
        `📄 Parsing PDF avec pdfjs-dist (${Math.round(buffer.length / 1024)}KB)...`,
      );

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        verbosity: 0,
      });

      const pdfDocument = await loadingTask.promise;
      const numPages = pdfDocument.numPages;

      console.log(`📄 PDF chargé : ${numPages} page(s)`);

      let fullText = '';

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();

        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');

        fullText += pageText + '\n';
      }

      const rawText = this.cleanExtractedText(fullText);

      if (!rawText || rawText.length < 100) {
        throw new BadRequestException('CV vide ou illisible après extraction');
      }

      console.log(`✅ Texte extrait : ${rawText.length} caractères`);

      const sections = this.detectSections(rawText);
      const metadata = this.extractMetadata(rawText, sections);

      console.log('📊 Sections détectées:', Object.keys(sections).join(', '));
      console.log(
        '🎓 Diplômes:',
        metadata.detectedDegrees.join(', ') || 'Aucun',
      );
      console.log('💼 Compétences extraites:', metadata.detectedSkills.length);
      console.log(
        '📅 Expérience estimée:',
        metadata.totalYearsExperience || 0,
        'ans',
      );

      return {
        rawText,
        sections,
        metadata,
      };
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error.message);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Erreur technique lors de la lecture du CV. Veuillez réessayer avec un autre fichier.',
      );
    }
  }

  async extractTextFromBuffer(buffer: Buffer): Promise<string> {
    const parsed = await this.extractAndParseCV(buffer);
    return parsed.rawText;
  }

  async extractTextFromURL(url: string): Promise<string> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return this.extractTextFromBuffer(buffer);
    } catch (error) {
      console.error('❌ Erreur téléchargement PDF:', error);
      throw new BadRequestException(
        'Impossible de télécharger le CV depuis le cloud.',
      );
    }
  }

  private detectSections(text: string): ParsedCV['sections'] {
    const lines = text.split('\n');
    const sections: ParsedCV['sections'] = {};

    let currentSection: string | null = null;
    let sectionContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      let foundSection = false;

      for (const [sectionKey, pattern] of Object.entries(
        this.SECTION_PATTERNS,
      )) {
        if (pattern.test(line)) {
          if (currentSection && sectionContent.length > 0) {
            sections[currentSection] = sectionContent.join('\n').trim();
          }

          currentSection = sectionKey;
          sectionContent = [];
          foundSection = true;
          break;
        }
      }

      if (!foundSection && currentSection) {
        sectionContent.push(line);
      }
    }

    if (currentSection && sectionContent.length > 0) {
      sections[currentSection] = sectionContent.join('\n').trim();
    }

    return sections;
  }

  private extractMetadata(
    rawText: string,
    sections: ParsedCV['sections'],
  ): ParsedCV['metadata'] {
    const metadata: ParsedCV['metadata'] = {
      detectedSkills: [],
      detectedDegrees: [],
    };

    // Email
    const emailMatch = rawText.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    );
    if (emailMatch) {
      metadata.email = emailMatch[0];
    }

    // Téléphone
    const phoneMatch = rawText.match(
      /(?:\+\d{1,3}\s?)?\(?\d{2,3}\)?[\s.-]?\d{2,3}[\s.-]?\d{2,3}[\s.-]?\d{2,3}/,
    );
    if (phoneMatch) {
      metadata.phone = phoneMatch[0];
    }

    // Compétences (amélioré)
    metadata.detectedSkills = this.extractSkillsIntelligently(
      rawText,
      sections,
    );

    // Diplômes (amélioré)
    metadata.detectedDegrees = this.extractDegrees(rawText);

    // Expérience (ultra amélioré)
    metadata.totalYearsExperience = this.estimateTotalExperience(
      rawText,
      sections.experience || '',
    );

    return metadata;
  }

  /**
   * 🧠 EXTRACTION INTELLIGENTE DES COMPÉTENCES (AMÉLIORÉE)
   */
  private extractSkillsIntelligently(
    rawText: string,
    sections: ParsedCV['sections'],
  ): string[] {
    const skills: Set<string> = new Set();

    // 1. Compétences depuis la section dédiée
    if (sections.skills) {
      const skillsText = sections.skills;

      const extractedSkills = skillsText
        .split(/[,;•\-\n|]/)
        .map((s) => s.trim())
        .filter(
          (s) =>
            s.length >= 2 &&
            s.length <= 50 &&
            !s.match(/^\d+$/) &&
            !s.match(/^(et|ou|de|des|le|la|les|un|une|avec)$/i),
        );

      extractedSkills.forEach((skill) => skills.add(skill));
    }

    // 2. Technologies courantes (détection intelligente)
    const techPatterns = [
      // Frontend
      /\b(react|reactjs|react\.js|nextjs|next\.js|vue|vuejs|angular|svelte)\b/gi,
      /\b(html5?|css3?|javascript|typescript|js|ts)\b/gi,
      /\b(tailwind|tailwindcss|bootstrap|sass|scss|less)\b/gi,

      // Backend
      /\b(node|nodejs|node\.js|express|nestjs|nest\.js)\b/gi,
      /\b(python|django|flask|fastapi|php|laravel)\b/gi,
      /\b(java|spring|kotlin|ruby|rails)\b/gi,

      // Database
      /\b(mysql|postgresql|postgres|mongodb|redis|sql)\b/gi,

      // DevOps/Tools
      /\b(git|github|gitlab|docker|kubernetes|aws|azure|gcp)\b/gi,
      /\b(figma|photoshop|illustrator|xd|sketch)\b/gi,

      // Langages
      /\b(c\+\+|c#|go|rust|swift|kotlin)\b/gi,
    ];

    techPatterns.forEach((pattern) => {
      const matches = rawText.matchAll(pattern);
      for (const match of matches) {
        if (match[0]) {
          skills.add(match[0]);
        }
      }
    });

    // 3. Mots capitalisés (technologies)
    const capitalizedWords =
      rawText.match(/\b[A-Z][a-zA-Z0-9.+#-]{2,25}\b/g) || [];
    capitalizedWords.forEach((word) => {
      if (
        word.length >= 3 &&
        word.length <= 30 &&
        !word.match(
          /^(Janvier|Février|Mars|Avril|Mai|Juin|Juillet|Août|Septembre|Octobre|Novembre|Décembre|Monday|Tuesday|Mr|Mme|Dr)$/i,
        )
      ) {
        skills.add(word);
      }
    });

    return Array.from(skills).slice(0, 100);
  }

  /**
   * 🎓 EXTRACTION DIPLÔMES (ULTRA COMPLÈTE - tous métiers)
   */
  private extractDegrees(rawText: string): string[] {
    const degrees: string[] = [];
    const textLower = rawText.toLowerCase();

    // ✅ DÉTECTION PAR PATTERNS GÉNÉRIQUES
    for (const { pattern, level } of this.DEGREE_PATTERNS) {
      if (pattern.test(rawText)) {
        if (!degrees.includes(level)) {
          degrees.push(level);
        }
      }
    }

    // ✅ DÉTECTION CONTEXTUELLE PAR MÉTIER (si patterns génériques ratent)

    // 🏥 SANTÉ (Médecin, Pharmacien, Infirmier)
    if (
      /doctorat en (médecine|pharmacie)|diplôme (de|d') (médecin|pharmacien|docteur)|doctor of medicine|md degree/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+5')) degrees.push('BAC+5');
    }
    if (
      /diplôme d'état d'infirmier|dei|diplôme infirmier|nursing degree/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+3')) degrees.push('BAC+3');
    }

    // ⚖️ DROIT (Avocat, Juriste)
    if (
      /master (en |de |d')?droit|m2 droit|capacité en droit|capa|avocat|barreau|law degree/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+5')) degrees.push('BAC+5');
    }
    if (/licence (en |de |d')?droit|l3 droit/i.test(textLower)) {
      if (!degrees.includes('BAC+3')) degrees.push('BAC+3');
    }

    // 💼 COMPTABILITÉ / FINANCE (Comptable, Expert-comptable)
    if (
      /dcg|dscg|diplôme de comptabilité|expert-comptable|chartered accountant|cpa/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+5')) degrees.push('BAC+5');
    }
    if (
      /bts (cgo|comptabilité)|dut (gea|gestion)|bts assistant|comptable/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+2')) degrees.push('BAC+2');
    }

    // 🏗️ INGÉNIERIE (Ingénieur civil, mécanique, etc.)
    if (
      /ingénieur|école (centrale|mines|ponts|polytechnique)|engineering degree/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+5')) degrees.push('BAC+5');
    }

    // 🎓 ENSEIGNEMENT (Professeur)
    // ✅ CORRECTION ICI : Ajout de la parenthèse ouvrante après 'if'
    if (/(capes|agrégation|master (meef|enseignement))/i.test(textLower)) {
      if (!degrees.includes('BAC+5')) degrees.push('BAC+5');
    }

    // 💻 INFORMATIQUE (Dev, Data Scientist)
    if (
      /master (informatique|ia|data|cybersécurité)|ingénieur informatique/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+5')) degrees.push('BAC+5');
    }
    if (
      /licence (informatique|pro web|développement)|bachelor (it|computer science)/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+3')) degrees.push('BAC+3');
    }
    if (/bts (sio|informatique)|dut informatique/i.test(textLower)) {
      if (!degrees.includes('BAC+2')) degrees.push('BAC+2');
    }

    // 🎨 DESIGN / COMMUNICATION
    if (/master (design|communication|graphisme)/i.test(textLower)) {
      if (!degrees.includes('BAC+5')) degrees.push('BAC+5');
    }
    if (/licence (arts|design|communication)/i.test(textLower)) {
      if (!degrees.includes('BAC+3')) degrees.push('BAC+3');
    }

    // 📊 COMMERCE / MARKETING
    if (
      /master (marketing|commerce|business)|mba|grande école de commerce|essec|hec/i.test(
        textLower,
      )
    ) {
      if (!degrees.includes('BAC+5')) degrees.push('BAC+5');
    }
    if (/bts (muc|nrc|commerce)|dut (tc|gea)/i.test(textLower)) {
      if (!degrees.includes('BAC+2')) degrees.push('BAC+2');
    }

    // Tri du plus élevé au plus bas
    degrees.sort(
      (a, b) =>
        ['BAC+5', 'BAC+4', 'BAC+3', 'BAC+2', 'BAC'].indexOf(a) -
        ['BAC+5', 'BAC+4', 'BAC+3', 'BAC+2', 'BAC'].indexOf(b),
    );

    return degrees;
  }

  /**
   * 📅 ESTIMATION EXPÉRIENCE (ULTRA AMÉLIORÉE)
   */
  private estimateTotalExperience(
    rawText: string,
    experienceSection: string,
  ): number {
    console.log('🔍 Analyse expérience...');

    const textToAnalyze = experienceSection || rawText;

    // ✅ PATTERN 1 : "Janvier 2024 à aujourd'hui" (CORRIGÉ)
    const frenchMonths =
      'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
    const englishMonths =
      'january|february|march|april|may|june|july|august|september|october|november|december';
    const monthPattern = new RegExp(
      `(${frenchMonths}|${englishMonths})\\s+(\\d{4})\\s*(?:[-–—]|à|to|au)\\s*(?:aujourd|today|current|actuel|présent|hui)`,
      'gi',
    );

    const monthMatches = textToAnalyze.match(monthPattern);

    if (monthMatches && monthMatches.length > 0) {
      console.log('✅ Pattern mois-année détecté:', monthMatches[0]);
      let totalYears = 0;
      const currentYear = new Date().getFullYear();

      for (const match of monthMatches) {
        const yearMatch = match.match(/(\d{4})/);
        if (yearMatch) {
          const startYear = parseInt(yearMatch[1]);
          const years = Math.max(0, currentYear - startYear);
          console.log(`  📅 ${startYear} → ${currentYear} = ${years} an(s)`);
          totalYears += years;
        }
      }

      if (totalYears > 0) return totalYears;
    }

    // ✅ PATTERN 2 : "2024 - 2026" ou "2024 à aujourd'hui"
    const yearRangePattern =
      /(\d{4})\s*(?:[-–—]|à|to|au)\s*(\d{4}|présent|today|current|actuel|aujourd)/gi;
    const yearMatches = textToAnalyze.match(yearRangePattern);

    if (yearMatches && yearMatches.length > 0) {
      console.log('✅ Pattern année-année détecté:', yearMatches[0]);
      let totalYears = 0;
      const currentYear = new Date().getFullYear();

      for (const range of yearMatches) {
        const match = range.match(
          /(\d{4})\s*(?:[-–—]|à|to|au)\s*(\d{4}|présent|today|current|actuel|aujourd)/i,
        );
        if (match) {
          const startYear = parseInt(match[1]);
          const endYear = match[2].match(/\d{4}/)
            ? parseInt(match[2])
            : currentYear;
          const years = Math.max(0, endYear - startYear);
          console.log(`  📅 ${startYear} → ${endYear} = ${years} an(s)`);
          totalYears += years;
        }
      }

      if (totalYears > 0) return totalYears;
    }

    // ✅ PATTERN 3 : "X ans d'expérience"
    const expDirectPattern =
      /(\d+)\s*(?:ans?|years?)\s*(?:d['']expérience|of experience|experience)/i;
    const expMatch = textToAnalyze.match(expDirectPattern);
    if (expMatch) {
      const years = parseInt(expMatch[1]);
      console.log(`✅ Mention directe: ${years} an(s)`);
      return years;
    }

    // ✅ PATTERN 4 : "Depuis 2024" (sans fin)
    const sincePattern = /(?:depuis|since)\s+(\d{4})/gi;
    const sinceMatch = textToAnalyze.match(sincePattern);
    if (sinceMatch) {
      const yearMatch = sinceMatch[0].match(/(\d{4})/);
      if (yearMatch) {
        const startYear = parseInt(yearMatch[1]);
        const currentYear = new Date().getFullYear();
        const years = Math.max(0, currentYear - startYear);
        console.log(`✅ "Depuis ${startYear}" détecté → ${years} an(s)`);
        return years;
      }
    }

    console.log("⚠️ Aucun pattern d'expérience détecté");
    return 0;
  }

  private cleanExtractedText(text: string): string {
    return text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
      .replace(/\s+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .substring(0, 15000)
      .trim();
  }

  generateStructuredSummary(parsed: ParsedCV): string {
    const parts: string[] = [];

    if (parsed.metadata.email || parsed.metadata.phone) {
      parts.push('=== CONTACT ===');
      if (parsed.metadata.email) parts.push(`Email: ${parsed.metadata.email}`);
      if (parsed.metadata.phone) parts.push(`Tél: ${parsed.metadata.phone}`);
      parts.push('');
    }

    if (parsed.sections.profile) {
      parts.push('=== PROFIL ===');
      parts.push(parsed.sections.profile.substring(0, 300));
      parts.push('');
    }

    if (parsed.metadata.detectedSkills.length > 0) {
      parts.push('=== COMPÉTENCES DÉTECTÉES ===');
      parts.push(parsed.metadata.detectedSkills.slice(0, 30).join(', '));
      parts.push('');
    }

    if (parsed.sections.education) {
      parts.push('=== FORMATION ===');
      parts.push(parsed.sections.education.substring(0, 500));
      if (parsed.metadata.detectedDegrees.length > 0) {
        parts.push(`Niveau détecté: ${parsed.metadata.detectedDegrees[0]}`);
      }
      parts.push('');
    }

    if (parsed.sections.experience) {
      parts.push('=== EXPÉRIENCE PROFESSIONNELLE ===');
      parts.push(parsed.sections.experience.substring(0, 800));
      if (parsed.metadata.totalYearsExperience) {
        parts.push(
          `Expérience totale estimée: ${parsed.metadata.totalYearsExperience} ans`,
        );
      }
      parts.push('');
    }

    return parts.join('\n');
  }
}
