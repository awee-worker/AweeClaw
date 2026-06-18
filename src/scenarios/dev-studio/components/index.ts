import type React from 'react'
import type { ScenarioComponentRegistry } from '@shared/protocols/scenario-arch'
import ProjectWizard from './project-wizard/ProjectWizard'
import StudioToolbar from './studio/StudioToolbar'
import StudioStatusBar from './studio/StudioStatusBar'
import StudioSettingsPanel from './settings/StudioSettingsPanel'
import AgentDevPanel from './agent-panel/AgentDevPanel'
import AgentRoleSelector from './agent-panel/AgentRoleSelector'
import AgentTaskBoard from './agent-panel/AgentTaskBoard'
import AgentCodeDiffView from './agent-panel/AgentCodeDiffView'
import AgentReviewThread from './agent-panel/AgentReviewThread'
import AgentPipelineProgress from './agent-panel/AgentPipelineProgress'
import AgentDevSessionHistory from './agent-panel/AgentDevSessionHistory'
import PreviewPanel from './preview/PreviewPanel'
import DeployPanel from './deploy/DeployPanel'
import DeployTargetSelector from './deploy/DeployTargetSelector'
import DeployHistoryList from './deploy/DeployHistoryList'
import PipelinePanel from './pipeline/PipelinePanel'
import PipelineStageList from './pipeline/PipelineStageList'
import PipelineLogViewer from './pipeline/PipelineLogViewer'
import PipelineConfigEditor from './pipeline/PipelineConfigEditor'

export const devStudioComponents: ScenarioComponentRegistry = {
  ProjectWizard: ProjectWizard as React.ComponentType<unknown>,
  StudioToolbar: StudioToolbar as React.ComponentType<unknown>,
  StudioStatusBar: StudioStatusBar as React.ComponentType<unknown>,
  StudioSettingsPanel: StudioSettingsPanel as React.ComponentType<unknown>,
  AgentDevPanel: AgentDevPanel as React.ComponentType<unknown>,
  AgentRoleSelector: AgentRoleSelector as React.ComponentType<unknown>,
  AgentTaskBoard: AgentTaskBoard as React.ComponentType<unknown>,
  AgentCodeDiffView: AgentCodeDiffView as React.ComponentType<unknown>,
  AgentReviewThread: AgentReviewThread as React.ComponentType<unknown>,
  AgentPipelineProgress: AgentPipelineProgress as React.ComponentType<unknown>,
  AgentDevSessionHistory: AgentDevSessionHistory as React.ComponentType<unknown>,
  PreviewPanel: PreviewPanel as React.ComponentType<unknown>,
  DeployPanel: DeployPanel as React.ComponentType<unknown>,
  DeployTargetSelector: DeployTargetSelector as React.ComponentType<unknown>,
  DeployHistoryList: DeployHistoryList as React.ComponentType<unknown>,
  PipelinePanel: PipelinePanel as React.ComponentType<unknown>,
  PipelineStageList: PipelineStageList as React.ComponentType<unknown>,
  PipelineLogViewer: PipelineLogViewer as React.ComponentType<unknown>,
  PipelineConfigEditor: PipelineConfigEditor as React.ComponentType<unknown>,
}