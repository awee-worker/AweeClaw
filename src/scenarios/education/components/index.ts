import type { ScenarioComponentRegistry } from '@shared/protocols/scenario-arch'
import { SubjectPanel } from './SubjectPanel'
import { SubjectDashboardPanel } from './SubjectDashboardPanel'
import { TopicPanel } from './TopicPanel'
import { QuizCenterPanel } from './QuizCenterPanel'
import { StudyPlanPanel } from './StudyPlanPanel'
import { ProgressPanel } from './ProgressPanel'
import { FlashCardPanel } from './FlashCardPanel'
import { MistakeBookPanel } from './MistakeBookPanel'

export const educationComponents: ScenarioComponentRegistry = {
  SubjectPanel,
  SubjectDashboardPanel,
  TopicPanel,
  QuizCenterPanel,
  StudyPlanPanel,
  ProgressPanel,
  FlashCardPanel,
  MistakeBookPanel,
}
