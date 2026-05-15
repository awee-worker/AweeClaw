import { describe, it, expect } from 'vitest';
import { legalScenario } from '../../src/scenarios/legal/config/scenario';
import { educationScenario } from '../../src/scenarios/education/config/scenario';
import { medicalScenario } from '../../src/scenarios/medical/config/scenario';

describe('Legal Scenario Configuration', () => {
  it('should have correct identity fields', () => {
    expect(legalScenario.id).toBe('legal');
    expect(legalScenario.name).toBe('Legal Counsel');
    expect(legalScenario.nameZh).toBe('法律顾问');
    expect(legalScenario.category).toBe('legal');
    expect(legalScenario.icon).toBe('Scale');
    expect(legalScenario.isBuiltin).toBe(true);
  });

  it('should have security rules with disclaimers', () => {
    expect(legalScenario.identity.securityRules).toContain('disclaimer');
    expect(legalScenario.identity.securityRules).toContain('NEVER provide definitive legal advice');
  });

  it('should have compliance mode requiring approval', () => {
    const complianceMode = legalScenario.capabilities.modes.find((m) => m.id === 'plan');
    expect(complianceMode).toBeDefined();
    expect(complianceMode!.label).toBe('Compliance');
    expect(complianceMode!.toolPolicy.requireApproval).toBe(true);
  });

  it('should have contract context type as highest priority', () => {
    const contractType = legalScenario.capabilities.contextTypes.find((c) => c.type === 'Contract');
    expect(contractType).toBeDefined();
    expect(contractType!.priority).toBe(1);
  });

  it('should have IRAC workflow convention', () => {
    expect(legalScenario.identity.conventions).toMatch(/issue-rule-application-conclusion|IRAC/i);
  });

  it('should have research-centric layout', () => {
    expect(legalScenario.ui.layout).toBe('research-centric');
  });

  it('should have law library sidebar item', () => {
    const lawLib = legalScenario.ui.sidebarItems.find((s) => s.id === 'knowledge');
    expect(lawLib).toBeDefined();
    expect(lawLib!.labelZh).toBe('法律库');
  });

  it('should have welcome suggestions', () => {
    expect(legalScenario.ui.welcomeSuggestions!.length).toBeGreaterThanOrEqual(3);
  });

  it('should not require workspace', () => {
    expect(legalScenario.requiresWorkspace).toBe(false);
  });
});

describe('Education Scenario Configuration', () => {
  it('should have correct identity fields', () => {
    expect(educationScenario.id).toBe('education');
    expect(educationScenario.name).toBe('Education Assistant');
    expect(educationScenario.nameZh).toBe('教育助手');
    expect(educationScenario.category).toBe('education');
    expect(educationScenario.icon).toBe('GraduationCap');
  });

  it('should have tutoring mode', () => {
    const tutorMode = educationScenario.capabilities.modes.find((m) => m.id === 'agent');
    expect(tutorMode).toBeDefined();
    expect(tutorMode!.label).toBe('Tutor');
    expect(tutorMode!.labelZh).toBe('辅导');
  });

  it('should have curriculum mode', () => {
    const curriculumMode = educationScenario.capabilities.modes.find((m) => m.id === 'plan');
    expect(curriculumMode).toBeDefined();
    expect(curriculumMode!.label).toBe('Curriculum');
  });

  it('should have quiz context type', () => {
    const quizType = educationScenario.capabilities.contextTypes.find((c) => c.type === 'Quiz');
    expect(quizType).toBeDefined();
    expect(quizType!.labelZh).toBe('测验');
  });

  it('should have focus-centric layout', () => {
    expect(educationScenario.ui.layout).toBe('focus-centric');
  });

  it('should have courses sidebar item', () => {
    const courses = educationScenario.ui.sidebarItems.find((s) => s.id === 'knowledge');
    expect(courses).toBeDefined();
    expect(courses!.labelZh).toBe('课程');
  });

  it('should have Socratic questioning convention', () => {
    expect(educationScenario.identity.conventions).toContain('Socratic');
  });

  it('should have academic integrity security rule', () => {
    expect(educationScenario.identity.securityRules).toContain('plagiarism');
  });
});

describe('Medical Scenario Configuration', () => {
  it('should have correct identity fields', () => {
    expect(medicalScenario.id).toBe('medical');
    expect(medicalScenario.name).toBe('Medical Assistant');
    expect(medicalScenario.nameZh).toBe('医疗助手');
    expect(medicalScenario.category).toBe('health');
    expect(medicalScenario.icon).toBe('Stethoscope');
  });

  it('should have critical security rules', () => {
    expect(medicalScenario.identity.securityRules).toContain('CRITICAL');
    expect(medicalScenario.identity.securityRules).toContain('NEVER provide definitive medical diagnoses');
  });

  it('should have symptom context type as highest priority', () => {
    const symptomType = medicalScenario.capabilities.contextTypes.find((c) => c.type === 'Symptom');
    expect(symptomType).toBeDefined();
    expect(symptomType!.priority).toBe(1);
  });

  it('should have research mode requiring approval', () => {
    const researchMode = medicalScenario.capabilities.modes.find((m) => m.id === 'plan');
    expect(researchMode).toBeDefined();
    expect(researchMode!.toolPolicy.requireApproval).toBe(true);
  });

  it('should have drug context type', () => {
    const drugType = medicalScenario.capabilities.contextTypes.find((c) => c.type === 'Drug');
    expect(drugType).toBeDefined();
    expect(drugType!.labelZh).toBe('药物');
  });

  it('should have medical library sidebar item', () => {
    const medLib = medicalScenario.ui.sidebarItems.find((s) => s.id === 'knowledge');
    expect(medLib).toBeDefined();
    expect(medLib!.labelZh).toBe('医学库');
  });

  it('should have disclaimer in description', () => {
    expect(medicalScenario.description).toContain('reference only');
    expect(medicalScenario.descriptionZh).toContain('仅供参考');
  });

  it('should have evidence strength indicators in conventions', () => {
    expect(medicalScenario.identity.conventions).toContain('Strong Evidence');
  });
});

describe('Scenario Cross-Validation', () => {
  const scenarios = [legalScenario, educationScenario, medicalScenario];

  it('all scenarios should have unique IDs', () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all scenarios should have system prompts', () => {
    for (const s of scenarios) {
      expect(s.identity.systemPrompt).toBeTruthy();
      expect(s.identity.systemPrompt.length).toBeGreaterThan(50);
    }
  });

  it('all scenarios should have security rules', () => {
    for (const s of scenarios) {
      expect(s.identity.securityRules).toBeTruthy();
    }
  });

  it('all scenarios should have at least 2 modes', () => {
    for (const s of scenarios) {
      expect(s.capabilities.modes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('all scenarios should have welcome suggestions', () => {
    for (const s of scenarios) {
      expect(s.ui.welcomeSuggestions!.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('all scenarios should have welcome title with both languages', () => {
    for (const s of scenarios) {
      expect(s.ui.welcomeTitle!.title).toBeTruthy();
      expect(s.ui.welcomeTitle!.titleZh).toBeTruthy();
    }
  });

  it('all scenarios should have sidebar items', () => {
    for (const s of scenarios) {
      expect(s.ui.sidebarItems.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('all scenarios should be builtin', () => {
    for (const s of scenarios) {
      expect(s.isBuiltin).toBe(true);
      expect(s.source).toBe('builtin');
    }
  });
});
