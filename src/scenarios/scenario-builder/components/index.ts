/**
 * 场景开发助手组件注册
 *
 * 将所有 UI 组件注册到场景组件注册表。
 */
import type React from 'react'
import type { ScenarioComponentRegistry } from '@shared/protocols/scenario-arch'
import ProjectListPanel from './project/ProjectListPanel'
import ProjectCreateDialog from './project/ProjectCreateDialog'
import BuildPanel from './build/BuildPanel'
import InstallPanel from './install/InstallPanel'
import PublishPanel from './publish/PublishPanel'
import KnowledgePanel from './knowledge/KnowledgePanel'
import TemplateListPanel from './template/TemplateListPanel'
import BuilderSettingsPanel from './settings/BuilderSettingsPanel'
import BuilderStatusBar from './status/BuilderStatusBar'
import BuilderStatusIndicator from './status/BuilderStatusIndicator'
import BuilderWelcomePage from './welcome/BuilderWelcomePage'
import DebugPanel from './debug/DebugPanel'

export const scenarioBuilderComponents: ScenarioComponentRegistry = {
  ProjectListPanel: ProjectListPanel as React.ComponentType<unknown>,
  ProjectCreateDialog: ProjectCreateDialog as React.ComponentType<unknown>,
  BuildPanel: BuildPanel as React.ComponentType<unknown>,
  InstallPanel: InstallPanel as React.ComponentType<unknown>,
  PublishPanel: PublishPanel as React.ComponentType<unknown>,
  KnowledgePanel: KnowledgePanel as React.ComponentType<unknown>,
  TemplateListPanel: TemplateListPanel as React.ComponentType<unknown>,
  BuilderSettingsPanel: BuilderSettingsPanel as React.ComponentType<unknown>,
  BuilderStatusBar: BuilderStatusBar as React.ComponentType<unknown>,
  BuilderStatusIndicator: BuilderStatusIndicator as React.ComponentType<unknown>,
  BuilderWelcomePage: BuilderWelcomePage as React.ComponentType<unknown>,
  DebugPanel: DebugPanel as React.ComponentType<unknown>,
}
